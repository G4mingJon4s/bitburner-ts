import { watch } from "node:fs/promises";
import path from "node:path";
import type { Remote } from "../api/remote";

export async function watchDir(dir: string, remote: () => Remote | null, signal: AbortSignal) {
  const srcDir = path.resolve(process.cwd(), dir);
  const watcher = watch(srcDir, { signal });

  for await (const event of watcher) {
    const remoteHandle = remote();
    if (remoteHandle === null) continue;

    if (event.filename === null) {
      console.log("No filename?");
      continue;
    }

    const gameFilename = path.relative(srcDir, event.filename).slice(3);

    const fileHandle = Bun.file(path.resolve(srcDir, event.filename));
    if (!await fileHandle.exists()) {
      const { success } = await remoteHandle.makeRequest({
        method: "deleteFile",
        params: {
          server: "home",
          filename: gameFilename,
        },
      });

      if (success) continue;
      console.log(`Error deleting file! Trying to delete '${gameFilename}'`);
      continue;
    }

    const { success } = await remoteHandle.makeRequest({
      method: "pushFile",
      params: {
        server: "home",
        filename: gameFilename,
        content: await fileHandle.text(),
      },
    });

    if (success) continue;
    console.log(`Error pushing file! Trying to push '${gameFilename}'`);
  }
}