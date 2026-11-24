import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CONTRACT_VERSION_V2,
  type AnimationSpecV2,
  type CompiledAnimation,
  type CompiledMovie,
  type PlaybackMode,
  type RenderStyle
} from "./contract.js";
import {
  isCompiledMovie,
  renderMovieAnimatedSvg,
  renderMovieHtml,
  renderMovieStoryboardSvg,
  renderMovieSvgFrame
} from "./movie.js";
import { renderAnimatedSvg, renderHtml, renderSvgFrame } from "./render.js";
import { renderStoryboardSvg, type StoryboardTheme } from "./storyboard.js";

export type ExportableProgram = CompiledAnimation | CompiledMovie;

export type ExportFormat = "svg-frame" | "svg" | "html" | "gif" | "mp4" | "storyboard-svg";

export interface ExportResult {
  format: ExportFormat;
  path: string;
  bytes: number;
  warnings: string[];
  estimatedWork: { frameCount: number; pixelsPerFrame: number; totalRasterPixels: number };
}
export interface ExportProgress { phase: "prepare" | "rasterize" | "encode" | "complete" | "compose" | "poster" | "qa"; current: number; total: number }

export interface VideoRasterizer {
  new (svg: string, options?: { font?: { loadSystemFonts?: boolean } }): {
    render(): { asPng(): Uint8Array };
  };
}

export interface ExportOptions {
  timeMs?: number;
  mode?: PlaybackMode;
  style?: RenderStyle;
  maxPanels?: number;
  columns?: number;
  theme?: StoryboardTheme;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void | Promise<void>;
  loadResvg?: () => Promise<{ Resvg: VideoRasterizer }>;
  runEncoder?: (args: string[], signal?: AbortSignal) => Promise<void>;
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
export function estimateExportWork(program: ExportableProgram): ExportResult["estimatedWork"] {
  const durationMs = isCompiledMovie(program) ? program.durationMs : program.spec.durationMs;
  const frameCount = Math.max(2, Math.ceil(durationMs * program.spec.canvas.fps / 1000));
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
export function planAnimationExport(program: ExportableProgram, format: ExportFormat): ExportPlan {
  const estimatedWork = estimateExportWork(program);
  return { estimatedWork, warnings: exportWarnings(format, estimatedWork) };
}

export function renderArtifact(
  program: ExportableProgram,
  format: "svg-frame" | "svg" | "html" | "storyboard-svg",
  options: {
    timeMs?: number;
    mode?: PlaybackMode;
    style?: RenderStyle;
    maxPanels?: number;
    columns?: number;
    theme?: StoryboardTheme;
  } = {}
): string {
  const styleOptions = options.style !== undefined ? { style: options.style } : undefined;
  if (isCompiledMovie(program)) {
    if (format === "storyboard-svg") {
      const effectiveTheme = options.theme ?? options.style ?? program.spec.theme?.style;
      return renderMovieStoryboardSvg(program, {
        ...(options.maxPanels !== undefined ? { maxPanels: options.maxPanels } : {}),
        ...(options.columns !== undefined ? { columns: options.columns } : {}),
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
        ...(effectiveTheme !== undefined ? { theme: effectiveTheme } : {})
      });
    }
    if (format === "svg-frame") {
      return renderMovieSvgFrame(program, options.timeMs ?? 0, options.mode ?? "normal", styleOptions);
    }
    return format === "svg"
      ? (options.timeMs === undefined && options.mode === undefined
          ? renderMovieAnimatedSvg(program, styleOptions)
          : renderMovieSvgFrame(program, options.timeMs ?? 0, options.mode ?? "normal", styleOptions))
      : renderMovieHtml(program, styleOptions);
  }
  if (format === "storyboard-svg") {
    const v2Spec = program.contractVersion === CONTRACT_VERSION_V2 ? (program.spec as AnimationSpecV2) : undefined;
    const effectiveTheme = options.theme ?? options.style ?? v2Spec?.theme?.style;
    return renderStoryboardSvg(program, {
      ...(options.maxPanels !== undefined ? { maxPanels: options.maxPanels } : {}),
      ...(options.columns !== undefined ? { columns: options.columns } : {}),
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
      ...(effectiveTheme !== undefined ? { theme: effectiveTheme } : {})
    });
  }
  if (format === "svg-frame") {
    return renderSvgFrame(program, options.timeMs ?? 0, options.mode ?? "normal", styleOptions);
  }
  return format === "svg"
    ? (options.timeMs === undefined && options.mode === undefined
        ? renderAnimatedSvg(program, styleOptions)
        : renderSvgFrame(program, options.timeMs ?? 0, options.mode ?? "normal", styleOptions))
    : renderHtml(program, styleOptions);
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

async function resolveFfmpegExecutable(): Promise<string> {
  try {
    const mod: unknown = await import("ffmpeg-static");
    const candidate = typeof mod === "string"
      ? mod
      : (typeof mod === "object" && mod !== null && "default" in mod && typeof (mod as { default: unknown }).default === "string"
          ? (mod as { default: string }).default
          : undefined);
    if (candidate) return candidate;
  } catch {
    // Fall back to system ffmpeg on PATH.
  }
  return "ffmpeg";
}

async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  const spawnWith = (executable: string) => new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { stdio: "ignore", windowsHide: true });
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", error => {
      signal?.removeEventListener("abort", abort);
      rejectPromise(error);
    });
    child.once("close", code => {
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

  try {
    await spawnWith("ffmpeg");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      const fallback = await resolveFfmpegExecutable();
      if (fallback !== "ffmpeg") {
        await spawnWith(fallback);
        return;
      }
    }
    if ((error as Error)?.name === "AbortError") throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("FFmpeg exited")) throw error;
    throw new Error(`Cannot start FFmpeg (${message}). Install FFmpeg or optional ffmpeg-static for GIF/MP4 export.`);
  }
}

