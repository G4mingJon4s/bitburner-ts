export function isLatestCrawler(ns: NS, check: string): { latestVersion: true; } | { latestVersion: false; newVersion: string; } {
    const latest = ns.read("darknet/crawl.ts");
    if (latest === check) return { latestVersion: true };
    return { latestVersion: false, newVersion: latest };
}