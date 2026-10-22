import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { CompiledAnimation, PlaybackMode } from "./contract.js";
import { renderAnimatedSvg, renderHtml, renderSvgFrame } from "./render.js";

export type ExportFormat = "svg" | "html" | "gif" | "mp4";

export interface ExportResult {
  format: ExportFormat;
  path: string;
  bytes: number;
  warnings: string[];
  estimatedWork: { frameCount: number; pixelsPerFrame: number; totalRasterPixels: number };
}
export interface ExportProgress { phase: "prepare" | "rasterize" | "encode" | "complete" | "compose" | "poster" | "qa"; current: number; total: number }
export interface ExportOptions {
  timeMs?: number;
  mode?: PlaybackMode;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void | Promise<void>;
}
export interface ExportPlan {
  estimatedWork: ExportResult["estimatedWork"];
  warnings: string[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Animation export was cancelled.");
    error.name = "AbortError";
    throw error;
  }
}
async function reportProgress(callback: ExportOptions["onProgress"], progress: ExportProgress): Promise<void> {
  await callback?.(progress);
}
export function estimateExportWork(program: CompiledAnimation): ExportResult["estimatedWork"] {
  const frameCount = Math.max(2, Math.ceil(program.spec.durationMs * program.spec.canvas.fps / 1000));
  const pixelsPerFrame = program.spec.canvas.width * program.spec.canvas.height;
  return { frameCount, pixelsPerFrame, totalRasterPixels: frameCount * pixelsPerFrame };
}
function exportWarnings(format: ExportFormat, work: ExportResult["estimatedWork"]): string[] {
  const warnings: string[] = [];
  if (format === "gif" || format === "mp4") {
    if (work.frameCount > 1800) warnings.push(`Raster export contains ${work.frameCount} frames; this exceeds the curated-showcase limit of 1800 frames but is allowed for a generic export.`);
    if (work.totalRasterPixels > 90_000_000) warnings.push(`Raster export estimates ${work.totalRasterPixels} pixels of frame work; expect increased CPU, memory, disk use, and render time.`);
  }
  return warnings;
}
export function planAnimationExport(program: CompiledAnimation, format: ExportFormat): ExportPlan {
  const estimatedWork = estimateExportWork(program);
  return { estimatedWork, warnings: exportWarnings(format, estimatedWork) };
}

export function renderArtifact(program: CompiledAnimation, format: "svg" | "html", options: { timeMs?: number; mode?: PlaybackMode } = {}): string {
  return format === "svg"
    ? (options.timeMs === undefined && options.mode === undefined ? renderAnimatedSvg(program) : renderSvgFrame(program, options.timeMs ?? 0, options.mode ?? "normal"))
    : renderHtml(program);
}

function assertContained(root: string, path: string): void {
  const rel = relative(root, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Output path must be a file strictly inside the approved output root.");
  }
}

export async function resolveSafeOutputPath(outputRoot: string, outputPath: string): Promise<{ root: string; file: string }> {
  if (!outputPath || outputPath.includes("\0") || isAbsolute(outputPath)) throw new Error("Output path must be a non-empty relative path inside the approved output root.");
  const resolvedRoot = resolve(outputRoot);
  await mkdir(resolvedRoot, { recursive: true });
  const root = await realpath(resolvedRoot);
  const file = resolve(root, outputPath);
  assertContained(root, file);
  const parts = relative(root, file).split(/[\\/]/);
  let current = root;
  for (const segment of parts.slice(0, -1)) {
    current = resolve(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Output directories may not contain symlinks or non-directory entries.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current);
    }
    assertContained(root, await realpath(current));
  }
  try {
    await lstat(file);
    throw new Error("Output file already exists; choose another relative path.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { root, file };
}

async function writeExclusive(file: string, contents: string | Buffer, onCreate: () => void): Promise<number> {
  const handle = await open(file, "wx", 0o600);
  onCreate();
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
  return Buffer.byteLength(contents);
}

async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const process = spawn("ffmpeg", args, { stdio: "ignore", windowsHide: true });
    const abort = () => process.kill();
    signal?.addEventListener("abort", abort, { once: true });
    process.once("error", error => rejectPromise(new Error(`Cannot start FFmpeg (${error.message}). Install FFmpeg and add it to PATH for GIF/MP4 export.`)));
    process.once("close", code => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        const error = new Error("Animation export was cancelled.");
        error.name = "AbortError";
        rejectPromise(error);
      } else if (code === 0) resolvePromise();
      else rejectPromise(new Error(`FFmpeg exited with status ${String(code)} while encoding the animation.`));
    });
    if (signal?.aborted) abort();
  });
}

