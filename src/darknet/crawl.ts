import { app, p } from "darknet/app";
import { crackServer } from "darknet/password";
import { extractFile, extractPacket } from "darknet/parsing";

function updateSelf(ns: NS) {
    const oldRam = ns.ramOverride();
    const newRam = ns.ramOverride(oldRam + ns.getFunctionRamCost("spawn"));
    if (oldRam === newRam) throw new Error(`Failed to upgrade ram usage from ${oldRam} to ${newRam} to update!`);
    ns["spawn"]("darknet/crawl.ts", { spawnDelay: 500, temporary: true }, ...ns.args);
}

function crawl(ns: NS, hostname: string) {
    if (ns.ps(hostname).some(p => p.filename === "darknet/crawl.ts")) return true;
    const copied = ns.scp(["darknet/crawl.ts"], hostname, "home");
    const pid = ns.exec("darknet/crawl.ts", hostname, { temporary: true }, ...ns.args);
    return copied && pid !== 0;
}

export async function main(ns: NS) {
    const client = p.client(ns, app);
    const proc = ns.self();

    const result = await client.onboard({ hostname: proc.server, currentVersion: ns.read("darknet/crawl.ts") });
    if (!result.latestVersion) return updateSelf(ns);

    const files = ns.ls(ns.self().server);
    for (const file of files) {
        if (file.endsWith("ts")) continue;
        if (file.endsWith("cct")) continue;
        if (file.endsWith("cache")) {
            const result = ns.dnet.openCache(file);
            if (!result.success) {
                await client.genericLog(`ERROR Couldn't open cache '${file}'`);
                continue;
            }

            await client.genericLog(`SUCCESS Opened cache '${file}' MSG: '${result.message}' KARMA: ${result.karmaLoss.toFixed(2)}`);
            continue;
        }

        const extracted = await extractFile(ns, client, file);
        if (!extracted) await client.fileLog({
            filename: file,
            content: ns.read(file),
        });
    }

    while (true) {
        await ns.asleep(100);

        const neighbors = ns.dnet.probe();
        for (const neighbor of neighbors) {
            const dt = ns.dnet.getServerAuthDetails(neighbor);
            const r = await ns.dnet.heartbleed(neighbor, { logsToCapture: 100, peek: true });
            if (r.success) {
                const msgs = r.logs.filter(s => s.includes('"code":401') && s.includes('"passwordAttempted":'));
                if (msgs.length !== 0) await client.reportExample({
                    modelId: dt.modelId,
                    content: msgs[Math.floor(Math.random() * msgs.length)],
                });
            }
            if (!await client.solving.isWatchingServer(neighbor)) continue;

            const packet = await ns.dnet.packetCapture(neighbor);
            if (!packet.success) continue;

            const result = await extractPacket(ns, client, packet.data);
            if (result !== null) await client.passwords.setPassword(result);
        }

        const availableNeighbors = [];
        for (const neighbor of neighbors) {
            if (await client.solving.hasServerLock(neighbor)) continue;
            availableNeighbors.push(neighbor);
        }

        const neighbor = availableNeighbors[Math.floor(Math.random() * availableNeighbors.length)];

        const details = ns.dnet.getServerAuthDetails(neighbor);
        if (!details.isConnectedToCurrentServer || !details.isOnline) continue;

        const procs = ns.ps(neighbor);
        if (procs.some(a => a.filename === "darknet/crawl.ts")) continue;

        if (!await client.solving.getServerLock(neighbor)) continue;

        const gotSession = await crackServer(ns, client, neighbor);

        if (gotSession) {
            const success = crawl(ns, neighbor);
            if (!success) await client.genericLog(`Failed to crawl to '${neighbor}'`);
        }

        const blocked = ns.dnet.getBlockedRam();
        if (blocked !== 0) await ns.dnet.memoryReallocation();
    }
}