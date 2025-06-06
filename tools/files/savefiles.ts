import { readdir, stat, rm } from "node:fs/promises";
import path from "node:path";

const envSaves = Number.parseInt(process.env["NUM_SAVES"] ?? "") || null;
if (envSaves === null || (envSaves <= 0 && envSaves !== -1)) throw new Error("No valid NUM_SAVES specified in env");
const numSaves = envSaves === -1 ? Number.MAX_SAFE_INTEGER : envSaves;

export async function storeSaveFile(data: {
  identifier: string;
  binary: boolean;
  save: string;
}) {
  const saveData = data.binary
    ? Uint8Array.from({ length: data.save.length }, (_, i) => data.save.charCodeAt(i))
    : data.save;

  const savesDir = path.resolve(process.cwd(), "./saves/", `./${data.identifier}/`);
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
    hourCycle: "h23",
  });
  const fileEnding = typeof saveData === "string" ? "json" : "json.gz";
  const filename = "./" + formatter.format(Date.now()).replace(", ", "_").replaceAll(/[/:]/g, "-") + fileEnding;
  const filePath = path.resolve(savesDir, filename);

  await Bun.write(filePath, saveData);

  const saveFiles = await readdir(savesDir, { encoding: "binary", recursive: false });
  if (saveFiles.length < numSaves!) return;

  const saveFilesWithTimes = await Promise.all(saveFiles.map(async file => ({
    file,
    time: (await stat(path.resolve(savesDir, file))).birthtimeMs,
  })));
  saveFilesWithTimes.sort((a, b) => a.time - b.time);

  const overflowing = saveFilesWithTimes.slice(0, saveFilesWithTimes.length - numSaves!);
  await Promise.all(overflowing.map(async data => await rm(path.resolve(savesDir, data.file))));
}