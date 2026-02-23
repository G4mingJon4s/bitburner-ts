export async function crackServer(ns: NS, host: string) {
    const details = ns.dnet.getServerAuthDetails(host);
    if (!details.isConnectedToCurrentServer || !details.isOnline) return false;
    if (details.hasSession) return true;
}