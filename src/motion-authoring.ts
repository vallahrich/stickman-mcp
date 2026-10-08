import { mkdir, rm } from "node:fs/promises";
import { resolveSafeOutputPath } from "./export.js";

const apiUrl = new URL("../scripts/motions/authoring.mjs", import.meta.url);
type MotionApi = {
  authorMotion(input: unknown, options: { outputFile: string }): Promise<Record<string, unknown>>;
  previewMotion(id: string, options: { outputFile: string; count?: number }): Promise<Record<string, unknown>>;
};
const load = async (): Promise<MotionApi> => import(apiUrl.href);
async function withNewPreview(outputRoot: string, outputDir: string, id: string, render: (file: string) => Promise<Record<string, unknown>>) {
  const { file: directory } = await resolveSafeOutputPath(outputRoot, outputDir);
  await mkdir(directory);
  const outputFile = `${directory}\\${id}-strip.png`;
  try { return await render(outputFile); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
export async function authorMotionDraft(input: unknown, outputRoot: string, outputDir: string): Promise<Record<string, unknown>> {
  const id = (input as { id?: unknown })?.id;
  if (typeof id !== "string") throw new TypeError("id must be a string.");
  return withNewPreview(outputRoot, outputDir, id, async outputFile => (await load()).authorMotion(input, { outputFile }));
}
export async function previewMotionStrip(id: string, outputRoot: string, outputDir: string, count = 8): Promise<Record<string, unknown>> {
  return withNewPreview(outputRoot, outputDir, id, async outputFile => (await load()).previewMotion(id, { outputFile, count }));
}
