import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { copyFile, lstat, mkdir, open, realpath, rm, stat, unlink } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
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
import type { RasterWorkerRequest, RasterWorkerResponse } from "./raster-worker.js";
import { renderAnimatedSvg, renderHtml, renderSvgFrame } from "./render.js";
import { renderStoryboardSvg, type StoryboardTheme } from "./storyboard.js";

export type ExportableProgram = CompiledAnimation | CompiledMovie;

export type ExportFormat = "svg-frame" | "svg" | "html" | "gif" | "mp4" | "webm" | "storyboard-svg";
export type VideoExportFormat = "gif" | "mp4" | "webm";

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
  transparent?: boolean;
  workerCount?: number;
  ffmpegPath?: string;
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

function isVideoFormat(format: ExportFormat): format is VideoExportFormat {
  return format === "gif" || format === "mp4" || format === "webm";
}

function createAbortError(): Error {
  const error = new Error("Animation export was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
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
  if (isVideoFormat(format)) {
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
    transparent?: boolean;
    maxPanels?: number;
    columns?: number;
    theme?: StoryboardTheme;
  } = {}
): string {
  const styleOptions =
    options.style !== undefined || options.transparent !== undefined
      ? {
          ...(options.style !== undefined ? { style: options.style } : {}),
          ...(options.transparent !== undefined ? { transparent: options.transparent } : {})
        }
      : undefined;
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

async function resolveFfmpegExecutable(explicitPath?: string): Promise<string> {
  if (explicitPath) return explicitPath;
  try {
    const mod: unknown = await import("ffmpeg-static");
    const candidate = typeof mod === "string"
      ? mod
      : (typeof mod === "object" && mod !== null && "default" in mod && typeof (mod as { default: unknown }).default === "string"
          ? (mod as { default: string }).default
          : undefined);
    if (candidate && existsSync(candidate)) return candidate;
  } catch {
    // Fall back to system ffmpeg on PATH.
  }
  return "ffmpeg";
}

function resolveRasterWorkerUrl(): URL | undefined {
  const candidates = [
    new URL("./raster-worker.js", import.meta.url),
    new URL("../dist/raster-worker.js", import.meta.url)
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(fileURLToPath(candidate))) {
        return candidate;
      }
    } catch {
      // Ignore invalid URL conversion
    }
  }
  return undefined;
}

function buildFfmpegArgs(
  format: VideoExportFormat,
  fps: number,
  width: number,
  transparent: boolean,
  inputArgs: string[],
  outputFile: string
): string[] {
  const prefix = ["-hide_banner", "-loglevel", "error", "-n", ...inputArgs];
  if (format === "gif") {
    return [
      ...prefix,
      "-filter_complex",
      `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`,
      "-loop",
      "0",
      outputFile
    ];
  }
  if (format === "webm") {
    return transparent
      ? [
          ...prefix,
          "-c:v",
          "libvpx-vp9",
          "-pix_fmt",
          "yuva420p",
          "-auto-alt-ref",
          "0",
          "-b:v",
          "0",
          "-crf",
          "32",
          "-deadline",
          "realtime",
          "-cpu-used",
          "5",
          outputFile
        ]
      : [
          ...prefix,
          "-c:v",
          "libvpx-vp9",
          "-pix_fmt",
          "yuv420p",
          "-b:v",
          "0",
          "-crf",
          "32",
          "-deadline",
          "realtime",
          "-cpu-used",
          "5",
          outputFile
        ];
  }
  return [
    ...prefix,
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:white,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-movflags",
    "+faststart",
    outputFile
  ];
}

function renderFrameSvgAt(
  program: ExportableProgram,
  timeMs: number,
  options: { style?: RenderStyle; transparent?: boolean }
): string {
  const styleOptions =
    options.style !== undefined || options.transparent !== undefined
      ? {
          ...(options.style !== undefined ? { style: options.style } : {}),
          ...(options.transparent !== undefined ? { transparent: options.transparent } : {})
        }
      : undefined;
  return isCompiledMovie(program)
    ? renderMovieSvgFrame(program, timeMs, "normal", styleOptions)
    : renderSvgFrame(program, timeMs, "normal", styleOptions);
}

