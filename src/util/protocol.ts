import * as t from "util/schema.ts";

type Port = {
  internal: number;
  external: number;
};
type ProtocolConfig = {
  port: number;
  timeout?: number;
  log?: (ns: NS) => (s: string) => void;
};
type InternalConfig = Required<Omit<ProtocolConfig, "port">> & { port: Port; };

type ProtocolCaller<Input, Output> = Input extends null ? () => Promise<Output extends null ? void : Output> : (input: Input) => Promise<Output extends null ? void : Output>;
type ProtocolMetadata = {
  origin: number;
  ns: NS;
};
type ProcedureResolver<Context, Input, Output> = (ctx: Context, meta: ProtocolMetadata) => ProtocolCaller<Input, Output>;
interface Procedure<Context, Input, Output> {
  input: Input extends null ? null : t.Schema<Input>;
  output: Output extends null ? null : t.Schema<Output>;
  clientAction?: (ns: NS) => Promise<void>;
  resolve: ProcedureResolver<Context, Input, Output>;
};
type AnyProcedure<Context> = Procedure<Context, any, any>;
type AnyRouter<Context> = { [key: string]: AnyRouter<Context> | AnyProcedure<Context>; };
const isAnyProcedure = <Context>(v: unknown): v is AnyProcedure<Context> => (
  typeof v === "object" && v !== null &&
  "resolve" in v && "input" in v && "output" in v
);

type BuilderData<I, O> = {
  clientAction: ((ns: NS) => Promise<void>) | null;
  input: t.Schema<I> | null;
  output: t.Schema<O> | null;
};
class ProcedureBuilder<Context, Input = null, Output = null> {
  private data: BuilderData<Input, Output>;

  constructor(data: BuilderData<Input, Output>) {
    this.data = data;
  }

  input<I>(schema: t.Schema<I>): ProcedureBuilder<Context, I, Output> {
    return new ProcedureBuilder({ ...this.data, input: schema });
  }

  output<O>(schema: t.Schema<O>): ProcedureBuilder<Context, Input, O> {
    return new ProcedureBuilder({ ...this.data, output: schema });
  }

  clientAction(action: (ns: NS) => Promise<void>): ProcedureBuilder<Context, Input, Output> {
    return new ProcedureBuilder({ ...this.data, clientAction: action });
  }

  resolver(fn: ProcedureResolver<Context, Input, Output>) {
    const proc: any = {};
    if (this.data.clientAction) proc.clientAction = this.data.clientAction;

    proc.input = this.data.input;
    proc.output = this.data.output;
    proc.resolve = fn;

    return proc as Procedure<Context, Input, Output>;
  }
}

const findProcedure = <Context>(router: AnyRouter<Context>, path: string): AnyProcedure<Context> | null => {
  if (path === "ping") return {
    resolve: () => () => Promise.resolve(true),
    input: null,
    output: t.boolean(),
  };

  const keys = path.split(".");
  let cur: AnyRouter<Context> | AnyProcedure<Context> = router;
  while (keys.length !== 0) {
    const key = keys.shift();
    if (key === undefined || !(key in cur)) return null;
    cur = router[key];
  }
  if (isAnyProcedure<Context>(cur)) return cur;
  return null;
};

export interface ProtocolServer<Context> {
  context: Context;
  tick: (ns: NS) => Promise<void>;
}

class Server<Context, R extends AnyRouter<Context>> implements ProtocolServer<Context> {
  context: Context;
  private router: R;
  private config: InternalConfig;

  constructor(context: Context, router: R, config: InternalConfig) {
    this.context = context;
    this.router = router;
    this.config = config;
  }

  async tick(ns: NS) {
    const requests: any[] = [];
    const handle = ns.getPortHandle(this.config.port.external);
    while (!handle.empty()) requests.push(handle.read());

    const logs: string[] = [];
    for (const recieved of requests) {
      await ns.asleep(1);

      const req = request.safeParse(recieved);
      if (!req.success) {
        logs.push(`Recieved invalid request: (${req.error})`);
        continue;
      }

      const proc = findProcedure(this.router, req.data.procedure);
      if (proc === null) {
        logs.push(`Recieved invalid procedure: (${req.data.procedure})`);
        continue;
      }

      const input = proc.input?.safeParse(req.data.payload) ?? null;
      if (input !== null && !input.success) {
        logs.push(`Invalid input format: (${input.error})`);
        continue;
      }

      let success = false;
      let value;
      let error = "";
      await proc.resolve(this.context, {
        origin: req.data.origin,
        ns,
      })(input?.data ?? null).then(v => {
        success = true;
        value = v;
      }).catch(e => {
        error = e;
      });

      const res: Response = success ? {
        success,
        payload: value,
        procedure: req.data.procedure,
      } : {
        success,
        error,
        procedure: req.data.procedure
      };

      ns.writePort(req.data.origin, res);
    }

    if (logs.length !== 0) {
      const logFn = this.config.log(ns);
      logs.map(s => `Protocol Error: ${s}`).forEach(s => logFn(s));
    }
  }
}