async function writeVideo(program: CompiledAnimation, destination: string, format: "gif" | "mp4", options: ExportOptions, onCreate: () => void): Promise<number> {
  let rasterize: typeof import("@resvg/resvg-js").Resvg;
  try {
    rasterize = (await import("@resvg/resvg-js")).Resvg;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error("GIF/MP4 export needs optional @resvg/resvg-js to rasterize SVG frames. Install it, then retry.");
    }
    throw error;
  }
  const framesDirectory = resolve(tmpdir(), `stickman-${randomUUID()}`);
  await mkdir(framesDirectory, { recursive: false });
  try {
    const fps = program.spec.canvas.fps;
    const frameCount = Math.max(2, Math.ceil(program.spec.durationMs * fps / 1000));
    for (let index = 0; index < frameCount; index++) {
      throwIfAborted(options.signal);
      const time = Math.min(program.spec.durationMs, index * 1000 / fps);
      const svg = renderSvgFrame(program, time);
      const file = resolve(framesDirectory, `frame${String(index).padStart(6, "0")}.png`);
      // v1 frames contain no text; loading the system font database per frame is unnecessary.
      const png = new rasterize(svg, { font: { loadSystemFonts: false } }).render().asPng();
      await writeFile(file, png);
      await reportProgress(options.onProgress, { phase: "rasterize", current: index + 1, total: frameCount });
    }
    const sequence = resolve(framesDirectory, "frame%06d.png");
    const encoded = resolve(framesDirectory, `render.${format}`);
    const args = format === "gif"
      ? ["-hide_banner", "-loglevel", "error", "-n", "-framerate", String(fps), "-i", sequence, "-filter_complex",
        `[0:v]fps=${fps},scale=${program.spec.canvas.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`,
        "-loop", "0", encoded]
      : ["-hide_banner", "-loglevel", "error", "-n", "-framerate", String(fps), "-i", sequence, "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:white,format=yuv420p", "-movflags", "+faststart", encoded];
    throwIfAborted(options.signal);
    await reportProgress(options.onProgress, { phase: "encode", current: 0, total: 1 });
    await runFfmpeg(args, options.signal);
    throwIfAborted(options.signal);
    await copyFile(encoded, destination, constants.COPYFILE_EXCL);
    onCreate();
    return (await stat(destination)).size;
  } finally {
    await rm(framesDirectory, { recursive: true, force: true });
  }
}

export async function exportAnimation(
  program: CompiledAnimation,
  outputRoot: string,
  outputPath: string,
  format: ExportFormat,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const ext = outputPath.split(".").pop()?.toLowerCase();
  if (ext !== format) throw new Error(`Output filename must end in .${format}.`);
  const target = await resolveSafeOutputPath(outputRoot, outputPath);
  const lockPath = format === "gif" || format === "mp4" ? `${target.file}.stickman-lock` : undefined;
  const lock = lockPath ? await open(lockPath, "wx", 0o600) : undefined;
  const { estimatedWork, warnings } = planAnimationExport(program, format);
  let outputCreated = false;
  const markOutputCreated = () => { outputCreated = true; };
  try {
    await lock?.close();
    throwIfAborted(options.signal);
    await reportProgress(options.onProgress, { phase: "prepare", current: 0, total: estimatedWork.frameCount });
    const bytes = format === "gif" || format === "mp4"
      ? await writeVideo(program, target.file, format, options, markOutputCreated)
      : await writeExclusive(target.file, renderArtifact(program, format, options), markOutputCreated);
    await reportProgress(options.onProgress, { phase: "complete", current: estimatedWork.frameCount, total: estimatedWork.frameCount });
    return { format, path: relative(target.root, target.file), bytes, warnings, estimatedWork };
  } catch (error) {
    if (outputCreated) await rm(target.file, { force: true });
    throw error;
  } finally {
    if (lockPath && lock) await unlink(lockPath);
  }
}
