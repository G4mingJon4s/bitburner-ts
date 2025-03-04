import { getAllServers, buyAllDarkwebPrograms } from "util/servers.ts";
import { outsource } from "util/do.ts";

export const FILEPATH = "servers/access.ts";

export async function main(ns: NS) {
  const allServers = getAllServers(ns).filter(s => !s.startsWith("hacknet-server"));

  rootServer(ns, "joesguns");
  const boughtPrograms = ns.ls("home", ".exe");
  if (ROOTING_PROGRAMS.some(p => !boughtPrograms.includes(p.name))) await buyAllDarkwebPrograms(ns, true);

  const rooted = allServers.map(s => rootServer(ns, s));
  ns.tprint(`Root access to ${rooted.filter(a => a).length} out of ${allServers.length} servers.`);

  if (ns.args.length === 0) return;
  
  const backdoored = await allServers.reduce(async (acc, s) => {
    const data = await acc;
    data.push(await backdoor(ns, s));
    return data;
  }, Promise.resolve<boolean[]>([]));
  ns.tprint(`Backdoored ${backdoored.filter(a => a).length} out of ${allServers.length} servers.`);
}

const ROOTING_PROGRAMS = [
  {
    name: "BruteSSH.exe",
    func: (ns: NS, server: string) => ns.brutessh(server),
  },
  {
    name: "FTPCrack.exe",
    func: (ns: NS, server: string) => ns.ftpcrack(server),
  },
  {
    name: "relaySMTP.exe",
    func: (ns: NS, server: string) => ns.relaysmtp(server),
  },
  {
    name: "HTTPWorm.exe",
    func: (ns: NS, server: string) => ns.httpworm(server),
  },
  {
    name: "SQLInject.exe",
    func: (ns: NS, server: string) => ns.sqlinject(server),
  },
];
const rootServer = (ns: NS, server: string): boolean => {
  for (let i = 0; i < ROOTING_PROGRAMS.length; i++) {
    const program = ROOTING_PROGRAMS[i];
    if (ns.ls("home", program.name).length !== 1) continue;

    program.func(ns, server);
  }

  const object = ns.getServer(server);
  if (!ns.hasRootAccess(server) && (object.openPortCount ?? 0) >= (object.numOpenPortsRequired ?? ROOTING_PROGRAMS.length)) ns.nuke(server);
  return ns.hasRootAccess(server);
};

export const backdoor = async (ns: NS, server: string): Promise<boolean> => {
  const object = ns.getServer(server);
  if (object.backdoorInstalled) return true;
  
  rootServer(ns, server);
  if ((object.requiredHackingSkill ?? 0) > ns.getHackingLevel() || !ns.hasRootAccess(server)) return false;

  await connectTo(ns, server);
  const promise = outsource(ns, "singularity.installBackdoor");
  await outsource(ns, "singularity.connect", "home");
  
  return new Promise(res => promise.finally(() => res(ns.getServer(server).backdoorInstalled ?? true)));
}

const connectTo = async (ns: NS, server: string): Promise<boolean> => {
  const connections = new Map<string, string[]>(getAllServers(ns).map(s => [s, ns.scan(s)]));
  const path: string[] = [server];

  while (path[0] !== "home") {
    const parent = Array.from(connections.entries()).find(a => a[1].includes(path[0]));
    if (parent === undefined) return false;
    path.unshift(parent[0]);
  }

  for (const step of path) if(!await outsource(ns, "singularity.connect", step)) return false;
  return true;
};