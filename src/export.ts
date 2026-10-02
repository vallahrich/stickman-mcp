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

async function writeExclusive(file: string, contents: string | Buffer): Promise<number> {
  await writeFile(file, contents, { flag: "wx", mode: 0o600 });
  return Buffer.byteLength(contents);
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const process = spawn("ffmpeg", args, { stdio: "ignore", windowsHide: true });
    process.once("error", (error) => rejectPromise(new Error(`Cannot start FFmpeg (${error.message}). Install FFmpeg and add it to PATH for GIF/MP4 export.`)));
    process.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`FFmpeg exited with status ${String(code)} while encoding the animation.`)));
  });
}

async function writeVideo(program: CompiledAnimation, destination: string, format: "gif" | "mp4"): Promise<number> {
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
      const time = Math.min(program.spec.durationMs, index * 1000 / fps);
      const svg = renderSvgFrame(program, time);
      const file = resolve(framesDirectory, `frame${String(index).padStart(6, "0")}.png`);
      // v1 frames contain no text; loading the system font database per frame is unnecessary.
      const png = new rasterize(svg, { font: { loadSystemFonts: false } }).render().asPng();
      await writeFile(file, png);
    }
    const sequence = resolve(framesDirectory, "frame%06d.png");
    const encoded = resolve(framesDirectory, `render.${format}`);
    const args = format === "gif"
      ? ["-hide_banner", "-loglevel", "error", "-n", "-framerate", String(fps), "-i", sequence, "-vf", `fps=${fps},scale=${program.spec.canvas.width}:-1:flags=lanczos`, "-loop", "0", encoded]
      : ["-hide_banner", "-loglevel", "error", "-n", "-framerate", String(fps), "-i", sequence, "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:white,format=yuv420p", "-movflags", "+faststart", encoded];
    await runFfmpeg(args);
    await copyFile(encoded, destination, constants.COPYFILE_EXCL);
    return (await stat(destination)).size;
  } finally {
    await rm(framesDirectory, { recursive: true, force: true });
  }
}

export async function exportAnimation(
  program: CompiledAnimation,
  outputRoot: string,
  outputPath: string,
  format: ExportFormat
): Promise<ExportResult> {
  const ext = outputPath.split(".").pop()?.toLowerCase();
  if (ext !== format) throw new Error(`Output filename must end in .${format}.`);
  const target = await resolveSafeOutputPath(outputRoot, outputPath);
  const lockPath = format === "gif" || format === "mp4" ? `${target.file}.stickman-lock` : undefined;
  const lock = lockPath ? await open(lockPath, "wx", 0o600) : undefined;
  try {
    await lock?.close();
    const bytes = format === "gif" || format === "mp4"
      ? await writeVideo(program, target.file, format)
      : await writeExclusive(target.file, renderArtifact(program, format));
    return { format, path: relative(target.root, target.file), bytes };
  } finally {
    if (lockPath && lock) await unlink(lockPath).catch(() => undefined);
  }
}