async function writeChunkWithBackpressure(
  stdin: NodeJS.WritableStream,
  chunk: Uint8Array,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal);
  if (stdin.write(chunk)) return;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const cleanup = () => {
      stdin.off("drain", onDrain);
      stdin.off("error", onError);
      stdin.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolvePromise();
    };
    const onError = (err: Error) => {
      cleanup();
      rejectPromise(err);
    };
    const onClose = () => {
      cleanup();
      rejectPromise(new Error("FFmpeg stdin closed unexpectedly while streaming PNG frames."));
    };
    const onAbort = () => {
      cleanup();
      rejectPromise(createAbortError());
    };
    stdin.once("drain", onDrain);
    stdin.once("error", onError);
    stdin.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function streamFramesViaWorkerPool(
  workerUrl: URL,
  workerCount: number,
  frameCount: number,
  getFrameSvg: (index: number) => string,
  onOrderedFrame: (index: number, png: Uint8Array) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const poolSize = Math.max(1, Math.min(workerCount, frameCount));
  const workers: Worker[] = [];
  const idleWorkers: Worker[] = [];
  const completed = new Map<number, Uint8Array>();
  const maxInFlight = poolSize * 2;
  let nextToDispatch = 0;
  let nextToWrite = 0;
  let inFlight = 0;
  let draining = false;
  let settled = false;

  try {
    await new Promise<void>((resolveAll, rejectAll) => {
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        rejectAll(err instanceof Error ? err : new Error(String(err)));
      };

      const finishIfDone = () => {
        if (!settled && nextToWrite >= frameCount) {
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          resolveAll();
        }
      };

      const dispatch = () => {
        if (settled) return;
        if (signal?.aborted) {
          fail(createAbortError());
          return;
        }
        while (idleWorkers.length > 0 && nextToDispatch < frameCount && inFlight < maxInFlight) {
          const worker = idleWorkers.pop()!;
          const id = nextToDispatch++;
          inFlight++;
          let svg: string;
          try {
            svg = getFrameSvg(id);
          } catch (err) {
            fail(err);
            return;
          }
          const req: RasterWorkerRequest = {
            id,
            svg,
            loadSystemFonts: svg.includes("<text")
          };
          worker.postMessage(req);
        }
      };

      const drainOrdered = async () => {
        if (draining || settled) return;
        draining = true;
        try {
          while (!settled && completed.has(nextToWrite)) {
            const idx = nextToWrite++;
            const png = completed.get(idx)!;
            completed.delete(idx);
            await onOrderedFrame(idx, png);
            dispatch();
          }
          finishIfDone();
        } catch (err) {
          fail(err);
        } finally {
          draining = false;
          if (!settled && completed.has(nextToWrite)) {
            void drainOrdered();
          }
        }
      };

      const onAbort = () => fail(createAbortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        fail(createAbortError());
        return;
      }

      for (let i = 0; i < poolSize; i++) {
        const worker = new Worker(workerUrl);
        workers.push(worker);
        idleWorkers.push(worker);

        worker.on("message", (msg: RasterWorkerResponse) => {
          if (settled) return;
          inFlight--;
          if (msg.error || !msg.png) {
            fail(new Error(msg.error ?? `Raster worker returned empty PNG for frame ${msg.id}.`));
            return;
          }
          completed.set(msg.id, msg.png);
          idleWorkers.push(worker);
          dispatch();
          void drainOrdered();
        });

        worker.on("error", (err) => {
          fail(err);
        });

        worker.on("exit", (code) => {
          if (!settled && code !== 0) {
            fail(new Error(`Raster worker exited unexpectedly with status ${code}.`));
          }
        });
      }

      dispatch();
    });
  } finally {
    await Promise.allSettled(workers.map((worker) => worker.terminate()));
  }
}

