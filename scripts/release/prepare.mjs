import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as policy from "./policy.mjs";
import { zipDirectory } from "./zip.mjs";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const safeVersion = value => {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)) return false;
  const prerelease = value.indexOf("-") >= 0 ? value.slice(value.indexOf("-") + 1) : "";
  return !prerelease.split(".").some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"));
};

export async function readAllowed(root, name) {
  if (isAbsolute(name) || !/^[A-Za-z0-9@._/-]+$/.test(name) ||
      name.split("/").some(part => !part || part === "." || part === "..")) throw new Error(`Unsafe allowlist path: ${name}`);
  let current = resolve(root);
  if (!(await lstat(current)).isDirectory() || (await lstat(current)).isSymbolicLink()) throw new Error("Input root must be a real directory.");
  for (const part of name.split("/")) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink refused: ${name}`);
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Not a regular file: ${name}`);
  return readFile(current);
}

export async function listFiles(root, prefix = "") {
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

// Bounded candidate scan, not a promise that all history or all secrets are clean.
export function scanPublicText(name, bytes) {
  if (!/\.(?:ts|mjs|js|json|html|css|md)$/.test(name) && !["NOTICE", "LICENSE"].includes(name)) return;
  const text = bytes.toString("utf8");
  if (/C:\\Users\\|OneDrive - Microsoft|github\.com\/t-vwallerich_microsoft|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/i.test(text)) {
    throw new Error(`Potential private content in candidate input: ${name}`);
  }
}

async function dependencyInventory(root) {
  const lock = JSON.parse(await readAllowed(root, "package-lock.json"));
  const result = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.dev) continue;
    let manifest;
    try { manifest = JSON.parse(await readAllowed(root, `${path}/package.json`)); }
    catch (error) {
      if (error.code === "ENOENT" && entry.optional) continue;
      throw error;
    }
    const license = manifest.license ?? manifest.licenses?.map(entry => entry.type).join(" OR ");
    if (!manifest.name || !manifest.version || !license) throw new Error(`Missing dependency license metadata: ${path}`);
    result.push({ name: manifest.name, version: manifest.version, license,
      bundled: false, evidence: `${path}/package.json` });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function motionOrigin(spec, path) {
  if (spec.source?.dataset === "CMU") {
    const match = spec.source.file?.match(/^(\d+)_(\d+)\.bvh$/);
    if (!match || Number(match[1]) !== Number(spec.source.subject) || Number(match[2]) !== Number(spec.source.trial) ||
        (spec.source.url && !spec.source.url.endsWith(`/${spec.source.file}`))) {
      throw new Error(`Inconsistent CMU trial/file provenance: ${path}`);
    }
    return { id: spec.id, dataset: "CMU", file: spec.source.file,
      subject: spec.source.subject, trial: spec.source.trial, terms: "CMU permission; no standalone dataset resale" };
  }
  if (spec.source?.dataset === "authored" || (policy.authoredLegacyIds.includes(spec.id) && spec.poseKeys?.length)) {
    return { id: spec.id, dataset: "authored", terms: "MIT original key-pose specification" };
  }
  throw new Error(`Unknown motion provenance: ${path}`);
}

export async function audit(root, version) {
  const pkg = JSON.parse(await readAllowed(root, "package.json"));
  version ??= `${pkg.version}-rc.1`;
  if (!safeVersion(version)) throw new Error("A safe SemVer candidate version is required.");
  if (new Set(policy.inputFiles).size !== policy.inputFiles.length) throw new Error("Duplicate release input.");
  const files = [];
  for (const path of [...policy.inputFiles, "package-lock.json"]) {
    const bytes = await readAllowed(root, path);
    // Build tooling is hashed for provenance but is not distributed. The
    // scanner's own test signatures must not be mistaken for leaked content.
    if (!policy.buildToolFiles.includes(path)) scanPublicText(path, bytes);
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  // Every spec must identify its origin. Unknown data does not enter even a local candidate.
  const motionOrigins = [];
  for (const path of policy.motionFiles) {
    motionOrigins.push(motionOrigin(JSON.parse(await readAllowed(root, path)), path));
  }
  // Verify compact embedded data's trial/file identities directly from the
  // audited generated source JSON, never from an old dist or raw BVH checkout.
  const fixtureOrigins = [];
  for (const path of ["src/motion-clips.ts", "src/generated/motion-library.ts"]) {
    const text = (await readAllowed(root, path)).toString();
    const literal = text.match(/export const (?:MOTION_CLIP_LIBRARY|GENERATED_MOTION_LIBRARY)(?::[^=]+)? = (\{[^\r\n]*\})(?: as MotionClipLibrary)?;/);
    if (!literal) throw new Error(`Cannot inspect embedded provenance: ${path}`);
    for (const [id, clip] of Object.entries(JSON.parse(literal[1]).clips)) {
      const origin = motionOrigin({ id, source: { dataset: "CMU", ...clip.source } }, path);
      if (clip.meta?.source?.trial && clip.meta.source.trial !== `${origin.subject}_${origin.trial}`) {
        throw new Error(`Inconsistent embedded trial: ${path}/${id}`);
      }
      fixtureOrigins.push({ ...origin, input: path });
    }
  }
  return { schema: "stickman.release-audit/v2", version, scope: policy.scope, ready: true,
    publicationApproved: false, status: "local-review-required", blockers: [...policy.blockers],
    licenseInventory: policy.inventory, dependencies: await dependencyInventory(root), motionOrigins, fixtureOrigins, files,
    excluded: [".git/history", "existing dist", "external presentation runtime/deck outputs", "screenshots",
      "private review ledger/ratings", "node_modules/binaries", "raw BVH", "private templates", ".env", ".playwright-mcp"] };
}

async function put(stage, name, bytes) {
  await mkdir(dirname(join(stage, name)), { recursive: true });
  await writeFile(join(stage, name), bytes, { flag: "wx" });
}

export async function fileInventory(root, names) {
  names ??= await listFiles(root);
  const files = [];
  for (const path of names) {
    const bytes = await readAllowed(root, path);
    scanPublicText(path, bytes);
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return files;
}

// Compile a full, clean workspace. No existing dist, private deck or media is reused.
export async function stageCandidate(root, stage, report) {
  if (!report.ready || report.scope !== policy.scope || !safeVersion(report.version)) throw new Error("Candidate preparation blocked.");
  if (JSON.stringify(report.files.map(file => file.path).sort()) !== JSON.stringify([...policy.inputFiles, "package-lock.json"].sort())) {
    throw new Error("Audit input membership differs from the exact product allowlist.");
  }
  const inputs = new Map();
  for (const file of report.files) {
    const bytes = await readAllowed(root, file.path);
    if (sha256(bytes) !== file.sha256) throw new Error(`Input changed since audit: ${file.path}`);
    inputs.set(file.path, bytes);
  }
  const copyInputs = [...policy.sourceFiles, ...policy.runtimeScripts, ...policy.siteInputs,
    ...policy.licenseFiles, ...policy.supportFiles.filter(name => !["package.json", "scripts/release/README.md", "docs/motion-catalog-plan.md"].includes(name))];
  const readme = inputs.get("scripts/release/README.md").toString().replaceAll("0.1.0-rc.1", report.version);
  for (const name of copyInputs) {
    // Installed setup docs describe installation, not access to the private checkout.
    await put(stage, name, ["docs/mcp-setup.md", "docs/agent-integration.md"].includes(name) ? readme : inputs.get(name));
  }
  for (const name of policy.motionFiles) {
    const spec = JSON.parse(inputs.get(name));
    const { notes, ...publicSpec } = spec;
    if (policy.authoredLegacyIds.includes(spec.id) && spec.source?.dataset !== "CMU") {
      publicSpec.source = { ...spec.source, dataset: "authored", provenance: "Original repository key-pose specification; see LICENSE and docs/rights.md" };
    }
    publicSpec.tags = (publicSpec.tags ?? []).filter(tag => !/^(candidate|approved|rework|review|draft)(?:-|$)/i.test(tag));
    await put(stage, name, JSON.stringify(publicSpec, null, 2));
  }
  // Retain actual approval state, strip all free-text review notes and ratings.
  const { parseCatalogue } = await import("../site/catalogue.mjs");
  const rows = parseCatalogue(inputs.get("docs/motion-catalog-plan.md").toString())
    .map(({ id, status, family }) => ({ id, status, family }));
  await put(stage, "motions/catalogue.json", JSON.stringify({ version: 1, rows }, null, 2));
  const original = JSON.parse(inputs.get("package.json"));
  const compiled = policy.sourceFiles.flatMap(name => {
    const base = name.replace(/^src\//, "").replace(/\.ts$/, "");
    return [`dist/${base}.js`, `dist/${base}.d.ts`];
  }).sort();
  const payload = [...compiled, ...policy.runtimeScripts, ...policy.motionFiles, ...policy.licenseFiles,
    "motions/catalogue.json", "motions/poses/poses.json", "motions/review-props.json", "motions/join-matrix.json",
    "site/styles.css", "examples/wave.json", "examples/films/team-handoff.json", "examples/films/bridge-demo.json",
    "README.md", "package.json", "release-manifest.json"].sort();
  const pkg = {
    name: "@vallahrich/stickman-mcp", version: report.version, private: true, type: "module",
    description: original.description, license: "SEE LICENSE IN NOTICE", engines: original.engines,
    repository: { type: "git", url: "https://github.com/vallahrich/stickman-mcp" },
    bin: original.bin, exports: original.exports,
    dependencies: original.dependencies, optionalDependencies: original.optionalDependencies,
    scripts: { start: "node dist/cli.js", mcp: "node dist/mcp.js" },
    files: payload
  };
  await put(stage, "package.json", JSON.stringify(pkg, null, 2));
  await put(stage, "README.md", readme);
  // The compiler and isolated scripts need dependencies. This temporary junction
  // is never an archive member and is removed before every inventory/pack step.
  await symlink(join(root, "node_modules"), join(stage, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  try {
    execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--project", join(stage, "tsconfig.json")], { cwd: stage, stdio: "pipe" });
  } catch (error) {
    throw new Error(`Isolated full-product compilation failed:\n${error.stdout?.toString() ?? error.message}`);
  } finally {
    await rm(join(stage, "node_modules"), { force: true });
  }
  if (JSON.stringify((await listFiles(join(stage, "dist"))).map(name => `dist/${name}`)) !== JSON.stringify(compiled)) {
    throw new Error("Unexpected compiled runtime inventory.");
  }
  await put(stage, "release-manifest.json", JSON.stringify({
    schema: "stickman.release-manifest/v2", version: report.version, scope: report.scope,
    publicationApproved: false, status: report.status, blockers: report.blockers,
    licenseInventory: report.licenseInventory, dependencies: report.dependencies,
    motionOrigins: report.motionOrigins, fixtureOrigins: report.fixtureOrigins,
    inputs: report.files, files: await fileInventory(stage, payload.filter(name => name !== "release-manifest.json"))
  }, null, 2));
  return payload;
}

export function npmPack(stage, args = []) {
  const npm = process.env.npm_execpath;
  if (!npm || !isAbsolute(npm)) throw new Error("Run through npm run release:prepare (npm CLI path required).");
  return JSON.parse(execFileSync(process.execPath, [npm, "pack", "--ignore-scripts", "--offline", "--json", ...args],
    { cwd: stage, encoding: "utf8" }));
}

export async function prepare(root, version) {
  const report = await audit(root, version);
  const output = join(root, ".release-local");
  await mkdir(output, { recursive: true });
  if ((await lstat(output)).isSymbolicLink()) throw new Error("Unsafe release output directory.");
  const target = join(output, report.version);
  // No overwrite: a new review candidate requires a new version.
  await mkdir(target);
  const temporary = await mkdtemp(join(tmpdir(), "stickman-product-"));
  const stage = join(temporary, "workspace"), site = join(temporary, "site");
  await mkdir(stage);
  try {
    const expected = await stageCandidate(root, stage, report);
    for (const args of [["--dry-run"], []]) {
      const [packed] = npmPack(stage, args);
      if (JSON.stringify(packed.files.map(file => file.path).sort()) !== JSON.stringify(expected)) throw new Error("npm pack differs from exact product inventory.");
      if (!args.length) await put(target, packed.filename, await readAllowed(stage, packed.filename));
    }
    // Source snapshot is explicit and sanitized, without compiled/private outputs.
    const source = join(temporary, "source");
    await mkdir(source);
    const sourceNames = [...policy.sourceFiles, ...policy.runtimeScripts, ...policy.siteInputs,
      ...policy.licenseFiles, ...policy.motionFiles,
      ...policy.supportFiles.filter(name => !["package.json", "scripts/release/README.md", "docs/motion-catalog-plan.md"].includes(name)),
      "motions/catalogue.json", "README.md"].sort();
    for (const name of sourceNames) await put(source, name, await readAllowed(stage, name));
    const sourcePackage = JSON.parse(await readAllowed(stage, "package.json"));
    const originalPackageBytes = await readAllowed(root, "package.json");
    if (sha256(originalPackageBytes) !== report.files.find(file => file.path === "package.json").sha256) {
      throw new Error("Input changed since audit: package.json");
    }
    const originalPackage = JSON.parse(originalPackageBytes);
    await put(source, "package.json", JSON.stringify({ ...sourcePackage,
      devDependencies: originalPackage.devDependencies, scripts: { ...sourcePackage.scripts,
        build: "tsc -p tsconfig.json", typecheck: "tsc -p tsconfig.json --noEmit",
        "site:build": "node scripts/site/build.mjs", "site:showcase": "node --expose-gc scripts/release/native-showcase.mjs"
      } }, null, 2));
    await put(source, "release-manifest.json", JSON.stringify({ schema: "stickman.source-manifest/v1",
      version: report.version, scope: report.scope, publicationApproved: false,
      licenseInventory: report.licenseInventory, inputs: report.files, files: await fileInventory(source)
    }, null, 2));
    await put(target, `stickman-source-${report.version}.zip`, await zipDirectory(source));
    await symlink(join(root, "node_modules"), join(stage, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    try {
      // Separate process resolves its assets only from the fresh staged workspace.
      execFileSync(process.execPath, ["--expose-gc", join(stage, "scripts/release/native-showcase.mjs"), site], { cwd: stage, stdio: "inherit" });
      execFileSync(process.execPath, [join(stage, "scripts/site/build.mjs"), "--release-candidate"], {
        cwd: stage, stdio: "inherit", env: { ...process.env, STICKMAN_SITE_OUTPUT: site }
      });
    } finally { await rm(join(stage, "node_modules"), { force: true }); }
    const siteFiles = await fileInventory(site);
    await put(site, "release-manifest.json", JSON.stringify({ schema: "stickman.site-manifest/v1",
      version: report.version, scope: report.scope, publicationApproved: false,
      nativePresentation: true, files: siteFiles }, null, 2));
    await put(target, `stickman-site-${report.version}.zip`, await zipDirectory(site));
    // Keep an extracted candidate for local inspection; never touch dist/site.
    for (const name of await listFiles(site)) await put(target, `site/${name}`, await readAllowed(site, name));
    const artifacts = await fileInventory(target, (await listFiles(target)).filter(name => !name.startsWith("site/")));
    await put(target, "provenance.json", JSON.stringify({ ...report, artifacts,
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      sourceState: "Input hashes identify exact candidate inputs; commit may precede uncommitted release preparation.",
      verification: "Run installed-product smoke and site checks; not owner sign-off." }, null, 2));
    return { directory: relative(root, target), status: report.status, publicationApproved: false, artifacts };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try {
    const [command, version, ...extra] = process.argv.slice(2);
    if (!["check", "prepare"].includes(command) || extra.length) throw new Error("Use release:check or release:prepare [SemVer]. No publisher exists.");
    console.log(JSON.stringify(command === "check" ? await audit(root, version) : await prepare(root, version), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
