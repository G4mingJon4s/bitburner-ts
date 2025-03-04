import { batch, batchFits, type BatchHosts, calculateBatchThreads, isPrepped, prep } from "./util.ts";
import { format } from "util/format.ts";
import { p, router, reserveServer, EXCLUDEDSERVERS } from "servers/control.ts";
import { getTargetMetadata } from "batch/target.ts";
import { getAllServers } from "util/servers.ts";

const MAX = 10_000;
const MIN_OFFSET = 100;
const LEVEL_TOLERANCE = 5;

export function autocomplete(data: AutocompleteData) {
  return data.servers;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.clearLog();
  ns.tail();
  ns.resizeTail(350, 170);

  const allServers = getAllServers(ns)
    .filter(s => !EXCLUDEDSERVERS.includes(s)
      && ns.getServer(s).moneyMax !== undefined
      && ns.getServer(s).moneyMax !== 0
    );

  const client = p.client(ns, router);

  while (true) {
    await ns.asleep(1000);

    const blockedHosts = await client.blocked();
    const possibleHosts = allServers.filter(s => !blockedHosts.includes(s) && ns.hasRootAccess(s));
    possibleHosts.sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a));
    if (possibleHosts.length < 3) {
      ns.print(`ERROR: NOT ENOUGH HOSTS, RECIEVED ${possibleHosts.length}/3`);
      continue;
    }
    const hosts: BatchHosts = {
      hack: possibleHosts[0],
      grow: possibleHosts[1],
      weaken: possibleHosts[2],
    };

    let metadata = getTargetMetadata(ns, hosts);
    let target = metadata.reduce((acc, cur) => acc.score > cur.score ? acc : cur).target;

    const requests = [
      await reserveServer(client, hosts.weaken),
      await reserveServer(client, hosts.grow),
      await reserveServer(client, hosts.hack)
    ];

    await ns.asleep(1000);

    console.warn("CYCLE");
    if (!isPrepped(ns, target)) console.log("%cPREPPING", "color: orange");
    while (!isPrepped(ns, target)) {
      ns.clearLog();
      ns.print(`TARGET: ${target}`);
      ns.print("--PREP  PHASE--");
      ns.print(`WEAKEN TIME : ${format.time(ns.getWeakenTime(target))}s`);
      ns.print(`GROW   TIME : ${format.time(ns.getGrowTime(target))}s`);
      ns.print(`SERVER MONEY: ${Math.round(100 * (ns.getServer(target).moneyAvailable! / ns.getServer(target).moneyMax!))}%`);
      ns.print(`SERVER SEC  : +${format.number(ns.getServer(target).hackDifficulty! - ns.getServer(target).minDifficulty!)}`);

      await prep(ns, {
        target,
        hosts,
      });
    }

    const batches: Promise<boolean>[] = [];
    const hackingLevel = ns.getHackingLevel();
    const threads = calculateBatchThreads(ns, target, hosts);
    if (threads === null) {
      ns.print(`ERROR: NO FITTING THREADS FOR ${target}`);
      continue;
    }

    let desync = false;
    while (!desync && Math.abs(hackingLevel - ns.getHackingLevel()) < LEVEL_TOLERANCE) {
      await ns.asleep(1);

      ns.clearLog();
      ns.print(`TARGET: ${target}`);
      ns.print("--BATCH PHASE--");
      ns.print(`WEAKEN TIME: ${format.time(ns.getWeakenTime(target))}s`);
      ns.print(`GROW   TIME: ${format.time(ns.getGrowTime(target))}s`);
      ns.print(`HACK   TIME: ${format.time(ns.getHackTime(target))}s`);
      ns.print(`MONEY  GAIN: ${format.number((ns.hackAnalyzeChance(target) * ns.getServer(target).moneyMax! * ns.hackAnalyze(target) * threads.hack * threads.numPossible * 1000) / ns.getWeakenTime(target))}/s`);

      if (batches.length >= MAX || batches.length > threads.numPossible || !batchFits(ns, hosts, threads)) await batches.shift();
      else {
        if (!isPrepped(ns, target)) {
          desync = true;
          break;
        }
        console.log(`%cSTARTING BATCH: ETA ${Math.ceil(ns.getWeakenTime(target) / 1000)}s`, "color: yellow");
        batches.push(batch(ns, {
          target,
          hosts,
          threads,
        }).catch((e: unknown) => { ns.tprint(`ERROR: Batch rejected with '${JSON.stringify(e)}'.`); desync = true; return false; }));
      }

      const offset = Math.max(ns.getWeakenTime(target) / threads.numPossible, MIN_OFFSET);
      await ns.asleep(offset);
    }
    if (desync) ns.print("ERROR: DESYNC HAPPENED");
    else ns.print("WARN: LEVEL TOLERANCE REACHED");

    ns.print("INFO: WAITING FOR BATCHES");
    await Promise.allSettled(batches);

    for (const request of requests) await request();
  }
}