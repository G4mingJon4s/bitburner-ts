export const FILEPATH = "util/execute.ts";

export async function main(ns: NS): Promise<void> {
	while ((globalThis as any)[`NS-${ns.pid}`] === undefined) await ns.asleep(1);
	const [task, report] = (globalThis as any)[`NS-${ns.pid}`] as [(ns: NS) => Promise<any>, (result: any) => void];
	const result = await task(ns);
	ns.atExit(() => {
		delete (globalThis as any)[`NS-${ns.pid}`];
		report(result);
	});
}

type ExecuteOptions = {
	ram: number;
	threads?: number;
	host?: string;
  description?: string;
}

export function execute<T>(ns: NS, options: ExecuteOptions, task: (ns: NS) => Promise<T>): Promise<T> {
	return new Promise((res, rej) => {
		const host = options.host ?? ns.getHostname();
		ns.scp(FILEPATH, host, "home");
    
		const pid = ns.exec(
			FILEPATH,
			host,
			{
				ramOverride: options.ram,
				temporary: true,
				threads: options.threads || 1,
			}
		);
		if (pid === 0) rej(
      `Failed to execute on '${host}' for a total of ${options.ram * (options.threads || 1)} GB. Task: ${options.description ?? "No description provided"}`
    );
		(globalThis as any)[`NS-${pid}`] = [task, res];

    const check = () => {
      if (ns.isRunning(pid)) return setTimeout(check, 100);
      return void rej("No response");
    }
    check();
	});
}

export const getRamCost = (ns: NS, functions: string[]): number => 1.6 + functions.reduce((acc, func) => acc + ns.getFunctionRamCost(func), 0);