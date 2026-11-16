#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  CONTRACT_VERSION_V2,
  actionCatalog,
  analyzeStoryboard,
  animationSchema,
  animationSchemaV2,
  choreographAnimation,
  compileAnimation,
  compileV2Animation,
  describeAction,
  exportAnimation,
  queryActionCatalog,
  renderArtifact,
  renderStoryboardSvg,
  validateAnimation,
  validateV2Animation,
  type ActionCatalogFilter,
  type AnimationSpec,
  type AnimationSpecV2,
  type CompileResult,
  type CompiledAnimation,
  type ExportFormat,
  type PlaybackMode,
  type ValidationResult
} from "./index.js";

const BOOLEAN_FLAGS = new Set(["lint-only"]);
type PreviewFormat = "svg-frame" | "svg" | "html" | "storyboard-svg";
const PREVIEW_FORMATS: readonly PreviewFormat[] = ["svg-frame", "svg", "html", "storyboard-svg"];
const EXPORT_FORMATS: readonly ExportFormat[] = ["svg-frame", "svg", "html", "storyboard-svg", "gif", "mp4"];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAnyAnimation(input: unknown): ValidationResult {
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
  schema [--version v1|v2]         Print the strict JSON Schema (default v1)
  validate --input scene.json      Validate v1, v2, or choreography scene
  compile --input scene.json       Compile a canonical program as JSON
  choreograph --input scene.json   Auto-choreograph a v2 scene to JSON
  storyboard --input scene.json [--columns N] [--max-panels N] [--mode normal|reduced|static] [--lint-only]
  preview --input scene.json [--time MS] [--mode normal|reduced|static] [--format svg-frame|svg|html|storyboard-svg]
  export --input scene.json --root DIR --output FILE --format svg-frame|svg|html|storyboard-svg|gif|mp4

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
    if (version !== "v1" && version !== "v2") throw new Error('Schema --version must be "v1" or "v2".');
    console.log(JSON.stringify(version === "v2" ? animationSchemaV2 : animationSchema, null, 2));
    return 0;
  }
  if (command === "validate") {
    const result = validateAnyAnimation(await loadSpec(required(values, "input")));
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }
  if (command === "compile") {
    const result = compileAnyAnimation(await loadSpec(required(values, "input")));
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
  if (command === "storyboard") {
    const compiled = compileAnyAnimation(await loadSpec(required(values, "input")));
    if (!compiled.valid || !compiled.program) {
      console.error(JSON.stringify(compiled.diagnostics, null, 2));
      return 1;
    }
    const columns = parseIntOption(values, "columns", 1, 8);
    const maxPanels = parseIntOption(values, "max-panels", 2, 16);
    const mode = (values.get("mode") ?? "normal") as PlaybackMode;
    if (!["normal", "reduced", "static"].includes(mode)) throw new Error("Mode must be normal, reduced, or static.");
    if (flags.has("lint-only")) {
      console.log(JSON.stringify(analyzeStoryboard(compiled.program), null, 2));
      return 0;
    }
    process.stdout.write(
      renderStoryboardSvg(compiled.program, {
        ...(columns !== undefined ? { columns } : {}),
        ...(maxPanels !== undefined ? { maxPanels } : {}),
        mode
      })
    );
    return 0;
  }
  if (command === "preview") {
    const result = compileAnyAnimation(await loadSpec(required(values, "input")));
    if (!result.valid || !result.program) {
      console.error(JSON.stringify(result.diagnostics, null, 2));
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
    process.stdout.write(
      renderArtifact(result.program, format, {
        ...(timeMs !== undefined ? { timeMs } : {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(columns !== undefined ? { columns } : {}),
        ...(maxPanels !== undefined ? { maxPanels } : {})
      })
    );
    return 0;
  }
  if (command === "export") {
    const result = compileAnyAnimation(await loadSpec(required(values, "input")));
    if (!result.valid || !result.program) {
      console.error(JSON.stringify(result.diagnostics, null, 2));
      return 1;
    }
    const format = required(values, "format") as ExportFormat;
    if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
      throw new Error("Format must be svg-frame, svg, html, storyboard-svg, gif, or mp4.");
    }
    const mode = values.has("mode") ? (values.get("mode") as PlaybackMode) : undefined;
    if (mode !== undefined && !["normal", "reduced", "static"].includes(mode)) {
      throw new Error("Mode must be normal, reduced, or static.");
    }
    const timeMs = values.has("time") ? Number(values.get("time")) : undefined;
    if (timeMs !== undefined && !Number.isFinite(timeMs)) throw new Error("--time must be a finite number of milliseconds.");
    const columns = parseIntOption(values, "columns", 1, 8);
    const maxPanels = parseIntOption(values, "max-panels", 2, 16);
    const outcome = await exportAnimation(result.program, required(values, "root"), required(values, "output"), format, {
      ...(timeMs !== undefined ? { timeMs } : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(columns !== undefined ? { columns } : {}),
      ...(maxPanels !== undefined ? { maxPanels } : {})
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
