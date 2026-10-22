import { mkdir, rm } from "node:fs/promises";
import { resolveSafeOutputPath } from "./export.js";
import type { ExportProgress } from "./export.js";

// The package ships the shared composer and its assets. Resolve relative to
// this module, never the client's working directory.
const runtimeUrl = new URL("../scripts/film/api.mjs", import.meta.url);
type FilmApi = {
  composeRecipe(recipe: unknown, options?: {
    signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void | Promise<void>
  }): Promise<Record<string, unknown>>;
  listFilmAssets(): Promise<Record<string, unknown>>;
  checkFilmJoin(motionA: string, motionB: string): Promise<Record<string, unknown>>;
  renderRecipe(recipe: unknown, directory: string, options: {
    preview?: boolean; qaFrames?: number; signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void | Promise<void>
  }): Promise<Record<string, unknown>>;
};
const load = async (): Promise<FilmApi> => import(runtimeUrl.href);
export async function composeFilmRecipe(recipe: unknown, options: {
  signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void | Promise<void>
} = {}): Promise<Record<string, unknown>> {
  return (await load()).composeRecipe(recipe, options);
}
export async function listFilmAssets(): Promise<Record<string, unknown>> {
  return (await load()).listFilmAssets();
}
export async function checkFilmJoin(motionA: string, motionB: string): Promise<Record<string, unknown>> {
  return (await load()).checkFilmJoin(motionA, motionB);
}
export async function renderFilmRecipe(recipe: unknown, outputRoot: string, outputDir: string, options: {
  preview?: boolean; qaFrames?: number; signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void | Promise<void>
} = {}): Promise<Record<string, unknown>> {
  const api = await load();
  // Validate before creating any output, then reserve a fresh directory. Existing
  // paths and symlinks are refused by the same resolver as stickman_export.
  await api.composeRecipe(recipe, options.signal ? { signal: options.signal } : {});
  const { file } = await resolveSafeOutputPath(outputRoot, outputDir);
  await mkdir(file);
  try {
    return await api.renderRecipe(recipe, file, options);
  } catch (error) {
    await rm(file, { recursive: true, force: true });
    throw error;
  }
}
