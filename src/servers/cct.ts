import { BinaryHeap } from "util/heap.ts";
import { getAllServers } from "util/servers.ts";

export async function main(ns: NS) {
  await testAll(ns);
}

export const getAllContracts = (ns: NS) => getAllServers(ns).flatMap(a => ns.ls(a, ".cct").map(b => [a, b])).map(([a, b]) => ns.codingcontract.getContract(b, a));

type Solvers = {
  [K in keyof CodingContractSignatures]: (input: CodingContractSignatures[K][0]) => CodingContractSignatures[K][1];
};

export async function testAll(ns: NS, amt = 100) {
  for (const key of Object.keys(solvers) as (keyof typeof solvers)[]) {
    await ns.asleep(10);

    let success = 0;
    for (let i = 0; i < amt; i++) {
      await ns.asleep(1);

      const fn = ns.codingcontract.createDummyContract(key);
      const input = ns.codingcontract.getData(fn, "home");

      const ans = solvers[key]!(input as never);

      const res = ns.codingcontract.attempt(ans, fn, "home");
      if (res !== "") {
        success++;
      }
    }

    ns.tprint(`Contract '${key}': ${success === amt ? "SUCCESS" : `FAIL (${success} / ${amt})` }`);
  }
}

export const solvers: Partial<Solvers> = {
  "Square Root": num => {
    let l = 0n, r = num / 2n;

    let m = (l + r) / 2n;
    while (m * m !== num && l <= r) {
      if (m * m < num) {
        l = m + 1n;
      } else {
        r = m - 1n;
      }

      m = (l + r) / 2n;
    }

    return m;
  },
};