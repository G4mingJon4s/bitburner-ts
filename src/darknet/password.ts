import type { ProtocolClient } from "util/protocol";
import type { app, Context } from "darknet/app";
import * as t from "util/schema";

const isNumber = (c: string) => c.charCodeAt(0) >= 48 && c.charCodeAt(0) <= 57;
const isAlphabet = (c: string) => c.charCodeAt(0) >= 97 && c.charCodeAt(0) <= 122;
const isASCII = (c: string) => c.charCodeAt(0) & 0x80;

const isNumeric = (s: string) => s.split("").every(isNumber);
const isAlphabetic = (s: string) => s.toLowerCase().split("").every(isAlphabet);
const isAlphanumeric = (s: string) => s.toLowerCase().split("").every(c => isNumber(c) || isAlphabet(c));
const isASCIIString = (s: string) => s.split("").every(isASCII);

const isFormat = (s: string, format: ServerAuthDetails["passwordFormat"]) => {
    if (format === "unicode") return true;
    if (format === "ASCII") return isASCIIString(s);
    if (format === "alphanumeric") return isAlphanumeric(s);
    if (format === "alphabetic") return isAlphabetic(s);
    if (format === "numeric") return isNumeric(s);

    return false;
};

function permuteString(s: string): string[] {
    if (s.length <= 1) return [s];

    return permuteString(s.slice(1)).flatMap(p => Array.from({ length: s.length }, (_, i) => `${p.slice(0, i)}${s[0]}${p.slice(i)}`));
}

function romanToDecimal(s: string): number {
    if (s.length === 0) return 0;

    const values = new Map([
        ["M", 1000],
        ["D", 500],
        ["C", 100],
        ["L", 50],
        ["X", 10],
        ["V", 5],
        ["I", 1],
    ]);

    const firstValue = values.get(s[0]);
    if (firstValue === undefined) return -1;
    if (s.length === 1) return firstValue;

    const secondValue = values.get(s[1]);
    if (secondValue === undefined) return -1;

    if (firstValue >= secondValue) return firstValue + romanToDecimal(s.slice(1));
    return (secondValue - firstValue) + romanToDecimal(s.slice(2));
}

const AuthenticateResultSchema = t.object({
    passwordAttempted: t.string(),
    message: t.string(),
    code: t.number(),
    data: t.any(),
});

type SolverType = (data: { ns: NS; client: ProtocolClient<Context, typeof app>; hostname: string; details: ServerAuthDetails; }) => Promise<string[]>;
const solvers: Record<string, SolverType> = {
    "ZeroLogon": async () => [""],
    "FreshInstall_1.0": async ({ client }) => await client.dictionary.factory.get(),
    "Laika4": async ({ client }) => await client.dictionary.dog.get(),
    "DeskMemo_3.1": async ({ details }) => [details.passwordHint.split("").filter(isNumber).join("")],
    "CloudBlare(tm)": async ({ details }) => [details.data.split("").filter(isNumber).join("")],
    "AccountsManager_4.2": async ({ details }) => {
        const sanitized = details.passwordHint.trim().split(" ").filter(isNumeric);
        if (sanitized.length !== 2) return [];

        const lower = Math.max(Number.parseInt(sanitized[0], 10), details.passwordLength === 1 ? 0 : Math.pow(10, details.passwordLength - 1));
        const higher = Math.min(Number.parseInt(sanitized[1], 10), Math.pow(10, details.passwordLength) - 1);

        return Array.from({ length: higher - lower + 1 }, (_, i) => (lower + i).toString());
    },
    "NIL": async ({ ns, hostname, details }) => {
        for (let i = 0; i < 10; i++) {
            const current = ns.dnet.getServerAuthDetails(hostname);
            if (!current.isConnectedToCurrentServer || !current.isOnline) return [];

            await ns.dnet.authenticate(hostname, i.toString().repeat(details.passwordLength));
        }

        const scraped = await ns.dnet.heartbleed(hostname, { logsToCapture: 100, peek: true });
        if (!scraped.success) return [];

        const attempts = scraped.logs.filter(l => l.includes('"code":401'));
        const sorted = Array.from({ length: 10 }, (_, i) => i.toString().repeat(details.passwordLength)).map(f => attempts.find(s => s.includes(f)));
        if (sorted.some(e => e === undefined)) return [];

        const objs = sorted.map(a => AuthenticateResultSchema.safeParse(JSON.parse(a ?? "null")));
        if (objs.some(a => !a.success)) return [];

        const values = objs.map(a => {
            if (!a.success) throw {};
            return a.data;
        })
        .map((o, i) => String(o.data).trim().split(",").map(s => s === "yes" ? i.toString() : ""));
        const chars = values.reduce((acc, cur) => acc.map((d, i) => d + cur[i]), Array.from({ length: details.passwordLength }, () => ""));

        return [chars.join("")];
    },
    "PHP 5.4": async ({ details }) => permuteString(String(details.data)),
    "BellaCuore": async ({ details }) => [romanToDecimal(String(details.data)).toString()],
    "OctantVoxel": async ({ details }) => {
        const parts = String(details.data).split(",");
        if (parts.length !== 2) return [];
        const base = Number.parseInt(parts[0], 10);
        if (Number.isNaN(base)) return [];

        return [Number.parseInt(parts[1], base).toString()];
    },
    "OpenWebAccessPoint": async ({ client, hostname }) => {
        await client.solving.watchServer(hostname);
        return await client.passwords.getUnmappedPasswords();
    },
    "Pr0verFl0": async ({ details }) => ["X".repeat(details.passwordLength * 2)],
};

