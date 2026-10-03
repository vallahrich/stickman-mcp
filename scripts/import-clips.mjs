import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultSource = "C:\\Users\\t-vwallerich\\.copilot\\session-state\\5151d75e-0e30-46ad-99e0-e3d1bf08e105\\files\\clip-pipeline\\clips";
const source = resolve(process.argv[2] ?? defaultSource);
const names = ["walk", "run", "jump", "stop", "point", "idle", "static-pose"];
const clips = {};
for (const name of names) clips[name] = JSON.parse(readFileSync(join(source, `${name}.json`), "utf8"));
const index = JSON.parse(readFileSync(join(source, "index.json"), "utf8"));
const data = JSON.stringify({ importedAt: "1970-01-01T00:00:00.000Z", source: basename(source), index, clips }).replaceAll("<", "\\u003c");
const template = readFileSync(join(repo, "scripts", "motion-clips-template.ts"), "utf8");
writeFileSync(join(repo, "src", "motion-clips.ts"), template.replace("__CLIP_DATA__", data));
console.log(`Imported ${names.length} clips from ${source}`);
