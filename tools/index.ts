import { pushAllScripts, watchDir } from "./files/watcher";
import { ConnectionTarget, createEndpoint, getRemote } from "./api/server";

const srcDir = "./src";
const port = process.env["PORT"] ?? null;
if (port === null) throw new Error("No port specified in env");

const pushOnConnection = process.env["PUSH_ON_CONNECTION"]?.toLowerCase() === "true";
console.log(`Push on connection is ${pushOnConnection ? "active" : "inactive"}`);

const ac = new AbortController();

const server = createEndpoint(Number.parseInt(port));
watchDir(srcDir, getRemote, ac.signal);
ConnectionTarget.addEventListener("connect", async () => {
  if (!pushOnConnection) return;

  const remote = getRemote();
  if (remote === null) throw new Error("Connect event without a remote created.");

  console.log("Pushing all files to the remote...");
  await pushAllScripts(srcDir, remote);
});

process.on("exit", () => {
  ac.abort("Shutdown");

  server.stop();
});