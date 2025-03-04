import { outsource } from "util/do.ts";

export function getAllServers(ns: NS): string[] {
  const servers = new Set<string>();

  const dfs = (current: string) => {
    servers.add(current);

    ns.scan(current).filter(s => !servers.has(s)).forEach(dfs);
  };

  dfs("home");
  return Array.from(servers);
}

export async function buyAllDarkwebPrograms(ns: NS, allowPartial = false): Promise<boolean> {
  ns.tprint("INFO: Attempting to buy darkweb programs.");
  if (!await outsource(ns, "singularity.purchaseTor")) return false;
  const allPrograms = await outsource(ns, "singularity.getDarkwebPrograms");
  const combinedCost = await allPrograms.reduce(async (acc, cur) => await acc + await outsource(ns, "singularity.getDarkwebProgramCost", cur), Promise.resolve(0));
  if (!allowPartial && (await outsource(ns, "getPlayer")).money < combinedCost) return false;
  for (const program of allPrograms) await outsource(ns, "singularity.purchaseProgram", program);
  return true;
}

export async function communicate<T, P>(ns: NS, destination: number, payload: T, responseFormat: (obj: unknown) => obj is P, timeout = 20 * 1000): Promise<P> {
  ns.writePort(destination, payload);

  const handle = ns.getPortHandle(ns.pid);
  const start = Date.now();
  return new Promise((res, rej) => {
    const checkWrite = () => {
      if (Date.now() - start > timeout) rej("Hit timeout.");
      if (ns.isRunning(destination) && handle.empty()) return setTimeout(checkWrite, 10);
      if (handle.empty()) rej(`No response from process '${destination}'`);
      const response = ns.readPort(ns.pid);
      if (!responseFormat(response)) rej(`Invalid response '${response}'.`);
      return res(response);
    }
    setTimeout(checkWrite, 10);
  });
}