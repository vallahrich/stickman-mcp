#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  CONTRACT_VERSION_MOVIE,
  CONTRACT_VERSION_V2,
  DECK_EMBED_TARGETS,
  actionCatalog,
  analyzeStoryboard,
  animationSchema,
  animationSchemaV2,
  choreographAnimation,
  compileAnimation,
  compileV2Animation,
  composeMovie,
  describeAction,
  evaluateAnimationQuality,
  exportAnimation,
  generateDeckEmbed,
  isCompiledMovie,
  isDeckEmbedTarget,
  movieSchema,
  queryActionCatalog,
  renderArtifact,
  renderCritiqueSheetSvg,
  renderMovieStoryboardSvg,
  renderStoryboardSvg,
  validateAnimation,
  validateV2Animation,
  type ActionCatalogFilter,
  type AnimationSpec,
  type AnimationSpecV2,
  type CompileResult,
  type CompiledAnimation,
  type Diagnostic,
  type ExportFormat,
  type ExportableProgram,
  type MovieSpecInput,
  type PlaybackMode,
  type RenderStyle,
  type StoryboardAnalysis,
  type StoryboardTheme,
  type ValidationResult
} from "./index.js";

const BOOLEAN_FLAGS = new Set([
  "lint-only",
  "blueprint",
  "json",
  "critique",
  "controls",
  "scroll-scrub",
  "transparent"
]);
type PreviewFormat = "svg-frame" | "svg" | "html" | "storyboard-svg";
const PREVIEW_FORMATS: readonly PreviewFormat[] = ["svg-frame", "svg", "html", "storyboard-svg"];
const EXPORT_FORMATS: readonly ExportFormat[] = ["svg-frame", "svg", "html", "storyboard-svg", "gif", "mp4", "webm"];

function parseArgs(args: string[]): { command: string; values: Map<string, string>; flags: Set<string> } {
  const [command = "help", ...rest] = args;
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const item = rest[i]!;
    if (!item.startsWith("--")) throw new Error(`Unexpected argument "${item}".`);
    const key = item.slice(2);
    if (values.has(key) || flags.has(key)) throw new Error(`Option --${key} may only be supplied once.`);
    if (BOOLEAN_FLAGS.has(key)) {
      const next = rest[i + 1];
      if (next === "true" || next === "false") {
        if (next === "true") flags.add(key);
        i++;
      } else {
        flags.add(key);
      }
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Option --${key} needs a value.`);
    values.set(key, value);
    i++;
  }
  return { command, values, flags };
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing required option --${key}.`);
  return value;
}

function parseIntOption(values: Map<string, string>, key: string, min: number, max: number): number | undefined {
  if (!values.has(key)) return undefined;
  const raw = Number(values.get(key));
  if (!Number.isInteger(raw) || raw < min || raw > max) {
    throw new Error(`--${key} must be an integer from ${min} to ${max}.`);
  }
  return raw;
}

function parseStoryboardTheme(values: Map<string, string>, flags: Set<string>): StoryboardTheme | undefined {
  const rawTheme = values.get("theme");
  if (rawTheme !== undefined && rawTheme !== "default" && rawTheme !== "blueprint") {
    throw new Error('Storyboard --theme must be "default" or "blueprint".');
  }
  if (flags.has("blueprint") && rawTheme === "default") {
    throw new Error("Cannot combine --blueprint with --theme default.");
  }
  if (flags.has("blueprint")) return "blueprint";
  return rawTheme as StoryboardTheme | undefined;
}

