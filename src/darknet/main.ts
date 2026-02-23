import { createProtocol } from "util/protocol";
import * as t from "util/schema";
import { isLatestCrawler } from "darknet/util";
import { isNormalServer } from "util/servers";

type Context = {
    seenServers: Set<string>;
    passwords: Map<string, string>;
};
export const p = createProtocol<Context>({
    port: 1234,
    timeout: 5000,
});

const OnboardReturnSchema = t.union(t.object({
    latestVersion: t.boolean().true(),
}), t.object({
    latestVersion: t.boolean().false(),
    newVersion: t.string(),
}));

export const app = p.router({
    onboard: p.create()
    .input(t.object({
        hostname: t.string(),
        currentVersion: t.string(),
    }))
    .output(OnboardReturnSchema)
    .resolver((ctx, { ns }) => async data => {
        const obj = ns.getServer(data.hostname);
        if (isNormalServer(obj)) throw new Error("darknet/crawl.ts running on normal server?");

        ctx.seenServers.add(data.hostname);

        const versionData = isLatestCrawler(ns, data.currentVersion);
        if (!versionData.latestVersion) return versionData;

        return { latestVersion: true } as const;
    }),
    genericLog: p.create()
    .input(t.string())
    .resolver((_, { origin, ns }) => async line => {
        ns.print(`${origin}: ${line}`);
    }),
    getPassword: p.create()
    .input(t.string())
    .output(t.string().optional())
    .resolver(ctx => async server => ctx.passwords.get(server)),
    setPassword: p.create()
    .input(t.object({
        hostname: t.string(),
        password: t.string(),
    }))
    .resolver((ctx, { ns }) => async data => {
        ns.print(`Found password '${data.password}' for '${data.hostname}'`);
        ctx.passwords.set(data.hostname, data.password);
    }),
    reportIncorrectPassword: p.create()
    .input(t.string())
    .resolver((ctx, { ns }) => async server => {
        ns.print(`Found invalid password '${ctx.passwords.get(server)}' for '${server}'`);
        ctx.passwords.delete(server);
    }),
});

export async function main(ns: NS) {
    ns.disableLog("ALL");
    ns.clearLog();
    ns.ui.openTail();

    const server = p.server(app, {
        seenServers: new Set(),
        passwords: new Map(),
    });

    ns.atExit(() => {
        for (const s of server.context.seenServers) {
            ns.scriptKill("darknet/crawl.ts", s);
        }
    });

    while (true) {
        await ns.asleep(200);
        await server.tick(ns);

        let anyCrawlerRunning = false;
        for (const s of server.context.seenServers) {
            const obj = ns.getServer(s);
            if (isNormalServer(obj)) continue;
            if (!obj.isOnline) continue;

            const procs = ns.ps(s);
            if (procs.some(p => p.filename === "darknet/crawl.ts")) {
                anyCrawlerRunning = true;
                break;
            }
        }

        if (!anyCrawlerRunning) {
            ns.print("Seeding network...");

            const copied = ns.scp(["darknet/crawl.ts"], "darkweb", "home");
            const pid = ns.exec("darknet/crawl.ts", "darkweb", { temporary: true });
            if (!copied || pid === 0) throw new Error("Can't seed crawler to darkweb");
        }
    }
}