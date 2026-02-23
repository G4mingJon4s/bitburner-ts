import { app, p } from "darknet/main";

function updateSelf(ns: NS) {
    ns.spawn("darknet/crawl.ts", { spawnDelay: 500, temporary: true }, ...ns.args);
    ns.exit();
}

function crawl(ns: NS, hostname: string) {
    const copied = ns.scp(["darknet/crawl.ts"], hostname, "home");
    const pid = ns.exec("darknet/crawl.ts", hostname, { temporary: true }, ...ns.args);
    return copied && pid !== 0;
}

export async function main(ns: NS) {
    const client = p.client(ns, app);
    const proc = ns.self();

    const result = await client.onboard({ hostname: proc.server, currentVersion: ns.read("darknet/crawl.ts") });
    if (!result.latestVersion) return updateSelf(ns);

    await client.genericLog("Crawler working on the latest version!");

    for (const n of ns.dnet.probe()) {
        const details = ns.dnet.getServerAuthDetails(n);
        if (!details.isConnectedToCurrentServer || !details.isOnline) continue;

        const procs = ns.ps(n);
        if (procs.some(a => a.filename === "darknet/crawl.ts")) continue;

        await client.genericLog(`Found '${n}' (${details.modelId}) ${JSON.stringify(details.data)}`);

        const cached = await client.getPassword(n);
        const attempt = cached !== undefined ? await ns.dnet.authenticate(n, cached) : await ns.dnet.authenticate(n, n);
        if (cached !== undefined && !attempt.success) await client.reportIncorrectPassword(n);

        if (attempt.success) {
            const success = crawl(ns, n);
            if (!success) await client.genericLog(`Failed to crawl to '${n}'`);
        }
    }

    await client.genericLog("Tried all neighbors...");
}