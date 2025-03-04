import { execute, getRamCost } from "util/execute.ts";
import { outsource } from "util/do.ts";

interface Instance {
  server: string;
  done: boolean;
  promise: Promise<void>;
  abort: () => void;
}

export async function setStanekConfiguration(ns: NS, config: ActiveFragment[]): Promise<void> {
  ns.stanek.clearGift();
  for (const frag of config) await outsource(ns, "stanek.placeFragment", frag.x, frag.y, frag.rotation, frag.id);
}

export async function getStanekConfiguration(ns: NS): Promise<ActiveFragment[]> {
  return await outsource(ns, "stanek.activeFragments");
}

export async function main(ns: NS): Promise<void> {
  if (ns.args.length === 0) {
    return ns.tprint("No command provided. Available commands are 'apply', 'save' or 'default'.");
  }
  if (ns.args[0] === "apply") {
    let name = ns.args[1];
    if (name === undefined || typeof name !== "string") return ns.tprint("You need to provide a configuration to use.");
    if (name === "default") name = ns.read("data/stanek/default.txt");
    if (!ns.fileExists(`data/stanek/config/${name}.txt`)) return ns.tprint("This configuration does not exist.");
    const config = JSON.parse(ns.read(`data/stanek/config/${name}.txt`));
    if (config === undefined || config === null || !Array.isArray(config)) return ns.tprint("Error while trying to parse config. Are you sure a configuration is stored there?");
    const answer = await ns.prompt("Are you sure you want to overwrite the current stanek configuration? This change is irreversible.", { type: "boolean" });
    if (!answer) return ns.tprint("Aborted.");
    await setStanekConfiguration(ns, config);
    return ns.tprint(`Applied configuration '${name}'.`);
  }
  if (ns.args[0] === "save") {
    const config = await getStanekConfiguration(ns);
    const name = ns.args[1];
    if (name === undefined || typeof name !== "string") return ns.tprint("You need to provide a name to save the configuration.");
    if (name === "default") return ns.tprint("You cannot save a configuration under the name 'default'.");
    ns.write(`data/stanek/config/${name}.txt`, JSON.stringify(config), "w");
    ns.tprint(`Saved configuration to 'data/stanek/config/${name}.txt'.`);
    return;
  }
  if (ns.args[0] === "default") {
    const name = ns.args[1];
    if (name === undefined || typeof name !== "string") return ns.tprint("You need to provide a name to set as a default configuration.");
    if (!ns.fileExists(`data/stanek/config/${name}.txt`)) return ns.tprint("This configuration does not exist.");
    ns.write("data/stanek/default.txt", name, "w");
    ns.tprint(`Set 'data/stanek/config/${name}.txt' as the default configuration.`);
    return;
  }
  ns.tprint("Invalid command provided.");
}

export function autocomplete(data: AutocompleteData, flags: string[]) {
  const commands = ["apply", "save", "default"];
  if (flags.length === 0 || (flags.length === 1 && !commands.includes(flags[0]) && commands.some(s => s.startsWith(flags[0])))) return commands;
  const configs = data.txts
    .map(s => s.match(/^data\/stanek\/config\/(.+)\.txt/))
    .filter((a: RegExpMatchArray | null): a is RegExpMatchArray => a !== null && a.length === 2)
    .map(a => a[1]);
  if (flags[0] === "apply") ["default", ...configs];
  return configs;
}

export async function configureStanek(ns: NS): Promise<void> {
  let name = "";
  if (ns.fileExists("data/stanek/default.txt")) name = ns.read("data/stanek/default.txt");
  else name = ns.ls(ns.getHostname(), "data/stanek/config/")
    .map(s => s.match(/^data\/stanek\/config\/(.+)\.txt/))
    .filter((a: RegExpMatchArray | null): a is RegExpMatchArray => a !== null && a.length === 2)
    .map(a => a[1])[0];
  if (name === undefined) throw new Error("No available configuration to apply.");
  const config = JSON.parse(ns.read(`data/stanek/config/${name}.txt`));
  if (config === undefined || config === null || !Array.isArray(config)) throw new Error("Error while parsing configuration.");
  await setStanekConfiguration(ns, config);
}

export function createStanekInstance(ns: NS, active: ActiveFragment[], duration = 10_000): (server: string) => Instance {
  return server => {
    const controller = new AbortController();
    const ram = getRamCost(ns, ["stanek.chargeFragment"]);
    const threads = Math.floor(ns.getServerMaxRam(server) / ram);

    const instance: Instance = {
      server,
      done: false,
      promise: Promise.resolve(),
      abort: () => controller.abort()
    };

    if (active.length === 0 || threads === 0) {
      const promise = ns.asleep(1000).then(() => {}).finally(() => { instance.done = true; });
      instance.promise = promise;

      return instance;
    }

    const fragment = active.filter(f => f.id < 100).reduce((acc, cur) => acc.numCharge > cur.numCharge ? cur : acc);
  
    const promise = execute<void>(ns, {
      threads,
      host: server,
      ram,
      description: "StanekInstance"
    }, async ns => {
      const start = Date.now();
      while (!controller.signal.aborted && Date.now() - start < duration) await ns["stanek"]["chargeFragment"](fragment.x, fragment.y)
    }).catch(r => {
      if (controller.signal.aborted) return;
      throw r;
    }).finally(() => { instance.done = true; });
    instance.promise = promise;

    return instance;
  };
}