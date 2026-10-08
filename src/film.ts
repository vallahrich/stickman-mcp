import { mkdir, rm } from "node:fs/promises";
import { resolveSafeOutputPath } from "./export.js";

// The private source checkout owns the shared .mjs composer. Resolve relative to
// this module, not the launch directory (which may be a client's output folder).
const runtimeUrl = new URL("../scripts/film/api.mjs", import.meta.url);
type FilmApi = {
  composeRecipe(recipe: unknown): Promise<Record<string, unknown>>;
  listFilmAssets(): Promise<Record<string, unknown>>;
  checkFilmJoin(motionA: string, motionB: string): Promise<Record<string, unknown>>;
  renderRecipe(recipe: unknown, directory: string, options: { preview?: boolean; qaFrames?: number }): Promise<Record<string, unknown>>;
};
const load = async (): Promise<FilmApi> => import(runtimeUrl.href);
export async function composeFilmRecipe(recipe: unknown): Promise<Record<string, unknown>> {
  return (await load()).composeRecipe(recipe);
}
export async function listFilmAssets(): Promise<Record<string, unknown>> {
  return (await load()).listFilmAssets();
}
export async function checkFilmJoin(motionA: string, motionB: string): Promise<Record<string, unknown>> {
  return (await load()).checkFilmJoin(motionA, motionB);
}
export async function renderFilmRecipe(recipe: unknown, outputRoot: string, outputDir: string, options: { preview?: boolean; qaFrames?: number } = {}): Promise<Record<string, unknown>> {
  const api = await load();
  // Validate before creating any output, then reserve a fresh directory. Existing
  // paths and symlinks are refused by the same resolver as stickman_export.
  await api.composeRecipe(recipe);
  const { file } = await resolveSafeOutputPath(outputRoot, outputDir);
  await mkdir(file);
  try {
    return await api.renderRecipe(recipe, file, options);
  } catch (error) {
    await rm(file, { recursive: true, force: true });
    throw error;
  }
}
