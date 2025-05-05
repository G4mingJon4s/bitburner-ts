export async function main(ns: NS) {
  const implemented = Object.keys(solvers) as (keyof Signatures)[];
  const unimplemented = Object.values(ns.enums.CodingContractName).filter(a => !implemented.includes(a));
  printDescription(ns, implemented.at(-1)!);
  printDescription(ns, unimplemented[0]);

  for (const contract of implemented) {
    const result = await testSolver(ns, contract);
    ns.tprint(`Contract '${contract}': ${result.success} / ${result.cases} (${(result.rate * 100).toFixed(2)}%)`);
    if (result.failing.length !== 0) console.log(result.failing);
  }
}

const printDescription = (ns: NS, contract: string) => {
  const fn = ns.codingcontract.createDummyContract(contract);
  const desc = ns.codingcontract.getDescription(fn, "home");
  console.log(desc);
  ns.rm(fn);
}

export async function testSolver<K extends keyof Signatures>(ns: NS, contract: K, cases = 100) {
  const solver = solvers[contract];
  if (solver === undefined) throw new Error(`Given contract '${contract}' is not implemented.`);

  let success = 0;
  const failing: any[] = [];
  for (let i = 0; i < cases; i++) {
    await ns.asleep(1);

    const filename = ns.codingcontract.createDummyContract(contract);
    const handle = ns.codingcontract.getContract(filename, "home");
    assertContractType(handle, contract);

    await (async () => {
      const result = solver(handle.data);
      const reward = handle.submit(result);
      if (reward !== "") success++;
      else failing.push(handle.data);
    })()
      .catch(e => ns.tprint(`Error in contract '${contract}'\n`, e))
      .finally(() => ns.rm(filename, "home"));
  }

  return {
    success,
    rate: success / cases,
    cases,
    failing,
  };
}

export function assertContractType<K extends keyof Signatures>(
  obj: CodingContractObject,
  contract: K
): asserts obj is CodingContractObject & {
  type: K;
  submit: (answer: Signatures[K][1]) => string; // This shouldn't be needed?
} {
  if (obj.type === contract) return;
  throw new Error(`Passed contract object is not of type '${contract}', found ${obj.type}.`);
}

export type Signatures = CodingContractSignatures;
export type Solver<K extends keyof Signatures> = (data: Signatures[K][0]) => Signatures[K][1];

export const solvers: Partial<{
  [K in keyof Signatures]: Solver<K>
}> = {
  "Algorithmic Stock Trader I": data => {
    let buy = data[0];
    let sell = data[1];

    let max = 0;
    for (const price of data) {
      if (price < buy) {
        max = Math.max(sell - buy, max);
        buy = price;
        sell = price;
        continue;
      }

      sell = Math.max(price, sell);
    }

    max = Math.max(sell - buy, max, 0);
    return max;
  },
  "Algorithmic Stock Trader II": data => {
    let profit = 0;

    let buy = -1;
    let i = 0;
    while (i !== data.length) {
      if (buy === -1) {
        if (i === data.length - 1) break;
        if (data[i + 1] > data[i]) buy = data[i];
        i++;
        continue;
      }

      if (i === data.length - 1 || data[i + 1] < data[i]) {
        profit += data[i] - buy;
        buy = -1;
      }
      i++;
    }

    return profit;
  },
};