import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as policy from "./policy.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// Reject path escapes and symlinks in every component, not just the leaf.
export async function readAllowed(root, name) {
  if (isAbsolute(name) || !/^[A-Za-z0-9._/-]+$/.test(name) ||
      name.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe allowlist path: ${name}`);
  }
  let current = resolve(root);
  if (!(await lstat(current)).isDirectory() || (await lstat(current)).isSymbolicLink()) {
    throw new Error("Input root must be a real directory.");
  }
  for (const part of name.split("/")) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink refused: ${name}`);
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Not a regular file: ${name}`);
  return readFile(current);
}

export async function audit(root) {
  const pkg = JSON.parse(await readAllowed(root, "package.json"));
  if (typeof pkg.version !== "string" ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw new Error("A safe release version is required.");
  }
  const files = [];
  for (const path of [...policy.sourceFiles, ...policy.licenseFiles]) {
    const bytes = await readAllowed(root, path);
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const readme = await readAllowed(root, "scripts/release/README.md");
  files.push({ path: "scripts/release/README.md", bytes: readme.length, sha256: sha256(readme) });
  const blockers = [...policy.blockers];
  if (files.some(file => policy.approvedInputs[file.path] !== file.sha256) ||
      Object.keys(policy.approvedInputs).length !== files.length) {
    blockers.push("Inputs do not exactly match the reviewed SHA-256 allowlist in policy.approvedInputs.");
  }
  return {
    schema: "stickman.release-audit/v1", version: pkg.version,
    scope: "core-library-and-cli-only", ready: blockers.length === 0,
    blockers, licenseInventory: policy.inventory, files,
    excluded: ["MCP and film tools", "site", "presentations", "motions specs and review ledgers",
      "existing dist", "examples", "node_modules", ".git/history", ".env", ".playwright-mcp"]
  };
}

async function listFiles(root, prefix = "") {
  const result = [];
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error(`Staging symlink refused: ${name}`);
    if (item.isDirectory()) result.push(...await listFiles(root, name));
    else if (item.isFile()) result.push(name);
    else throw new Error(`Unexpected staging entry: ${name}`);
  }
  return result.sort();
}

// Exported for isolated fixture tests. Real preparation always supplies audit(root).
export async function stageCandidate(root, stage, report) {
  if (!report.ready || report.blockers.length) {
    throw new Error(`Release blocked:\n- ${report.blockers.join("\n- ")}`);
  }
  const inputs = new Map();
  for (const file of report.files) {
    const bytes = await readAllowed(root, file.path);
    if (sha256(bytes) !== file.sha256) throw new Error(`Input changed since audit: ${file.path}`);
    inputs.set(file.path, bytes);
  }
  for (const name of policy.sourceFiles) {
    await mkdir(dirname(join(stage, name)), { recursive: true });
    await writeFile(join(stage, name), inputs.get(name), { flag: "wx" });
  }
  await writeFile(join(stage, "package.json"), JSON.stringify({ type: "module" }), { flag: "wx" });
  const config = join(stage, "tsconfig.json");
  await writeFile(config, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
      strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
      skipLibCheck: true, declaration: true, types: ["node"],
      typeRoots: [join(root, "node_modules/@types")],
      paths: { "@resvg/resvg-js": [join(root, "node_modules/@resvg/resvg-js/index.d.ts")] },
      rootDir: join(stage, "src"), outDir: join(stage, "dist")
    },
    files: policy.sourceFiles.map(name => join(stage, name))
  }), { flag: "wx" });
  const compiler = join(root, "node_modules/typescript/bin/tsc");
  try {
    execFileSync(process.execPath, [compiler, "--project", config], { cwd: root, stdio: "pipe" });
  } catch (error) {
    throw new Error(`Isolated release compilation failed:\n${error.stdout?.toString() ?? error.message}`);
  }
  await rm(config);
  for (const name of policy.licenseFiles) {
    await writeFile(join(stage, name), inputs.get(name), { flag: "wx" });
  }
  await writeFile(join(stage, "README.md"), inputs.get("scripts/release/README.md"), { flag: "wx" });
  const compiled = await listFiles(join(stage, "dist"));
  const expected = policy.sourceFiles.flatMap(name => {
    const base = name.replace(/^src\//, "").replace(/\.ts$/, "");
    return [`${base}.js`, `${base}.d.ts`];
  }).sort();
  if (JSON.stringify(compiled) !== JSON.stringify(expected)) {
    throw new Error("Unexpected compiled files; review transitive runtime dependencies.");
  }
  const exports = Object.fromEntries(["index", "browser", "room", "keyboard"].map(name => [
    name === "index" ? "." : `./${name}`,
    { types: `./dist/${name}.d.ts`, import: `./dist/${name}.js` }
  ]));
  await writeFile(join(stage, "package.json"), JSON.stringify({
    name: "@vallahrich/stickman-core", version: report.version, private: true,
    license: "SEE LICENSE IN LICENSE", type: "module", engines: { node: ">=20" },
    bin: { stickman: "./dist/cli.js" }, exports,
    files: ["dist", "README.md", "LICENSE", "NOTICE", "release-manifest.json"]
  }, null, 2));
  const payload = ["package.json", "README.md", ...policy.licenseFiles, ...compiled.map(name => `dist/${name}`)].sort();
  const files = [];
  for (const path of payload) {
    const bytes = await readFile(join(stage, path));
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  await writeFile(join(stage, "release-manifest.json"), JSON.stringify({
    schema: "stickman.release-manifest/v1", version: report.version, scope: report.scope,
    licenseInventory: report.licenseInventory, files
  }, null, 2), { flag: "wx" });
  await rm(join(stage, "src"), { recursive: true });
  return [...payload, "release-manifest.json"].sort();
}

export function npmPack(stage, args = []) {
  const npm = process.env.npm_execpath;
  if (!npm || !isAbsolute(npm)) throw new Error("Run through npm run release:prepare (npm CLI path required).");
  return JSON.parse(execFileSync(process.execPath, [npm, "pack", "--ignore-scripts",
    "--offline", "--json", ...args], { cwd: stage, encoding: "utf8" }));
}

export async function prepare(root) {
  const report = await audit(root);
  if (!report.ready) throw new Error(`Release blocked:\n- ${report.blockers.join("\n- ")}`);
  const stage = await mkdtemp(join(tmpdir(), "stickman-release-"));
  try {
    const expected = await stageCandidate(root, stage, report);
    const [dry] = npmPack(stage, ["--dry-run"]);
    if (JSON.stringify(dry.files.map(file => file.path).sort()) !== JSON.stringify(expected)) {
      throw new Error("npm pack file list differs from the reviewed staging allowlist.");
    }
    const [packed] = npmPack(stage);
    if (JSON.stringify(packed.files.map(file => file.path).sort()) !== JSON.stringify(expected)) {
      throw new Error("Packed tarball file list differs from the reviewed staging allowlist.");
    }
    const output = join(root, ".release-local");
    try { await mkdir(output); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await lstat(output);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe release output directory.");
    const bytes = await readFile(join(stage, packed.filename));
    const target = join(output, packed.filename);
    await writeFile(target, bytes, { flag: "wx" });
    return { artifact: relative(root, target), sha256: sha256(bytes), files: expected };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !["check", "prepare"].includes(args[0])) {
      throw new Error("Use npm run release:check or npm run release:prepare; no publication command exists.");
    }
    const report = args[0] === "check" ? await audit(root) : await prepare(root);
    console.log(JSON.stringify(report, null, 2));
    if (report.ready === false) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
