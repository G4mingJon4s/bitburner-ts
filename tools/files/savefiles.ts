import path from "node:path";

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
  const filename = "./" + formatter.format(Date.now()).replace(", ", "_").replaceAll(/[/:]/g, "-") + ".json.gz";
  const filePath = path.resolve(savesDir, filename);

  await Bun.write(filePath, saveData);
}