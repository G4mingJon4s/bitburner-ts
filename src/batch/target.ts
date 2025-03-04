import { getAllServers } from "util/servers.ts";
import { type BatchHosts, type BatchInfo, calculateBatchThreads } from "./util.ts";
import { format } from "util/format.ts";

export async function main(ns: NS): Promise<void> {
	const hosts: BatchHosts = {
		weaken: "home",
		grow: "home",
		hack: "home",
	};

  const fullInfo = getTargetMetadata(ns, hosts);

	fullInfo.sort((a, b) => b.score - a.score);
  ns.tprintf("%s", format.table([
    ["Server", "RAM", "Money", "WeakenTime", "Chance", "Score"],
    ...fullInfo.map(d => [
      d.target,
      format.ram(d.ram),
      format.number(d.money),
      format.time(d.time),
      format.number(d.chance * 100) + "%",
      format.number(d.score)
    ])
  ], {
    head: "inline",
    divider: "dense",
    headInset: 0
  }).join("\n"));
}

export function getTargetMetadata(ns: NS, hosts: BatchHosts) {
	const servers = getAllServers(ns).filter(server => ns.getServer(server).moneyMax !== undefined);

	const rawInfo: ((BatchInfo & { ram: number; numPossible: number; }) | null)[] = servers.map(server => {
		const threads = calculateBatchThreads(ns, server, hosts);
    if (threads === null) return null;

		return {
			target: server,
			threads,
			hosts,
			ram: threads.ram,
			numPossible: threads.numPossible,
		};
	});

  const filterNull = (i: (BatchInfo & { ram: number; numPossible: number; }) | null): i is BatchInfo & { ram: number; numPossible: number; } => i !== null;
  const infos = rawInfo.filter(filterNull);

	const fullInfo: (BatchInfo & {
		ram: number;
    money: number;
		numPossible: number;
		amountStolen: number;
		chance: number;
		time: number;
		score: number;
	})[] = infos.map(info => {
		const server = ns.getServer(info.target);
		server.moneyAvailable = server.moneyMax;
		server.hackDifficulty = server.minDifficulty;

		const amountStolen = ns.formulas.hacking.hackPercent(server, ns.getPlayer()) * info.threads.hack;
		const chance = ns.formulas.hacking.hackChance(server, ns.getPlayer());
		const weakenTime = ns.formulas.hacking.weakenTime(server, ns.getPlayer());

		return {
			...info,
			amountStolen,
			money: amountStolen * server.moneyMax!,
			chance,
			time: weakenTime,
			score: amountStolen * server.moneyMax! * chance / (info.ram * (weakenTime / 1000)),
		};
	});

  return fullInfo;
}