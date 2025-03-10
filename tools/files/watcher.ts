import { watch, stat, exists } from "node:fs/promises";
import path from "node:path";
import type { Remote } from "../api/remote";

export async function watchDir(dir: string, remote: () => Remote | null, signal: AbortSignal) {
  const srcDir = path.resolve(process.cwd(), dir);
  const watcher = watch(srcDir, { signal, recursive: true });

  for await (const event of watcher) {
    const remoteHandle = remote();
    if (remoteHandle === null) continue;

    if (event.filename === null) {
      console.log("No filename?");
      continue;
    }

    const gameFilename = path.relative(srcDir, event.filename).slice(3).replaceAll("\\", "/");
    const editorFilename = path.resolve(srcDir, event.filename);

    if (await exists(editorFilename) && (await stat(editorFilename)).isDirectory()) continue;

    const fileHandle = Bun.file(editorFilename);
    if (!await fileHandle.exists()) {
      const filenames = await remoteHandle.makeRequest({
        method: "getFileNames",
        params: { server: "home" },
      });
      if (!filenames.success) {
        console.log(`Error getting filenames! Trying to delete '${gameFilename}'`);
        continue;
      }

      const matching = filenames.result.some(a => a === gameFilename);
      if (!matching) {
        const matches = filenames.result.filter(a => a.startsWith(gameFilename + "/"));

        for (const match of matches) {
          const { success } = await remoteHandle.makeRequest({
            method: "deleteFile",
            params: {
              server: "home",
              filename: match,
            },
          });

          if (success) continue;
          console.log(`Error deleting file of directory! Trying to delete '${match}'`);
        }

        continue;
      }

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