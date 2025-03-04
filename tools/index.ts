import { watchDir } from "./files/watcher";
import { createEndpoint, getRemote } from "./api/server";

const port = process.env["PORT"] ?? null;
if (port === null) throw new Error("No port specified in env");

const ac = new AbortController();

const server = createEndpoint(Number.parseInt(port));
watchDir("./src", getRemote, ac.signal);
process.on("exit", () => {
  ac.abort("Shutdown");

  server.stop();
});