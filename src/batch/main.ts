import { batch, batchFits, type BatchHosts, type BatchResult, calculateBatchThreads, isPrepped, prep } from "./util.ts";
import { format } from "util/format.ts";
import { p, router, reserveServer, EXCLUDEDSERVERS } from "servers/control.ts";
import { getTargetMetadata } from "batch/target.ts";
import { getAllServers } from "util/servers.ts";

const MAX = 50_000;
const MIN_OFFSET = 25;
const LEVEL_TOLERANCE = 8;

export function autocomplete(data: AutocompleteData) {
  return [...data.servers, "--xp"];
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.clearLog();
  ns.tail();
  ns.resizeTail(350, 150);

  const allServers = getAllServers(ns).filter(s => !EXCLUDEDSERVERS.includes(s));

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

    let batches = 0;
    const start = Date.now();
    const batchLogs: [number, BatchResult][] = [];
    const hackingLevel = ns.getHackingLevel();
    const threads = calculateBatchThreads(ns, target, hosts);
    if (threads === null) {
      ns.print(`ERROR: NO FITTING THREADS FOR ${target}`);
      continue;
    }

    let desync = false;
    const xpMode = ns.args.includes("--xp");
    if (xpMode) threads.hack = Math.floor(threads.hack * 0.8); // makes sure the security can always bounce back
    while (xpMode || (!desync && Math.abs(hackingLevel - ns.getHackingLevel()) < LEVEL_TOLERANCE)) {
      await ns.asleep(1);

      const moneyGain = batchLogs.length === 0 ? 0 : batchLogs.reduce(
        (acc, cur) => acc + cur[1].moneyGained,
        0
      ) / batchLogs.length;
      const timeSpent = batchLogs.reduce((acc, cur) => acc + cur[1].timeElapsed, 0);

      const batchRate = batchLogs.length * 1000 / (Date.now() - start);

      const timeAvg = batchLogs.length === 0 ? 0 : timeSpent / batchLogs.length;
      const timeDev = batchLogs.length === 0 ? 0 : Math.sqrt(
        batchLogs.reduce((acc, cur) => acc + Math.pow(cur[1].timeElapsed - timeAvg, 2), 0) / batchLogs.length
      );

      ns.clearLog();
      ns.print(`TARGET: ${target}`);
      ns.print("--BATCH PHASE--");
      ns.print(`TIME  SPENT: ${format.time(Date.now() - start)}s`);
      ns.print(`BATCH  TIME: μ = ${Math.round(timeAvg / 100) / 10}s | σ = ${Math.round(timeDev * 10) / 10}ms`);
      ns.print(`BATCH COUNT: ${format.number(batchRate)}/s`);
      ns.print(`MONEY  GAIN: ${format.number(moneyGain)}/b`);
      ns.print(`MONEY / SEC: ${format.number(batchRate * moneyGain)}`);

      while (batches >= MAX || batches >= threads.numPossible || !batchFits(ns, hosts, threads)) await ns.asleep(1);
      if (!isPrepped(ns, target) && !xpMode) {
        desync = true;
        break;
      }
      console.log(`%cSTARTING BATCH: ETA ${Math.ceil(ns.getWeakenTime(target) / 1000)}s`, "color: yellow");
      batches++;
      batch(ns, { target, hosts, threads })
        .catch((e: unknown) => { ns.tprint(`ERROR: Batch rejected with '${JSON.stringify(e)}'.`); desync = true; return null; })
        .then(result => {
          batches--;
          if (result === null) return;
          batchLogs.push([Date.now(), result]);
        });

      const offset = Math.max(ns.getWeakenTime(target) / threads.numPossible, MIN_OFFSET);
      await ns.asleep(offset);
    }
    if (desync) ns.print("ERROR: DESYNC HAPPENED");
    else ns.print("WARN: LEVEL TOLERANCE REACHED");

    ns.print("INFO: WAITING FOR BATCHES");
    while (batches > 0) await ns.asleep(1);

    for (const request of requests) await request();
  }
}