type _StringKeys<T> = keyof T extends infer K ? K extends keyof T ? K : never : never;
type __StringKeys<T, K> =
  | `${K & string}`
  | (
    [T] extends [readonly (infer _)[]]
      ? number extends T["length"]
        ? number extends K
          ? `${bigint}`
          : `${K & number}`
        : never
      : number extends K
        ? `${bigint}`
        : `${K & number}`
  );
type StringKeys<T> = __StringKeys<T, _StringKeys<T>>

type NonHomomorphicKeyof<T> = keyof T extends infer K ? Extract<K, keyof T> : never
type GetStringKey<T, K extends StringKeys<T>> = {
  [K2 in NonHomomorphicKeyof<T>]: K extends __StringKeys<T, K2> ? T[K2] : never
}[NonHomomorphicKeyof<T>]

type AutoPath<O, P extends string, V = unknown> =
  (P & `${string}.` extends never ? P : P & `${string}.`) extends infer Q
    ? Q extends `${infer A}.${infer B}`
      ? O extends Map<infer K, infer G>
        ? A extends K
          ? `${A}.${AutoPath<G, B, V>}`
          : never
        : A extends StringKeys<O>
          ? `${A}.${AutoPath<GetStringKey<O, A>, B, V>}`
          : never
      : O extends Map<infer K, infer G>
        ? K & string
        : Q extends StringKeys<O>
          ? (GetStringKey<O, Q> extends V ? Exclude<P, `${string}.`> : never)
          | (StringKeys<GetStringKey<O, Q>> extends never ? never : `${Q}.`)
          : StringKeys<O>
          | (Q extends "" ? `${bigint}` extends StringKeys<O> ? "[index]" : never : never)
    : never;

type GetPath<O, P extends string> =
  P extends `${infer A}.${infer B}`
    ? O extends Map<infer K, infer G>
      ? A extends K
        ? GetPath<G, B>
        : never
      : A extends StringKeys<O>
        ? GetPath<GetStringKey<O, A>, B>
        : never
    : O extends Map<infer K, infer G>
      ? P extends K
        ? G
        : never
      : P extends StringKeys<O>
        ? GetStringKey<O, P>
        : never;

export const FILEPATH = "/util/do.ts";
export const HOSTNAME = "joesguns";
export const BASERAMCOST = 1.6;

export async function outsource<T extends string, Q = GetPath<NS, T>>(ns: NS, func: AutoPath<NS, T>, ...args: Q extends (...args: infer R) => infer _ ? R : never): Promise<Q extends (...args: infer _) => infer R ? R : never> {
  return new Promise((res, rej) => {
    outsourceNoException(ns, func, ...args).then(data => {
      if (data === null) return rej("Outsource resulted in null.");
      res(data);
    }).catch(rej);
  });
}

export async function outsourceNoException<T extends string, Q = GetPath<NS, T>>(ns: NS, func: AutoPath<NS, T>, ...args: Q extends (...args: infer R) => infer _ ? R : never): Promise<(Q extends (...args: infer _) => infer R ? R : never) | null> {
	const convertedArgs = args.map(a => JSON.stringify(a));

	ns.scp(FILEPATH, HOSTNAME, "home");
  const ramCost = BASERAMCOST + ns.getFunctionRamCost(func);
  while (ns.getServerMaxRam(HOSTNAME) - ns.getServerUsedRam(HOSTNAME) < ramCost) await ns.asleep(10);
	const pid = ns.exec(FILEPATH, HOSTNAME, { ramOverride: ramCost }, func, ...convertedArgs);
	if (pid < 1) return null;

	while (ns.isRunning(pid)) await ns.asleep(10);

	const data = ns.readPort(pid) as string;
	const result = parse(data);

	if (!isResult<T>(result)) return null;
	if (result.didError) {
		console.error("Outsourcing errored!", func, args, result);
		return null;
	}
	return result.data;
}

type Failure = {
	desc: "FAILURE";
	didError: true;
	error: unknown;
}

type Success<T extends string, P = GetPath<NS, T>> = {
	desc: "SUCCESS";
	didError: false;
	data: P extends (...args: infer _) => infer R ? R : never;
}

type Result<T extends string> = Success<T> | Failure;

export async function main(ns: NS) {
	const [func, ...args] = ns.args as [string, ...string[]];
	const funcArgs = func.split(".");

	try {
		const argObjs = args.map(a => parse(a));
		let nsFunc = ns[funcArgs.shift() as keyof NS] as ((...args: unknown[]) => unknown) | undefined;

		while (typeof nsFunc !== "function") {
			if (funcArgs.length === 0) throw new Error(`Input keyword is not a callable property of NS: "ns.${func}" is not a function.`);
			nsFunc = nsFunc?.[funcArgs.shift() as keyof typeof nsFunc];
		}

		const result = await nsFunc(...argObjs);

		const object = {
			desc: "SUCCESS",
			didError: false,
			data: result,
		};

		ns.writePort(ns.pid, JSON.stringify(object));
	} catch (e) {
		console.error(ns.pid, func, e ?? new Error("UNKNOWN ERROR"));

		const result = {
			desc: "FAILURE",
			didError: true,
			error: e ?? 500
		};

		ns.writePort(ns.pid, JSON.stringify(result));
	}
}

export function isResult<T extends string>(obj: unknown): obj is Result<T> {
	return obj !== null && typeof obj === "object" && "desc" in obj && (obj?.desc === "FAILURE" || obj?.desc === "SUCCESS");
}

export function parse(a: string): unknown {
	try { return JSON.parse(a); } catch { return a; }
}