import { execute, getRamCost } from "util/execute";
import { createProtocol } from "util/protocol";
import * as t from "util/schema";
import { isNormalServer } from "util/servers";
import { isLatestCrawler } from "darknet/util";

export type Context = {
    seenServers: Set<string>;
    watchingServers: Set<string>;
    passwords: Map<string, string>;
    unmappedPasswords: Set<string>;
    serverLocks: Map<string, number>;
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

const makeDictionary = (path: string) => p.router({
    get: p.create()
    .output(t.string().array())
    .resolver(({ ns }) => () => execute(ns, { ram: getRamCost(ns, ["fileExists"]) }, async ns => {
        const exists = ns["fileExists"](path);
        if (!exists) return [];

        return ns.read(path).split("\n");
    })),
    add: p.create()
    .input(t.string().array())
    .resolver(({ ns }) => lines => execute(ns, { ram: getRamCost(ns, ["fileExists"]) }, async ns => {
        const exists = ns["fileExists"](path);
        if (!exists) return ns.write(path, lines.join("\n"), "w");

        const dictionary = ns.read(path).split("\n");
        dictionary.push(...lines.filter(l => !dictionary.includes(l)));
        ns.write(path, dictionary.join("\n"), "w");
    })),
});

export const AllDictionaries = ["factory", "common", "dog"] as const;
const dictionary = Object.fromEntries(
    AllDictionaries.map((k) => [k, makeDictionary(`data/darknet/dictionary/${k}.txt`)])
) as { [K in typeof AllDictionaries[number]]: ReturnType<typeof makeDictionary>; };

const passwords = p.router({
    getPassword: p.create()
    .input(t.string())
    .output(t.string().optional())
    .resolver(({ ctx }) => async server => ctx.passwords.get(server)),
    setPassword: p.create()
    .input(t.object({
        hostname: t.string(),
        password: t.string(),
    }))
    .resolver(({ ctx, ns }) => async data => {
        ns.print(`SUCCESS Found password '${data.password}' for '${data.hostname}'`);
        ctx.unmappedPasswords.delete(data.password);
        ctx.serverLocks.delete(data.hostname);
        ctx.passwords.set(data.hostname, data.password);
    }),
    reportIncorrectPassword: p.create()
    .input(t.string())
    .resolver(({ ctx, ns }) => async server => {
        ns.print(`Found invalid password '${ctx.passwords.get(server)}' for '${server}'`);
        ctx.passwords.delete(server);
    }),
    getUnmappedPasswords: p.create()
    .output(t.string().array())
    .resolver(({ ctx }) => async () => Array.from(ctx.unmappedPasswords)),
    reportUnmappedPassword: p.create()
    .input(t.string())
    .resolver(({ ctx }) => async password => void ctx.unmappedPasswords.add(password)),
});

const solving = p.router({
    getServerLock: p.create()
    .input(t.string())
    .output(t.boolean())
    .resolver(({ ctx, ns, origin }) => async server => {
        const pid = ctx.serverLocks.get(server);
        if (pid !== undefined && ns.isRunning(pid)) return false;

        ctx.serverLocks.set(server, origin);
        return true;
    }),
    hasServerLock: p.create()
    .input(t.string())
    .output(t.boolean())
    .resolver(({ ctx, ns }) => async server => {
        const pid = ctx.serverLocks.get(server);
        return pid !== undefined && ns.isRunning(pid);
    }),
    watchServer: p.create()
    .input(t.string())
    .resolver(({ ctx }) => async server => void ctx.watchingServers.add(server)),
    isWatchingServer: p.create()
    .input(t.string())
    .output(t.boolean())
    .resolver(({ ctx })=> async server => ctx.watchingServers.has(server)),
});

export const app = p.router({
    dictionary,
    passwords,
    solving,

    onboard: p.create()
    .input(t.object({
        hostname: t.string(),
        currentVersion: t.string(),
    }))
    .output(OnboardReturnSchema)
    .resolver(({ ctx, ns }) => async data => {
        const obj = await execute(ns, { ram: getRamCost(ns, ["getServer"]) }, async ns => ns["getServer"](data.hostname));
        if (isNormalServer(obj)) throw new Error("darknet/crawl.ts running on normal server?");

        ctx.seenServers.add(data.hostname);
        ctx.watchingServers.delete(data.hostname);

        const versionData = isLatestCrawler(ns, data.currentVersion);
        if (!versionData.latestVersion) return versionData;

        return { latestVersion: true } as const;
    }),
    getSeenServers: p.create()
    .output(t.string().array())
    .resolver(({ ctx }) => async () => Array.from(ctx.seenServers)),

    genericLog: p.create()
    .input(t.string())
    .resolver(({ origin, ns }) => async line => {
        ns.print(`${origin}: ${line}`);
    }),
    fileLog: p.create()
    .input(t.object({
        filename: t.string(),
        content: t.string()
    }))
    .resolver(({ origin, ns }) => async data => ns.write(`data/darknet/files/${data.filename}/${origin}.txt`, data.content, "w")),
    reportExample: p.create()
    .input(t.object({
        modelId: t.string(),
        content: t.string()
    }))
    .resolver(({ ns }) => async data => {
        const path = `data/darknet/examples/${data.modelId.replaceAll(" ", "_").replaceAll(";", "ü")}.txt`;
        if (ns.fileExists(path)) return;

        ns.write(path, data.content, "w");
    }),
});