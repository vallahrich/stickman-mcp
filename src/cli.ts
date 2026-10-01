#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { actionCatalog, compileAnimation, describeAction, exportAnimation, renderArtifact, validateAnimation } from "./index.js";
import { animationSchema } from "./contract-schema.js";
import type { PlaybackMode } from "./contract.js";
import type { ExportFormat } from "./export.js";

function parseArgs(args: string[]): { command: string; values: Map<string, string> } {
  const [command = "help", ...rest] = args;
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const item = rest[i]!;
    if (!item.startsWith("--")) throw new Error(`Unexpected argument "${item}".`);
    const key = item.slice(2);
    if (values.has(key)) throw new Error(`Option --${key} may only be supplied once.`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Option --${key} needs a value.`);
    values.set(key, value);
    i++;
  }
  return { command, values };
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing required option --${key}.`);
  return value;
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
  discover                         List supported versioned actions
  describe --id walk@1.0.0         Describe one action and its bindings
  schema                           Print the versioned JSON Schema
  validate --input scene.json      Validate contract and bindings
  compile --input scene.json       Compile a canonical program as JSON
  preview --input scene.json [--time MS] [--mode normal|reduced|static] [--format svg|html]
  export --input scene.json --root DIR --output FILE --format svg|html|gif|mp4

All export paths are relative to --root. Existing files and paths escaping that root are rejected.
`);
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { command, values } = parseArgs(argv);
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (command === "discover") {
    console.log(JSON.stringify(actionCatalog, null, 2));
    return 0;
  }
  if (command === "describe") {
    const item = describeAction(required(values, "id"));
    if (!item) throw new Error(`Unknown action ID. Supported IDs: ${actionCatalog.map((a) => a.id).join(", ")}.`);
    console.log(JSON.stringify(item, null, 2));
    return 0;
  }
  if (command === "schema") {
    console.log(JSON.stringify(animationSchema, null, 2));
    return 0;
  }
  if (command === "validate") {
    const result = validateAnimation(await loadSpec(required(values, "input")));
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }
  if (command === "compile") {
    const result = compileAnimation(await loadSpec(required(values, "input")));
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }
  if (command === "preview") {
    const result = compileAnimation(await loadSpec(required(values, "input")));
    if (!result.valid || !result.program) {
      console.error(JSON.stringify(result.diagnostics, null, 2));
      return 1;
    }
    const format = (values.get("format") ?? "svg") as "svg" | "html";
    if (format !== "svg" && format !== "html") throw new Error("Preview format must be svg or html.");
    const mode = (values.get("mode") ?? "normal") as PlaybackMode;
    if (!["normal", "reduced", "static"].includes(mode)) throw new Error("Mode must be normal, reduced, or static.");
    const timeMs = values.has("time") ? Number(values.get("time")) : undefined;
    if (timeMs !== undefined && !Number.isFinite(timeMs)) throw new Error("--time must be a finite number of milliseconds.");
    process.stdout.write(renderArtifact(result.program, format, { ...(timeMs === undefined ? {} : { timeMs }), mode }));
    return 0;
  }
  if (command === "export") {
    const result = compileAnimation(await loadSpec(required(values, "input")));
    if (!result.valid || !result.program) {
      console.error(JSON.stringify(result.diagnostics, null, 2));
      return 1;
    }
    const format = required(values, "format") as ExportFormat;
    if (!["svg", "html", "gif", "mp4"].includes(format)) throw new Error("Format must be svg, html, gif, or mp4.");
    const outcome = await exportAnimation(result.program, required(values, "root"), required(values, "output"), format);
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