function parseRenderStyle(values: Map<string, string>, flags: Set<string>): RenderStyle | undefined {
  const rawStyle = values.get("style");
  if (rawStyle !== undefined && rawStyle !== "default" && rawStyle !== "blueprint") {
    throw new Error('Render --style must be "default" or "blueprint".');
  }
  if (flags.has("blueprint") && rawStyle === "default") {
    throw new Error("Cannot combine --blueprint with --style default.");
  }
  const rawTheme = values.get("theme");
  if (rawStyle !== undefined && rawTheme !== undefined && rawStyle !== rawTheme) {
    throw new Error(`Cannot combine --style ${rawStyle} with --theme ${rawTheme}.`);
  }
  if (flags.has("blueprint")) return "blueprint";
  return rawStyle as RenderStyle | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMovieInput(value: unknown): value is MovieSpecInput {
  return (
    isRecord(value) &&
    (value.version === CONTRACT_VERSION_MOVIE ||
      (Array.isArray(value.scenes) && value.version === undefined))
  );
}

function validateAnyAnimation(input: unknown): ValidationResult {
  if (isMovieInput(input)) {
    const composed = composeMovie(input);
    return { valid: composed.valid, diagnostics: composed.diagnostics };
  }
  if (isRecord(input) && input.version === undefined) {
    return validateV2Animation(input);
  }
  return validateAnimation(input);
}

function compileAnyAnimation(input: unknown): CompileResult {
  if (isRecord(input) && input.version === undefined) {
    return compileV2Animation(input);
  }
  return compileAnimation(input);
}

function compileOrComposeInput(
  input: unknown
): { valid: true; diagnostics: Diagnostic[]; target: ExportableProgram } | { valid: false; diagnostics: Diagnostic[] } {
  if (isMovieInput(input)) {
    const composed = composeMovie(input);
    if (!composed.valid || !composed.movie) {
      return { valid: false, diagnostics: composed.diagnostics };
    }
    return { valid: true, diagnostics: [], target: composed.movie };
  }
  const compiled = compileAnyAnimation(input);
  if (!compiled.valid || !compiled.program) {
    return { valid: false, diagnostics: compiled.diagnostics };
  }
  return { valid: true, diagnostics: [], target: compiled.program };
}

function analyzeProgramOrMovieStoryboard(target: ExportableProgram): StoryboardAnalysis {
  if (!isCompiledMovie(target)) {
    return analyzeStoryboard(target);
  }
  const timestampsMs: number[] = [];
  const actorIds = new Set<string>();
  const addonTypes = new Set<StoryboardAnalysis["addonTypes"][number]>();
  const outOfBoundsFrames: StoryboardAnalysis["outOfBoundsFrames"] = [];
  const seamStepByActorPx: Record<string, number> = {};
  const actorOverlapWarnings: StoryboardAnalysis["actorOverlapWarnings"] = [];
  const beatSummary: string[] = [];
  let maxSeamStepPx = 0;

  for (const scene of target.scenes) {
    const sub = analyzeStoryboard(scene.program);
    for (const t of sub.timestampsMs) timestampsMs.push(Math.round(scene.startMs + t));
    for (const id of sub.actorIds) actorIds.add(id);
    for (const ad of sub.addonTypes) addonTypes.add(ad);
    for (const oob of sub.outOfBoundsFrames) {
      outOfBoundsFrames.push({ ...oob, timeMs: Math.round(scene.startMs + oob.timeMs) });
    }
    if (sub.maxSeamStepPx > maxSeamStepPx) maxSeamStepPx = sub.maxSeamStepPx;
    for (const [actorId, step] of Object.entries(sub.seamStepByActorPx)) {
      seamStepByActorPx[actorId] = Math.max(seamStepByActorPx[actorId] ?? 0, step);
    }
    for (const warn of sub.actorOverlapWarnings) {
      actorOverlapWarnings.push({
        ...warn,
        startMs: Math.round(scene.startMs + warn.startMs),
        endMs: Math.round(scene.startMs + warn.endMs)
      });
    }
    for (const beat of sub.beatSummary) {
      beatSummary.push(`[${scene.id}] ${beat}`);
    }
  }

  return {
    panelCount: Math.max(1, timestampsMs.length),
    timestampsMs,
    durationMs: target.durationMs,
    actorIds: [...actorIds],
    addonTypes: [...addonTypes],
    outOfBoundsCount: outOfBoundsFrames.length,
    outOfBoundsFrames,
    maxSeamStepPx,
    seamStepByActorPx,
    actorOverlapWarnings,
    beatSummary
  };
}

function summarizeChoreography(program: CompiledAnimation): string {
  const { canvas, durationMs } = program.spec;
  const eventCount = program.events?.length ?? 0;
  if (program.contractVersion === CONTRACT_VERSION_V2) {
    const v2 = program.spec as AnimationSpecV2;
    const actorSummary = v2.actors
      .map((actor) => `${actor.id}[${actor.actions.map((a) => a.action).join(" -> ") || "idle"}]`)
      .join("; ");
    const totalActions = v2.actors.reduce((sum, actor) => sum + actor.actions.length, 0);
    return `${v2.actors.length} actor(s) (${actorSummary}), ${totalActions} action(s), ${durationMs}ms (${canvas.width}x${canvas.height}@${canvas.fps}fps), ${eventCount} marker event(s).`;
  }
  const v1 = program.spec as AnimationSpec;
  const actions = v1.actions.map((a) => a.action).join(" -> ") || "idle";
  return `1 actor (${actions}), ${v1.actions.length} action(s), ${durationMs}ms (${canvas.width}x${canvas.height}@${canvas.fps}fps), ${eventCount} marker event(s).`;
}

async function loadSpec(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${file}: ${error.message}`);
    throw error;
  }
}

function printHelp(): void {
  console.log(`stickman - deterministic 2D animation toolkit

Commands:
  discover [--category CAT] [--tag TAG] [--prop PROP] [--kind loop|oneshot|hold] [--travel travel|in-place] [--search TEXT]
  describe --id idea|idea@1.1.0    Describe one action and its bindings
  schema [--version v1|v2|movie-v1] Print the strict JSON Schema (default v1)
  validate --input scene.json      Validate v1, v2, choreography, or movie/v1 scene
  compile --input scene.json       Compile a canonical program or movie as JSON
  choreograph --input scene.json   Auto-choreograph a v2 scene to JSON
  movie --input movie.json [--critique]
                                   Compose a stickman.movie/v1 document (optional quality report)
  critique --input scene.json [--json] [--blueprint] [--theme default|blueprint] [--columns N] [--max-panels N]
                                   Run 6-axis perceptual critique (JSON report or annotated SVG sheet)
  embed --input scene.json --target reveal|slidev|marp|html|pptx-notes [--controls] [--scroll-scrub] [--blueprint] [--title TEXT] [--asset-path PATH]
                                   Generate a slide-deck or HTML embed snippet
  storyboard --input scene.json [--columns N] [--max-panels N] [--mode normal|reduced|static] [--theme default|blueprint] [--blueprint] [--lint-only]
  preview --input scene.json [--time MS] [--mode normal|reduced|static] [--style default|blueprint] [--blueprint] [--format svg-frame|svg|html|storyboard-svg]
  export --input scene.json --root DIR --output FILE --format svg-frame|svg|html|storyboard-svg|gif|mp4|webm [--style default|blueprint] [--blueprint] [--transparent]

All export paths are relative to --root. Existing files and paths escaping that root are rejected.
`);
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { command, values, flags } = parseArgs(argv);
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (command === "discover") {
    const filter: ActionCatalogFilter = {
      ...(values.has("category") ? { category: values.get("category")! } : {}),
      ...(values.has("tag") ? { tag: values.get("tag")! } : {}),
      ...(values.has("prop") ? { prop: values.get("prop")! } : {}),
      ...(values.has("kind") ? { kind: values.get("kind")! } : {}),
      ...(values.has("travel") ? { travel: values.get("travel")! } : {}),
      ...(values.has("search") ? { search: values.get("search")! } : {})
    };
    console.log(JSON.stringify(queryActionCatalog(filter), null, 2));
    return 0;
  }
  if (command === "describe") {
    const item = describeAction(required(values, "id"));
    if (!item) throw new Error(`Unknown action ID. Supported IDs: ${actionCatalog.map((a) => a.id).join(", ")}.`);
    console.log(JSON.stringify(item, null, 2));
    return 0;
  }
  if (command === "schema") {
    const version = values.get("version") ?? "v1";
    if (version !== "v1" && version !== "v2" && version !== "movie-v1") {
      throw new Error('Schema --version must be "v1", "v2", or "movie-v1".');
    }
    const schemaDoc =
      version === "movie-v1"
        ? movieSchema
        : version === "v2"
          ? animationSchemaV2
          : animationSchema;
    console.log(JSON.stringify(schemaDoc, null, 2));
    return 0;
  }
  if (command === "validate") {
    const result = validateAnyAnimation(await loadSpec(required(values, "input")));
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }
  if (command === "compile") {
    const loaded = await loadSpec(required(values, "input"));
    if (isMovieInput(loaded)) {
      const composed = composeMovie(loaded);
      if (!composed.valid || !composed.movie) {
        console.log(JSON.stringify({ valid: false, diagnostics: composed.diagnostics }, null, 2));
        return 1;
      }
      console.log(JSON.stringify({ valid: true, diagnostics: [], program: composed.movie }, null, 2));
      return 0;
    }
    const result = compileAnyAnimation(loaded);
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }
  if (command === "choreograph") {
    const res = choreographAnimation(await loadSpec(required(values, "input")));
    if (!res.valid || !res.program || !res.spec) {
      console.log(JSON.stringify({ valid: false, diagnostics: res.diagnostics }, null, 2));
      return 1;
    }
    console.log(
      JSON.stringify(
        {
          valid: true,
          diagnostics: res.diagnostics,
          spec: res.spec,
          events: res.program.events ?? [],
          summary: summarizeChoreography(res.program)
        },
        null,
        2
      )
    );
    return 0;
  }
  if (command === "movie") {
    const composed = composeMovie((await loadSpec(required(values, "input"))) as MovieSpecInput);
    if (!composed.valid || !composed.movie) {
      console.log(JSON.stringify({ valid: false, diagnostics: composed.diagnostics }, null, 2));
      return 1;
    }
    const movie = composed.movie;
    const report = flags.has("critique") ? evaluateAnimationQuality(movie) : undefined;
    console.log(
      JSON.stringify(
        {
          valid: true,
          diagnostics: [],
          spec: movie.spec,
          durationMs: movie.durationMs,
          sceneCount: movie.scenes.length,
          scenes: movie.scenes.map((scene) => ({
            id: scene.id,
            index: scene.index,
            ...(scene.title !== undefined ? { title: scene.title } : {}),
            ...(scene.caption !== undefined ? { caption: scene.caption } : {}),
            backdrop: scene.backdrop,
            transition: scene.transition,
            startMs: scene.startMs,
            endMs: scene.endMs,
            durationMs: scene.durationMs,
            trimmedIdleMs: scene.trimmedIdleMs
          })),
          events: movie.events,
          ...(report !== undefined ? { report } : {})
        },
        null,
        2
      )
    );
    return 0;
  }
  if (command === "critique") {
    const resolvedInput = compileOrComposeInput(await loadSpec(required(values, "input")));
    if (!resolvedInput.valid) {
      console.error(JSON.stringify(resolvedInput.diagnostics, null, 2));
      return 1;
    }
    const columns = parseIntOption(values, "columns", 1, 8);
    const maxPanels = parseIntOption(values, "max-panels", 2, 16);
    const theme = parseStoryboardTheme(values, flags) ?? "default";
    const report = evaluateAnimationQuality(resolvedInput.target);
    if (flags.has("json")) {
      console.log(JSON.stringify(report, null, 2));
      return 0;
    }
    process.stdout.write(
      renderCritiqueSheetSvg(resolvedInput.target, report, {
        ...(columns !== undefined ? { columns } : {}),
        ...(maxPanels !== undefined ? { maxPanels } : {}),
        theme
      })
    );
    return 0;
  }
  if (command === "embed") {
    const resolvedInput = compileOrComposeInput(await loadSpec(required(values, "input")));
    if (!resolvedInput.valid) {
      console.error(JSON.stringify(resolvedInput.diagnostics, null, 2));
      return 1;
    }
    const target = required(values, "target");
    if (!isDeckEmbedTarget(target)) {
      throw new Error(`Embed --target must be one of: ${DECK_EMBED_TARGETS.join(", ")}.`);
    }
    const title = values.get("title");
    const assetPath = values.get("asset-path");
    const controls = flags.has("controls") ? true : undefined;
    const scrollScrub = flags.has("scroll-scrub") ? true : undefined;
    const blueprint = flags.has("blueprint") ? true : undefined;
    process.stdout.write(
      generateDeckEmbed(resolvedInput.target, target, {
        ...(title !== undefined ? { title } : {}),
        ...(assetPath !== undefined ? { assetPath } : {}),
        ...(controls !== undefined ? { controls } : {}),
        ...(scrollScrub !== undefined ? { scrollScrub } : {}),
        ...(blueprint !== undefined ? { blueprint } : {})
      })
    );
    return 0;
  }
  if (command === "storyboard") {
    const resolvedInput = compileOrComposeInput(await loadSpec(required(values, "input")));
    if (!resolvedInput.valid) {
      console.error(JSON.stringify(resolvedInput.diagnostics, null, 2));
      return 1;
    }
    const columns = parseIntOption(values, "columns", 1, 8);
    const maxPanels = parseIntOption(values, "max-panels", 2, 16);
    const mode = (values.get("mode") ?? "normal") as PlaybackMode;
    if (!["normal", "reduced", "static"].includes(mode)) throw new Error("Mode must be normal, reduced, or static.");
    const theme = parseStoryboardTheme(values, flags) ?? "default";
    if (flags.has("lint-only")) {
      console.log(JSON.stringify(analyzeProgramOrMovieStoryboard(resolvedInput.target), null, 2));
      return 0;
    }
    const sbOptions = {
      ...(columns !== undefined ? { columns } : {}),
      ...(maxPanels !== undefined ? { maxPanels } : {}),
      mode,
      theme
    };
    process.stdout.write(
      isCompiledMovie(resolvedInput.target)
        ? renderMovieStoryboardSvg(resolvedInput.target, sbOptions)
        : renderStoryboardSvg(resolvedInput.target, sbOptions)
    );
    return 0;
  }
  if (command === "preview") {
    const resolvedInput = compileOrComposeInput(await loadSpec(required(values, "input")));
    if (!resolvedInput.valid) {
      console.error(JSON.stringify(resolvedInput.diagnostics, null, 2));
      return 1;
    }
    const format = (values.get("format") ?? "svg") as PreviewFormat;
    if (!(PREVIEW_FORMATS as readonly string[]).includes(format)) {
      throw new Error("Preview format must be svg-frame, svg, html, or storyboard-svg.");
    }
    const mode = values.has("mode") ? (values.get("mode") as PlaybackMode) : undefined;
    if (mode !== undefined && !["normal", "reduced", "static"].includes(mode)) {
      throw new Error("Mode must be normal, reduced, or static.");
    }
    const timeMs = values.has("time") ? Number(values.get("time")) : undefined;
    if (timeMs !== undefined && !Number.isFinite(timeMs)) throw new Error("--time must be a finite number of milliseconds.");
    const columns = parseIntOption(values, "columns", 1, 8);
    const maxPanels = parseIntOption(values, "max-panels", 2, 16);
    const theme = parseStoryboardTheme(values, flags);
    const style = parseRenderStyle(values, flags);
    process.stdout.write(
      renderArtifact(resolvedInput.target, format, {
        ...(timeMs !== undefined ? { timeMs } : {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(style !== undefined ? { style } : {}),
        ...(columns !== undefined ? { columns } : {}),
        ...(maxPanels !== undefined ? { maxPanels } : {}),
        ...(theme !== undefined ? { theme } : {})
      })
    );
    return 0;
  }
  if (command === "export") {
    const resolvedInput = compileOrComposeInput(await loadSpec(required(values, "input")));
    if (!resolvedInput.valid) {
      console.error(JSON.stringify(resolvedInput.diagnostics, null, 2));
      return 1;
    }
    const format = required(values, "format") as ExportFormat;
    if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
      throw new Error("Format must be svg-frame, svg, html, storyboard-svg, gif, mp4, or webm.");
    }
    const mode = values.has("mode") ? (values.get("mode") as PlaybackMode) : undefined;
    if (mode !== undefined && !["normal", "reduced", "static"].includes(mode)) {
      throw new Error("Mode must be normal, reduced, or static.");
    }
    const timeMs = values.has("time") ? Number(values.get("time")) : undefined;
    if (timeMs !== undefined && !Number.isFinite(timeMs)) throw new Error("--time must be a finite number of milliseconds.");
    const columns = parseIntOption(values, "columns", 1, 8);
    const maxPanels = parseIntOption(values, "max-panels", 2, 16);
    const theme = parseStoryboardTheme(values, flags);
    const style = parseRenderStyle(values, flags);
    const transparent = flags.has("transparent") ? true : undefined;
    const outcome = await exportAnimation(resolvedInput.target, required(values, "root"), required(values, "output"), format, {
      ...(timeMs !== undefined ? { timeMs } : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(style !== undefined ? { style } : {}),
      ...(transparent !== undefined ? { transparent } : {}),
      ...(columns !== undefined ? { columns } : {}),
      ...(maxPanels !== undefined ? { maxPanels } : {}),
      ...(theme !== undefined ? { theme } : {})
    });
    console.log(JSON.stringify(outcome, null, 2));
    return 0;
  }
  throw new Error(`Unknown command "${command}". Run "stickman help" for supported commands.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
