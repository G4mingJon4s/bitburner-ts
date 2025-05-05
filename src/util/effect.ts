import { Effect } from "effect";
import { UnknownException } from "effect/Cause";

export class NSDeathError {
  readonly _tag = "NSDeathError";
}

export interface NSServiceImpl {
  call: <A>(
    func: (ns: NS, signal: AbortSignal) => A | Promise<A>,
    msg?: string,
  ) => Effect.Effect<A, NSDeathError | UnknownException, never>;
}

export const wrapNS = (ns: NS) => <A>(
  func: (ns: NS, signal: AbortSignal) => A | Promise<A>,
  err?: string,
): Effect.Effect<A, NSDeathError | UnknownException, never> => Effect.tryPromise({
  try: async signal => await func(ns, signal),
  catch: e => {
    if (e instanceof Error && e.message.startsWith("ScriptDeath")) return new NSDeathError();
    return new UnknownException(e, err ?? "Unknown error in NS call.");
  },
});

export class NSService extends Effect.Tag("NSService")<NSService, NSServiceImpl>() { }

export const runMain = <A, E>(effect: Effect.Effect<A, E, NSService>) => (ns: NS) => {
  const controller = new AbortController();
  ns.atExit(() => controller.abort(), "effect-main");

  return Effect.runPromiseExit(effect.pipe(
    Effect.provideService(NSService, {
      call: wrapNS(ns),
    }),
  ), { signal: controller.signal });
}

export const main = Effect.gen(function* () {
  const NS = (yield* NSService).call;

  yield* NS(ns => ns.corporation.bribe("", 5));

  Effect.all([
    NS(ns => ns.hack("joesguns")),
    NS(ns => ns.grow("joesguns")),
  ], { concurrency: "unbounded" });
}).pipe(
  runMain,
);