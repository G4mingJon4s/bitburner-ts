import { execute, getRamCost } from "util/execute.ts";

interface Instance {
  server: string;
  done: boolean;
  promise: Promise<void>;
  abort: () => void;
}
export function createShareInstance(ns: NS, duration = 10_000): (server: string) => Instance {
  return server => {
    const controller = new AbortController();
    const ram = getRamCost(ns, ["share"]);
    const threads = Math.floor(ns.getServerMaxRam(server) / ram);

    const instance: Instance = {
      server,
      done: false,
      promise: Promise.resolve(),
      abort: () => controller.abort()
    };

    if (threads === 0) {
      const promise = ns.asleep(1000).then(() => {}).finally(() => { instance.done = true; });
      instance.promise = promise;
      
      return instance;
    }
  
    const promise = execute<void>(ns, {
      ram,
      threads,
      host: server,
      description: "ShareInstance"
    }, async ns => {
      const start = Date.now();
      while (!controller.signal.aborted && Date.now() - start < duration) await ns["share"]();
    }).catch(r => {
      if (controller.signal.aborted) return;
      throw r;
    }).finally(() => { instance.done = true; });
    instance.promise = promise;

    return instance;
  };
}