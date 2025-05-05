import { watch, stat, exists, readdir } from "node:fs/promises";
import * as esbuild from "esbuild";
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

        console.log(`Deleting all files of the directory '${gameFilename}'...`);
        for (const match of matches) {
          console.log(`Deleting file '${gameFilename}'`);
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

      console.log(`Deleting file '${gameFilename}'`);
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

    console.log(`Pushing file '${gameFilename}'`);
    const { success } = await remoteHandle.makeRequest({
      method: "pushFile",
      params: {
        server: "home",
        filename: gameFilename,
        content: await buildFile(path.relative(process.cwd(), editorFilename)),
      },
    });

    if (success) continue;
    console.log(`Error pushing file! Trying to push '${gameFilename}'`);
  }
}

export async function pushAllScripts(dir: string, remote: Remote) {
  const srcDir = path.resolve(process.cwd(), dir);
  const files = await readdir(srcDir, { recursive: true });

  for (const file of files) {
    const filePath = path.resolve(srcDir, file);
    const gameFilename = path.relative(srcDir, file).slice(3).replaceAll("\\", "/");

    const stats = await stat(filePath);
    if (stats.isDirectory()) continue;
    const content = await buildFile(path.relative(process.cwd(), filePath));

    await remote.makeRequest({
      method: "pushFile",
      params: {
        server: "home",
        filename: gameFilename,
        content,
      },
    })
  }
}

export async function buildFile(srcPath: string) {
  const result = await esbuild.build({
    entryPoints: [srcPath],
    minify: true,
    bundle: true,
    write: false,
    treeShaking: true,
    format: "esm",
    target: "esnext",
    platform: "neutral",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    logLevel: "silent",
  }).catch(() => null);

  if (result === null) return "";
  return result.outputFiles?.[0]?.text ?? "";
}