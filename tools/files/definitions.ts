import path from "node:path";

export async function updateDefinitionFile(contents: string) {
  await Bun.write(path.resolve(process.cwd(), "./NetscriptDefinitions.d.ts"), contents.replaceAll(/^export /g, ""));
}