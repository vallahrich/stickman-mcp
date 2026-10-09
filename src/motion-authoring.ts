import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSafeOutputPath } from "./export.js";

const apiUrl = new URL("../scripts/motions/authoring.mjs", import.meta.url);
type MotionApi = {
  authorMotion(input: unknown, options: { outputFile: string; specDir: string }): Promise<Record<string, unknown>>;
  previewMotion(id: string, options: { outputFile: string; count?: number; specDir?: string }): Promise<Record<string, unknown>>;
};
const load = async (): Promise<MotionApi> => import(apiUrl.href);
async function withNewPreview(outputRoot: string, outputDir: string, id: string, render: (file: string) => Promise<Record<string, unknown>>) {
  const { file: directory } = await resolveSafeOutputPath(outputRoot, outputDir);
  await mkdir(directory);
  const outputFile = join(directory, `${id}-strip.png`);
  try { return await render(outputFile); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
export async function authorMotionDraft(input: unknown, outputRoot: string, outputDir: string): Promise<Record<string, unknown>> {
  const id = (input as { id?: unknown })?.id;
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new TypeError("id must match ^[a-z][a-z0-9-]{0,63}$.");
  try {
    const existing = JSON.parse(await readFile(fileURLToPath(new URL(`../motions/specs/${id}.json`, import.meta.url)), "utf8")) as { status: string };
    if (existing.status !== "draft") throw new Error(`Refusing to overwrite ${id}: existing spec status is "${existing.status}" (only draft specs may be replaced).`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Drafts belong to the requested output, not the installed approved library.
  return withNewPreview(outputRoot, outputDir, id, async outputFile =>
    (await load()).authorMotion(input, { outputFile, specDir: dirname(outputFile) }));
}
export async function previewMotionStrip(id: string, outputRoot: string, outputDir: string, count = 8, draftDir?: string): Promise<Record<string, unknown>> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new TypeError("id must match ^[a-z][a-z0-9-]{0,63}$.");
  if (!Number.isInteger(count) || count < 2 || count > 24) throw new TypeError("count must be an integer from 2 to 24.");
  let specDir: string | undefined;
  if (draftDir !== undefined) {
    const root = await realpath(outputRoot);
    if (isAbsolute(draftDir) || !draftDir || draftDir.split(/[\\/]/).some(part => !part || part === "." || part === ".." || !/^[\w.-]+$/.test(part))) {
      throw new Error("draftDir must be a safe relative directory inside --root.");
    }
    specDir = resolve(root, draftDir);
    const inside = relative(root, specDir);
    if (inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error("draftDir must remain inside --root.");
    let current = root;
    for (const part of [...inside.split(sep), `${id}.json`]) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Draft symlinks are refused.");
    }
  }
  return withNewPreview(outputRoot, outputDir, id, async outputFile =>
    (await load()).previewMotion(id, { outputFile, count, ...(specDir ? { specDir } : {}) }));
}
