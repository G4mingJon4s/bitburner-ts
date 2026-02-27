import { isNormalServer } from "util/servers";
import { app, p } from "darknet/app";
import * as t from "util/schema";

const LastPasswordsSchema = t.tuple(t.string(), t.string()).array();

export async function main(ns: NS) {
    ns.disableLog("ALL");
    ns.clearLog();
    ns.ui.openTail();

    const server = p.server(app, {
        seenServers: new Set(),
        passwords: new Map(),
        unmappedPasswords: new Set(),
        watchingServers: new Set(),
        serverLocks: new Map(),
    });

    const lastPasswords = JSON.parse(ns.read("data/darknet/lastPasswords.txt") || "null");
    const parsingResult = LastPasswordsSchema.safeParse(lastPasswords);
    if (parsingResult.success) {
        server.context.passwords = new Map(parsingResult.data);
    }

    ns.atExit(() => {
        ns.write("data/darknet/lastPasswords.txt", JSON.stringify(Array.from(server.context.passwords.entries())), "w");

        for (const s of server.context.seenServers) {
            ns.print(`Killing crawlers on '${s}'`);
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