async function writeVideo(program: ExportableProgram, destination: string, format: "gif" | "mp4", options: ExportOptions, onCreate: () => void): Promise<number> {
  let rasterize: VideoRasterizer;
  try {
    rasterize = options.loadResvg
      ? (await options.loadResvg()).Resvg
      : (await import("@resvg/resvg-js")).Resvg;
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
    const durationMs = isCompiledMovie(program) ? program.durationMs : program.spec.durationMs;
    const frameCount = Math.max(2, Math.ceil(durationMs * fps / 1000));
    for (let index = 0; index < frameCount; index++) {
      throwIfAborted(options.signal);
      const time = Math.min(durationMs, index * 1000 / fps);
      const styleOptions = options.style !== undefined ? { style: options.style } : undefined;
      const svg = isCompiledMovie(program)
        ? renderMovieSvgFrame(program, time, "normal", styleOptions)
        : renderSvgFrame(program, time, "normal", styleOptions);
      const file = resolve(framesDirectory, `frame${String(index).padStart(6, "0")}.png`);
      // Pure stickman frames contain no text; load system fonts only when a prop renders <text>.
      const png = new rasterize(svg, { font: { loadSystemFonts: svg.includes("<text") } }).render().asPng();
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
    await (options.runEncoder ?? runFfmpeg)(args, options.signal);
    throwIfAborted(options.signal);
    await copyFile(encoded, destination, constants.COPYFILE_EXCL);
    onCreate();
    return (await stat(destination)).size;
  } finally {
    await rm(framesDirectory, { recursive: true, force: true });
  }
}

export async function exportAnimation(
  program: ExportableProgram,
  outputRoot: string,
  outputPath: string,
  format: ExportFormat,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const expectedExt = format === "storyboard-svg" || format === "svg-frame" ? "svg" : format;
  const ext = outputPath.split(".").pop()?.toLowerCase();
  if (ext !== expectedExt) throw new Error(`Output filename must end in .${expectedExt}.`);
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
    if (lockPath && lock) await unlink(lockPath).catch(() => undefined);
  }
}
