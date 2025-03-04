import { getAllServers } from "util/servers.ts";
import { createStanekInstance } from "servers/stanek.ts";
import { createShareInstance } from "servers/share.ts";
import { createProtocol, ProtocolClient } from "util/protocol.ts";
import * as t from "util/schema.ts";
import { execute, getRamCost } from "util/execute.ts";

const DEBUG = true;

export type Context = { servers: Map<number, string[]>; clearServer: ((server: string) => Promise<void>); debug: boolean; log: ((s: string) => void); };
export const p = createProtocol<Context>({
  port: 1000
});

export const router = p.router({
  reserve: p.create()
    .input(t.string())
    .output(t.boolean())
    .resolver((ctx, { origin }) => async server => {
      if (Array.from(ctx.servers.entries()).some(entry => entry[0] !== origin && entry[1].includes(server))) {
        if (ctx.debug) ctx.log(`WARN: Script on PID '${origin}' tried to reserve blocked server '${server}'`);
        return false;
      }

      if (ctx.debug) ctx.log(`INFO: Reserving server '${server}' for script on PID '${origin}'`);
      const entry = ctx.servers.get(origin) ?? [];
      entry.push(server);
      await ctx.clearServer(server);
      ctx.servers.set(origin, entry);

      return true;
    }),
  drop: p.create()
    .input(t.string())
    .resolver((ctx, { origin }) => async server => {
      const entry = ctx.servers.get(origin) ?? [];
      if (!entry.includes(server)) {
        if (ctx.debug) ctx.log(`WARN: Script on PID '${origin}' tried to drop blocked server '${server}'`);
        return;
      }

      if (ctx.debug) ctx.log(`INFO: Dropping server '${server}' for script on PID '${origin}'`);
      await ctx.clearServer(server);
      ctx.servers.set(origin, entry.filter(s => s !== server));
    }),
  blocked: p.create()
    .output(t.string().array())
    .resolver(ctx => async () => {
      const blocked = new Set<string>();
      ctx.servers.forEach(entry => entry.forEach(s => blocked.add(s)));
      return Array.from(blocked);
    })
});

export const reserveServer = async (client: ProtocolClient<Context, typeof router>, server: string): Promise<(() => Promise<void>)> => {
  const result = await client.reserve(server);
  if (!result) throw new Error(`Could not reserve server '${server}'`);
  return () => client.drop(server);
}

interface Instance {
  server: string;
  done: boolean;
  promise: Promise<void>;
  abort: () => void;
}

export const FILEPATH = "servers/control.ts";
export const EXCLUDEDSERVERS = ["home", "joesguns"];
export async function main(ns: NS) {
  ns.disableLog("ALL");
  ns.clearLog();
  const allServers = getAllServers(ns).filter(s => !EXCLUDEDSERVERS.includes(s));
  const mappedServers = new Map<number, string[]>();
  let terminatedScripts: number[] = [];

  let fillerInstances: Instance[] = [];

  const clearServer = async (server: string) => {
    fillerInstances.filter(i => i.server === server).forEach(i => i.abort());
    await ns.asleep(10);
    ns.killall(server);
  };
  
  const protocolServer = p.server(router, {
      servers: mappedServers,
      clearServer,
      log: ns.print,
      debug: DEBUG,
  });

  while (true) {
    await ns.asleep(10);
    await protocolServer.tick(ns);
    for (const script of mappedServers.keys()) if (!terminatedScripts.includes(script) && !ns.isRunning(script)) {
      if ((mappedServers.get(script) ?? []).every(s => ns.ps(s).length === 0)) {
        if (DEBUG) ns.print(`INFO: Dropping all servers of script on PID '${script}' because it is no longer running`);
        return mappedServers.delete(script);
      }
      if (DEBUG) ns.print(`WARN: Script on PID '${script}' is no longer running but left behind scripts on their servers`);
      terminatedScripts.push(script);
    }

    terminatedScripts = terminatedScripts.filter(script => {
      const entry = mappedServers.get(script) ?? [];
      if (entry.every(s => ns.ps(s).length === 0)) {
        mappedServers.delete(script);
        if (DEBUG) ns.print(`INFO: Cleared every remnant of the terminated script on PID '${script}'`);
        return false;
      }
      mappedServers.set(script, entry.filter(s => ns.ps(s).length !== 0));
      return true;
    });

    const blockedServers = new Set<string>();
    mappedServers.forEach(l => l.forEach(s => blockedServers.add(s)));
    const freeServers = allServers.filter(s => !blockedServers.has(s) && ns.getServerMaxRam(s) !== 0 && ns.hasRootAccess(s));
    freeServers.sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a));

    if (fillerInstances.every(i => i.done)) {
      const active = await execute(ns, { ram: getRamCost(ns, ["stanek.activeFragments"]), host: freeServers[0] }, ns => Promise.resolve(ns["stanek"]["activeFragments"]()));

      const cutOff = Math.floor(freeServers.length / 2);
      const stanekInstantiator = createStanekInstance(ns, active);
      const shareInstantiator = createShareInstance(ns);

      const stanekInstances = freeServers.slice(0, cutOff).map(stanekInstantiator);
      const shareInstances = freeServers.slice(cutOff).map(shareInstantiator);

      fillerInstances = [...stanekInstances, ...shareInstances];
    }
  }
}
