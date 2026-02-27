import type { ProtocolClient } from "util/protocol";
import type { app, Context } from "darknet/app";

export async function extractFile(ns: NS, client: ProtocolClient<Context, typeof app>, filename: string) {
    const rawContent = ns.read(filename);
    const content = new DOMParser().parseFromString(rawContent, "text/html").body.textContent || "";
    if (content === "") return;

    const factoryString = "Some common passwords include";
    if (content.startsWith(factoryString)) {
        const passwords = content.slice(factoryString.length).trim().split(", ");
        await client.dictionary.factory.add(passwords);
        return true;
    }

    const dogString = "What should I name my dog? Maybe";
    if (content.startsWith(dogString)) {
        const dogs = content.slice(dogString.length, -1).trim().split(", ");
        await client.dictionary.dog.add(dogs);
        return true;
    }  

    const rememberString = "Remember this password:";
    if (content.startsWith(rememberString)) {
        const password = content.slice(rememberString.length).trim();
        await client.passwords.reportUnmappedPassword(password);
        return true;
    }

    return false;
}

export async function extractPacket(ns:NS, client: ProtocolClient<Context, typeof app>, string: string): Promise<{ hostname: string; password: string; } | null> {
    const servers = await client.getSeenServers();

    const foundServer = servers.map<[string, number]>(s => [s, string.indexOf(s + ":")]).find(i => i[1] !== -1);
    if (foundServer === undefined) return null;

    const passEnd = string.indexOf(" ", foundServer[1]);
    await client.genericLog("Captured a password!");
    return { hostname: foundServer[0], password: string.slice(foundServer[1] + foundServer[0].length + 1, passEnd)};
}