export async function tryUnmappedPasswords(ns: NS, client: ProtocolClient<Context, typeof app>, hostname: string, maxTries = 10) {
    const details = ns.dnet.getServerAuthDetails(hostname);
    if (!details.isConnectedToCurrentServer || !details.isOnline) return false;
    if (details.hasSession) return true;

    const unmapped = (await client.passwords.getUnmappedPasswords())
    .filter(s => s.length === details.passwordLength && isFormat(s, details.passwordFormat));
    const start = Math.floor(Math.random() * unmapped.length);

    for (let i = 0; i < Math.min(maxTries, unmapped.length); i++) {
        const details = ns.dnet.getServerAuthDetails(hostname);
        if (!details.isConnectedToCurrentServer || !details.isOnline) return false;
        if (details.hasSession) return true;

        const password = unmapped[(start + i) % unmapped.length];
        const result = await ns.dnet.authenticate(hostname, password);

        if (result.success) {
            await client.passwords.setPassword({ hostname, password });
            return true;
        }
    }
}

export async function crackServer(ns: NS, client: ProtocolClient<Context, typeof app>, hostname: string) {
    const details = ns.dnet.getServerAuthDetails(hostname);
    if (!details.isConnectedToCurrentServer || !details.isOnline) return false;
    if (details.hasSession) return true;

    const cached = await client.passwords.getPassword(hostname);
    if (cached !== undefined) {
        const result = await ns.dnet.authenticate(hostname, cached);
        if (result.success) return true;

        await client.passwords.reportIncorrectPassword(hostname);
    }

    const solver = solvers[details.modelId] ?? null;
    if (solver === null) {
        await client.genericLog(`WARN No solver for '${details.modelId}' Hint: '${details.passwordHint}' Data: '${details.data}' Format: ${details.passwordLength} ${details.passwordFormat}`);
        await client.solving.watchServer(hostname);
        return await tryUnmappedPasswords(ns, client, hostname);
    }

    const ignoredTypes = ["Pr0verFl0"];
    const possible = await solver({ ns, client, hostname, details });
    const matching = possible.filter(a => ignoredTypes.includes(details.modelId) || (a.length === details.passwordLength && isFormat(a, details.passwordFormat)));
    if (matching.length === 0) {
        await client.genericLog(`ERROR No solver answers of '${details.modelId}' match this format: ${details.passwordLength} ${details.passwordFormat}`);
        return await tryUnmappedPasswords(ns, client, hostname);
    }

    for (const answer of matching) {
        const current = ns.dnet.getServerAuthDetails(hostname);
        if (!current.isConnectedToCurrentServer || !current.isOnline) return false;
        if (current.hasSession) return true;

        const result = await ns.dnet.authenticate(hostname, answer);
        if (!result.success) continue;

        await client.passwords.setPassword({ hostname, password: answer });
        return true;
    }

    await client.genericLog(`ERROR Solver '${details.modelId}' failed!`);
    return await tryUnmappedPasswords(ns, client, hostname);
}