async function writeVideo(
  program: ExportableProgram,
  destination: string,
  format: VideoExportFormat,
  options: ExportOptions,
  onCreate: () => void
): Promise<number> {
  const fps = program.spec.canvas.fps;
  const durationMs = isCompiledMovie(program) ? program.durationMs : program.spec.durationMs;
  const frameCount = Math.max(2, Math.ceil(durationMs * fps / 1000));
  const transparent = format === "webm" && options.transparent === true;
  const frameOpts = {
    ...(options.style !== undefined ? { style: options.style } : {}),
    ...(transparent ? { transparent: true } : {})
  };
  const getFrameSvg = (index: number): string => {
    const time = Math.min(durationMs, (index * 1000) / fps);
    return renderFrameSvgAt(program, time, frameOpts);
  };

  // Custom injected encoder path (preserves full compatibility with unit-test stubs)
  if (options.runEncoder) {
    let rasterize: VideoRasterizer;
    try {
      rasterize = options.loadResvg
        ? (await options.loadResvg()).Resvg
        : (await import("@resvg/resvg-js")).Resvg;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
        throw new Error("GIF/MP4/WebM export needs optional @resvg/resvg-js to rasterize SVG frames. Install it, then retry.");
      }
      throw error;
    }
    const scratchDir = resolve(tmpdir(), `stickman-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: false });
    try {
      for (let index = 0; index < frameCount; index++) {
        throwIfAborted(options.signal);
        const svg = getFrameSvg(index);
        new rasterize(svg, { font: { loadSystemFonts: svg.includes("<text") } }).render().asPng();
        await reportProgress(options.onProgress, { phase: "rasterize", current: index + 1, total: frameCount });
      }
      const encoded = resolve(scratchDir, `render.${format}`);
      const args = buildFfmpegArgs(
        format,
        fps,
        program.spec.canvas.width,
        transparent,
        ["-f", "image2pipe", "-vcodec", "png", "-framerate", String(fps), "-i", "pipe:0"],
        encoded
      );
      throwIfAborted(options.signal);
      await reportProgress(options.onProgress, { phase: "encode", current: 0, total: 1 });
      await options.runEncoder(args, options.signal);
      throwIfAborted(options.signal);
      await copyFile(encoded, destination, constants.COPYFILE_EXCL);
      onCreate();
      return (await stat(destination)).size;
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }

  // Zero-temp-disk streaming FFmpeg path (with optional parallel worker_threads pool)
  const defaultWorkers = Math.min(typeof availableParallelism === "function" ? availableParallelism() : 2, 4);
  const requestedWorkers = options.workerCount !== undefined ? Math.max(1, Math.floor(options.workerCount)) : defaultWorkers;
  const workerUrl = !options.loadResvg && frameCount >= 12 && requestedWorkers > 1
    ? resolveRasterWorkerUrl()
    : undefined;

  let inProcessResvg: VideoRasterizer | undefined;
  try {
    inProcessResvg = options.loadResvg
      ? (await options.loadResvg()).Resvg
      : (await import("@resvg/resvg-js")).Resvg;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error("GIF/MP4/WebM export needs optional @resvg/resvg-js to rasterize SVG frames. Install it, then retry.");
    }
    throw error;
  }

  throwIfAborted(options.signal);
  const ffmpegBin = await resolveFfmpegExecutable(options.ffmpegPath);
  const args = buildFfmpegArgs(
    format,
    fps,
    program.spec.canvas.width,
    transparent,
    ["-f", "image2pipe", "-vcodec", "png", "-framerate", String(fps), "-i", "pipe:0"],
    destination
  );

  const child = spawn(ffmpegBin, args, {
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true
  });
  onCreate();

  let stderrText = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderrText.length < 4096) {
      stderrText += chunk.toString("utf8");
    }
  });

  // Prevent unhandled EPIPE on stdin if ffmpeg exits early
  child.stdin.on("error", () => undefined);

  const abortChild = () => {
    child.stdin.destroy();
    child.kill();
  };
  options.signal?.addEventListener("abort", abortChild, { once: true });

  const childExitPromise = new Promise<void>((resolveExit, rejectExit) => {
    child.once("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      rejectExit(new Error(`Cannot start FFmpeg (${message}). Install FFmpeg or optional ffmpeg-static for GIF/MP4/WebM export.`));
    });
    child.once("close", (code) => {
      if (options.signal?.aborted) {
        rejectExit(createAbortError());
      } else if (code === 0) {
        resolveExit();
      } else {
        const detail = stderrText.trim();
        rejectExit(
          new Error(
            `FFmpeg exited with status ${String(code)} while encoding the animation.${detail ? ` ${detail}` : ""}`
          )
        );
      }
    });
  });

  try {
    const onOrderedFrame = async (index: number, png: Uint8Array): Promise<void> => {
      await writeChunkWithBackpressure(child.stdin, png, options.signal);
      await reportProgress(options.onProgress, { phase: "rasterize", current: index + 1, total: frameCount });
    };

    if (workerUrl) {
      await streamFramesViaWorkerPool(
        workerUrl,
        requestedWorkers,
        frameCount,
        getFrameSvg,
        onOrderedFrame,
        options.signal
      );
    } else {
      const Resvg = inProcessResvg!;
      for (let index = 0; index < frameCount; index++) {
        throwIfAborted(options.signal);
        const svg = getFrameSvg(index);
        const png = new Resvg(svg, { font: { loadSystemFonts: svg.includes("<text") } }).render().asPng();
        await onOrderedFrame(index, png);
      }
    }

    throwIfAborted(options.signal);
    await reportProgress(options.onProgress, { phase: "encode", current: 0, total: 1 });
    child.stdin.end();
    await childExitPromise;
    throwIfAborted(options.signal);
    return (await stat(destination)).size;
  } catch (error) {
    abortChild();
    await childExitPromise.catch(() => undefined);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortChild);
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
  const lockPath = isVideoFormat(format) ? `${target.file}.stickman-lock` : undefined;
  const lock = lockPath ? await open(lockPath, "wx", 0o600) : undefined;
  const { estimatedWork, warnings } = planAnimationExport(program, format);
  let outputCreated = false;
  const markOutputCreated = () => { outputCreated = true; };
  try {
    await lock?.close();
    throwIfAborted(options.signal);
    await reportProgress(options.onProgress, { phase: "prepare", current: 0, total: estimatedWork.frameCount });
    const bytes = isVideoFormat(format)
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