type _ProtocolClient<Context, R extends AnyRouter<Context>> = {
  [K in keyof R]: R[K] extends Procedure<Context, infer I, infer O>
  ? ProtocolCaller<I, O>
  : R[K] extends AnyRouter<Context>
  ? _ProtocolClient<Context, R>
  : never;
}
export type ProtocolClient<Context, R extends AnyRouter<Context>> = Omit<
  _ProtocolClient<Context, R>,
  "ping"
> & {
  ping: () => Promise<boolean>;
};

const request = t.object({
  origin: t.number(),
  procedure: t.string(),
  payload: t.any(),
});
type Request = t.infer<typeof request>;

const response = t.object({
  procedure: t.string(),
}).and(t.union(t.object({
  success: t.boolean().true(),
  payload: t.any(),
}), t.object({
  success: t.boolean().false(),
  error: t.string(),
})));
type Response = t.infer<typeof response>;

const createClientHandler = <Context>(ns: NS, config: InternalConfig) => <I, O>(proc: Procedure<Context, I, O>, path: string): ProtocolCaller<I, O> => (async (_input: unknown): Promise<O> => {
  const result = proc.input?.safeParse(_input) ?? null;
  if (result !== null && !result.success) throw result.error;

  const req: Request = {
    origin: ns.pid,
    payload: result === null ? null : result.data,
    procedure: path
  };

  if (proc.clientAction) await proc.clientAction(ns);

  ns.writePort(config.port.external, req);
  const handle = ns.getPortHandle(ns.pid);
  await Promise.any([handle.nextWrite(), ns.asleep(config.timeout)]);
  if (handle.empty()) {
    if (path === "ping") return false as any;
    throw new Error("No response.");
  }

  const res = response.parse(handle.read());

  if (res.procedure !== path) throw new Error(`Procedure mismatch: Expected '${path}', got '${res.procedure}'`);
  if (!res.success) throw new Error(`Procedure failed on the server: ${res.error}`);

  // if an output validator is not present, there shouldn't be a return value
  if (proc.output === null) return undefined as O;

  const output = proc.output.safeParse(res.payload);
  if (!output.success) throw new Error(`Procedure returned incorrect value: (${output.error})`);

  return output.data;
}) as any;

function createClient<Context, R extends AnyRouter<Context>>(
  router: R,
  mapFn: <I, O>(proc: Procedure<Context, I, O>, path: string) => ProtocolCaller<I, O>
): ProtocolClient<Context, R> {
  // store any results here, so that cycles in the router get resolved
  const mapped = new Map();
  const traverse = (node: any, path = ""): any => {
    if (mapped.has(node)) return mapped;

    if (isAnyProcedure(node)) {
      return mapFn(node, path);
    }

    const result: any = {};
    // since this is a reference, we can resolve cycles even before the full object is created
    mapped.set(node, result);
    for (const key in node) result[key] = traverse(
      node[key],
      path === "" ? key : `${path}.${key}`
    );

    return result;
  };

  return {
    ...traverse(router), ping: mapFn({
      input: null,
      output: t.boolean(),
      resolve: () => () => Promise.resolve(true),
    } as Procedure<Context, null, boolean>, "ping"),
  };
}

export const createProtocol = <Context = {}>(config: ProtocolConfig) => {
  const internal: InternalConfig = {
    timeout: 10 * 1000,
    log: (ns: NS) => ns.tprint,
    ...config,
    port: {
      internal: config.port,
      external: Number.MAX_SAFE_INTEGER - config.port
    }
  };

  return {
    router: <R extends AnyRouter<Context>>(r: R) => r,
    create: () => new ProcedureBuilder<Context>({
      clientAction: null,
      input: null,
      output: null
    }),
    server: <R extends AnyRouter<Context>>(router: R, ctx: Context): ProtocolServer<Context> => new Server(ctx, router, internal),
    client: <R extends AnyRouter<Context>>(ns: NS, router: R): ProtocolClient<Context, R> => createClient(router, createClientHandler(ns, internal)),
  };
};