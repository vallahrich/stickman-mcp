import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import {
  CONTRACT_VERSION,
  CONTRACT_VERSION_MOVIE,
  CONTRACT_VERSION_V2,
  RUNTIME_MOTION_LIBRARY,
  STAGE_ANCHOR_NAMES,
  actionCatalog,
  analyzeStoryboard,
  animationSchemaV2,
  choreographAnimation,
  compileAnimation,
  composeMovie,
  queryActionCatalog,
  rasterizeStoryboardPng,
  registerStickmanPlayerElement,
  renderAnimatedSvg,
  renderArtifact,
  renderHtml,
  renderStoryboardSvg,
  renderSvgFrame,
  resolveStageAnchors,
  sampleAnimation,
  validateAnimation,
  type AddonType,
  type AnimationSpec,
  type AnimationSpecV2
} from "../src/index.js";
import { createMcpServer } from "../src/mcp.js";

const scratchRoots: string[] = [];
const activeClosers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of activeClosers.splice(0)) {
    await close();
  }
  await Promise.all(
    scratchRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function createWorkspaceTempRoot(prefix: string): Promise<string> {
  const dir = resolve(process.cwd(), `.${prefix}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  scratchRoots.push(dir);
  return dir;
}

function assertWellFormedScriptlessSvg(svg: string, label: string): void {
  expect(svg.length, `${label}: empty SVG`).toBeGreaterThan(0);
  expect(svg, `${label}: script forbidden`).not.toMatch(/<script\b/i);
  expect(svg, `${label}: NaN/Infinity/undefined forbidden`).not.toMatch(/\b(NaN|Infinity|undefined)\b/);
  expect(svg, `${label}: -0 forbidden`).not.toMatch(/(?<![0-9.])-(0(?:\.0+)?)(?![0-9.])/);

  const body = svg.replace(/^<\?xml[^?]*\?>\s*/, "");
  const stack: string[] = [];
  const tagRe = /<\/?([A-Za-z][A-Za-z0-9:-]*)(\s[^<>]*?)?(\/?)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(body)) !== null) {
    const between = body.slice(lastIndex, match.index);
    expect(between, `${label}: unescaped bracket in text`).not.toMatch(/[<>]/);
    lastIndex = tagRe.lastIndex;
    const full = match[0];
    const tag = match[1]!;
    const selfClosing = match[3] === "/";
    if (full.startsWith("</")) {
      expect(stack.pop(), `${label}: closing </${tag}> mismatch`).toBe(tag);
    } else if (!selfClosing) {
      stack.push(tag);
    }
  }
  expect(body.slice(lastIndex), `${label}: trailing unescaped bracket`).not.toMatch(/[<>]/);
  expect(stack, `${label}: unclosed tags`).toEqual([]);
}

async function runCliCaptured(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    logs.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await runCli(argv);
    return { code, stdout: logs.join("\n"), stderr: errors.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.stdout.write = origWrite;
  }
}

describe("v0.3.0 End-to-End Product Simulation Suite", () => {
  it("exports all public v0.3.0 symbols and keeps package.json at 0.3.0", async () => {
    const pkg = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const lock = JSON.parse(await readFile(resolve(process.cwd(), "package-lock.json"), "utf8")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(pkg.version).toBe("0.3.0");
    expect(lock.version).toBe("0.3.0");
    expect(lock.packages[""]?.version).toBe("0.3.0");

    expect(CONTRACT_VERSION_V2).toBe("stickman.animation/v2");
    expect(typeof choreographAnimation).toBe("function");
    expect(typeof resolveStageAnchors).toBe("function");
    expect(typeof queryActionCatalog).toBe("function");
    expect(typeof renderStoryboardSvg).toBe("function");
    expect(typeof analyzeStoryboard).toBe("function");
    expect(typeof rasterizeStoryboardPng).toBe("function");
    expect(typeof registerStickmanPlayerElement).toBe("function");
    expect(STAGE_ANCHOR_NAMES.length).toBeGreaterThanOrEqual(12);
  });

  it("Scenario A (Presentation Narrative): compiles v2-presentation-story.json, passes storyboard lint, and renders SVG, animated SVG, storyboard SVG, and HTML", async () => {
    const storyPath = resolve(process.cwd(), "examples", "v2-presentation-story.json");
    const rawStory = JSON.parse(await readFile(storyPath, "utf8")) as unknown;

    const schemaValidator = new AjvJsonSchemaValidator().getValidator(animationSchemaV2);
    expect(schemaValidator(rawStory).valid).toBe(true);
    expect(validateAnimation(rawStory)).toEqual({ valid: true, diagnostics: [] });

    const choreo = choreographAnimation(rawStory);
    expect(choreo.valid).toBe(true);
    expect(choreo.diagnostics).toEqual([]);
    const compiled = compileAnimation(rawStory);
    expect(compiled.valid).toBe(true);
    const program = compiled.program!;
    expect(program.contractVersion).toBe(CONTRACT_VERSION_V2);

    const spec = program.spec as AnimationSpecV2;
    const presenter = spec.actors[0]!;
    expect(presenter.id).toBe("presenter");
    expect(presenter.accessory).toBe("tie");
    expect(presenter.actions.map((a) => a.action)).toEqual([
      "walk-on",
      "point",
      "think",
      "idea",
      "present-card",
      "swipe-next",
      "cheer",
      "walk-off"
    ]);

    const analysis = analyzeStoryboard(program);
    expect(analysis.outOfBoundsCount).toBe(0);
    expect(analysis.outOfBoundsFrames).toEqual([]);
    expect(analysis.actorOverlapWarnings).toEqual([]);
    expect(analysis.maxSeamStepPx).toBeLessThan(8);
    expect(analysis.addonTypes).toEqual(expect.arrayContaining(["bulb", "card"]));
    expect(analysis.beatSummary).toHaveLength(analysis.panelCount);

    const ideaAct = presenter.actions[3]!;
    const cardAct = presenter.actions[4]!;
    const ideaSvg = renderSvgFrame(program, ideaAct.startMs + ideaAct.durationMs * 0.68);
    const cardSvg = renderArtifact(program, "svg-frame", {
      timeMs: cardAct.startMs + cardAct.durationMs * 0.55
    });
    assertWellFormedScriptlessSvg(ideaSvg, "Scenario A idea frame");
    assertWellFormedScriptlessSvg(cardSvg, "Scenario A present-card frame");
    expect(ideaSvg).toContain('data-actor="presenter"');
    expect(ideaSvg).toContain('data-accessory="tie"');
    expect(ideaSvg).toContain('data-addon="bulb"');
    expect(cardSvg).toContain('data-addon="card"');
    expect(cardSvg).toContain("v0.2");

    const animatedSvg = renderAnimatedSvg(program);
    assertWellFormedScriptlessSvg(animatedSvg, "Scenario A animated SVG");
    expect(animatedSvg).toContain("@keyframes sm-slice");
    expect(animatedSvg).toContain("prefers-reduced-motion:reduce");

    const storyboardSvg = renderStoryboardSvg(program, { columns: 4, maxPanels: 8 });
    assertWellFormedScriptlessSvg(storyboardSvg, "Scenario A storyboard SVG");
    expect(storyboardSvg).toContain("Stickman storyboard");
    expect((storyboardSvg.match(/data-panel="/g) ?? []).length).toBe(8);

    const rasterized = await rasterizeStoryboardPng(storyboardSvg);
    expect(typeof rasterized.rasterizerAvailable).toBe("boolean");
    if (rasterized.rasterizerAvailable) {
      expect(rasterized.pngBase64).toBeDefined();
      const bytes = Buffer.from(rasterized.pngBase64!, "base64");
      expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }

    const html = renderHtml(program);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('id="stickman-player"');
    expect(html).not.toMatch(/<(?:script|link|img)\b[^>]+(?:src|href)=["']https?:\/\//i);
    const stageMatch = /<div id="stage">([\s\S]+?)<\/div><\/main>/.exec(html);
    expect(stageMatch).not.toBeNull();
    expect(stageMatch![1]).toBe(renderSvgFrame(program, 0));

    const scriptMatch = /<script id="stickman-player">([\s\S]+?)<\/script>/.exec(html);
    expect(scriptMatch).not.toBeNull();
    const makeDomNode = (initialText = "") => {
      const listeners = new Map<string, () => void>();
      return {
        value: "",
        textContent: initialText,
        innerHTML: "",
        listeners,
        setAttribute() {},
        addEventListener(type: string, fn: () => void) {
          listeners.set(type, fn);
        }
      };
    };
    const domNodes = new Map([
      ["stage-svg", makeDomNode()],
      ["scene", makeDomNode()],
      ["ground", makeDomNode()],
      ["mode", makeDomNode()],
      ["seek", makeDomNode()],
      ["toggle", makeDomNode("Pause")]
    ]);
    runInNewContext(scriptMatch![1]!, {
      CustomEvent: class {
        readonly type: string;
        readonly detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
      document: {
        querySelector: (sel: string) =>
          sel === "#stage svg" ? domNodes.get("stage-svg") : domNodes.get(sel.replace(/^#/, "")),
        getElementById: (id: string) => domNodes.get(id) ?? null,
        dispatchEvent: () => true
      },
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {}
    });
    domNodes.get("seek")!.value = String(Math.round(ideaAct.startMs + ideaAct.durationMs * 0.68));
    domNodes.get("seek")!.listeners.get("input")!();
    expect(domNodes.get("scene")!.innerHTML).toContain('data-addon="bulb"');
    expect(domNodes.get("scene")!.innerHTML).toContain('data-accessory="tie"');

    // Despite ending with walk-off to offstage-right, reduced & static modes keep the actor visible onstage
    for (const mode of ["reduced", "static"] as const) {
      const summaryFrame = sampleAnimation(program, 0, mode);
      expect(summaryFrame.x).toBeGreaterThan(0);
      expect(summaryFrame.x).toBeLessThan(spec.canvas.width);
    }
  });

  it("Scenario B (Bilateral Push & Visible Props): verifies leftward & rightward push plus zero empty-air miming across sports & prop actions", async () => {
    // 1. Bilateral v1 bound prop push (rightward & leftward)
    const pushRightSpec: AnimationSpec = {
      version: CONTRACT_VERSION,
      canvas: { width: 640, height: 360, fps: 30 },
      durationMs: 3000,
      actor: { x: 105, groundY: 210, color: "#202124" },
      prop: { id: "crate", x: 150, y: 160, width: 50, height: 50, toX: 250, handle: { x: 5, y: 8 } },
      actions: [{ action: "push", startMs: 100, durationMs: 2600, target: "crate" }]
    };
    const pushLeftSpec: AnimationSpec = {
      version: CONTRACT_VERSION,
      canvas: { width: 640, height: 360, fps: 30 },
      durationMs: 3000,
      actor: { x: 535, groundY: 210, color: "#202124" },
      prop: { id: "crate", x: 440, y: 160, width: 50, height: 50, toX: 340, handle: { x: 45, y: 8 } },
      actions: [{ action: "push", startMs: 100, durationMs: 2600, target: "crate" }]
    };

    const rightProg = compileAnimation(pushRightSpec).program!;
    const leftProg = compileAnimation(pushLeftSpec).program!;
    expect(rightProg).toBeDefined();
    expect(leftProg).toBeDefined();
    expect(sampleAnimation(rightProg, 2700).prop!.x).toBeCloseTo(250, 3);
    expect(sampleAnimation(leftProg, 2700).prop!.x).toBeCloseTo(340, 3);
    expect(renderSvgFrame(rightProg, 1400)).toContain('<g id="prop">');
    expect(renderSvgFrame(leftProg, 1400)).toContain('<g id="prop">');

    // Also verify v2 bilateral push with crate addon renders concrete <g data-addon="crate">
    for (const facing of ["right", "left"] as const) {
      const v2Push = choreographAnimation({
        actor: { x: "center", facing },
        actions: [{ action: "push", addon: "crate" }]
      });
      expect(v2Push.valid).toBe(true);
      const v2PushSvg = renderSvgFrame(v2Push.program!, v2Push.spec!.durationMs * 0.5);
      assertWellFormedScriptlessSvg(v2PushSvg, `v2 push ${facing}`);
      expect(v2PushSvg).toContain('<g data-addon="crate"');
    }

    // 2. Flagship examples/v2-sports-addons.json (hurdle -> basketball-shot -> cheer)
    const sportsRaw = JSON.parse(
      await readFile(resolve(process.cwd(), "examples", "v2-sports-addons.json"), "utf8")
    ) as unknown;
    const sportsCompiled = compileAnimation(sportsRaw);
    expect(sportsCompiled.valid).toBe(true);
    const sportsProg = sportsCompiled.program!;
    const sportsSpec = sportsProg.spec as AnimationSpecV2;
    const sportsAnalysis = analyzeStoryboard(sportsProg);
    expect(sportsAnalysis.outOfBoundsCount).toBe(0);
    expect(sportsAnalysis.outOfBoundsFrames).toEqual([]);
    expect(sportsAnalysis.addonTypes).toEqual(expect.arrayContaining(["hurdle", "hoop", "basketball"]));

    const hurdleAct = sportsSpec.actors[0]!.actions[0]!;
    const shotAct = sportsSpec.actors[0]!.actions[1]!;
    const hurdleSvg = renderSvgFrame(sportsProg, hurdleAct.startMs + hurdleAct.durationMs * 0.5);
    const shotSvg = renderSvgFrame(sportsProg, shotAct.startMs + shotAct.durationMs * 0.58);
    assertWellFormedScriptlessSvg(hurdleSvg, "sports hurdle");
    assertWellFormedScriptlessSvg(shotSvg, "sports basketball-shot");
    expect(hurdleSvg).toContain('<g data-addon="hurdle"');
    expect(shotSvg).toContain('<g data-addon="hoop"');
    expect(shotSvg).toContain('<g data-addon="basketball"');

    // 3. Auto-mapped actions render concrete <g data-addon="..."> SVG elements (zero empty-air miming)
    const expectedActionAddons: ReadonlyArray<{
      action: string;
      sampleFraction: number;
      addons: readonly AddonType[];
    }> = [
      { action: "idea", sampleFraction: 0.68, addons: ["bulb"] },
      { action: "present-card", sampleFraction: 0.55, addons: ["card"] },
      { action: "type-at-desk", sampleFraction: 0.5, addons: ["chair", "desk"] },
      { action: "open-door", sampleFraction: 0.56, addons: ["door"] },
      { action: "pull-banner", sampleFraction: 0.55, addons: ["banner"] },
      { action: "kick-ball", sampleFraction: 0.62, addons: ["goal", "football"] }
    ];

    for (const item of expectedActionAddons) {
      const res = choreographAnimation({
        actor: { x: "left" },
        actions: [{ action: item.action }]
      });
      expect(res.valid, item.action).toBe(true);
      const act = res.spec!.actors[0]!.actions[0]!;
      const svg = renderSvgFrame(res.program!, act.startMs + act.durationMs * item.sampleFraction);
      assertWellFormedScriptlessSvg(svg, `auto-addon ${item.action}`);
      for (const addonType of item.addons) {
        expect(svg, `${item.action} missing data-addon="${addonType}"`).toContain(
          `<g data-addon="${addonType}"`
        );
      }
    }
  });

  it("Scenario C (Full 106-Action Catalog Sweep): compiles and samples all 106 actions deterministically in v1 and v2", () => {
    expect(actionCatalog).toHaveLength(106);
    const pureLocomotion = new Set(["walk", "run", "jog", "walk-backwards", "crawl", "push-walk"]);

    for (const entry of actionCatalog) {
      const clip = RUNTIME_MOTION_LIBRARY.clips[entry.action];
      const durationMs = Math.max(2400, Math.ceil(((clip?.frames.length ?? 60) / 30) * 1000) + 400);

      // v1 compile + deterministic sampling
      const v1Spec = {
        version: CONTRACT_VERSION,
        canvas: { width: 1600, height: 800, fps: 30 },
        durationMs,
        actor: { x: 600, groundY: 640 },
        ...(entry.requiredBinding === "named target"
          ? { targets: { mark: entry.travel === "travel" ? { x: 840, y: 640 } : { x: 1040, y: 260 } } }
          : {}),
        ...(entry.requiredBinding === "bound visible prop handle"
          ? { prop: { id: "crate", x: 645, y: 590, width: 50, height: 50, toX: 745, handle: { x: 5, y: 8 } } }
          : {}),
        actions: [
          {
            action: entry.action,
            startMs: 0,
            durationMs,
            ...(entry.requiredBinding === "named target"
              ? { target: "mark" }
              : entry.requiredBinding === "bound visible prop handle"
                ? { target: "crate" }
                : {})
          }
        ]
      };
      const v1Compiled = compileAnimation(v1Spec);
      expect(v1Compiled.diagnostics, `v1 ${entry.action}`).toEqual([]);
      const v1Prog = v1Compiled.program!;
      const v1MidA = sampleAnimation(v1Prog, durationMs * 0.5);
      const v1MidB = sampleAnimation(v1Prog, durationMs * 0.5);
      expect(v1MidA, `v1 determinism ${entry.action}`).toEqual(v1MidB);
      expect(v1MidA.segments).toHaveLength(9);

      // v2 choreography + deterministic sampling
      const v2Res = choreographAnimation({
        actor: { x: entry.action === "walk-on" ? "offstage-left" : "center-left" },
        actions: [
          {
            action: entry.action,
            ...(entry.action === "walk-on"
              ? { to: "center" }
              : entry.action === "walk-off"
                ? { to: "offstage-right" }
                : pureLocomotion.has(entry.action)
                  ? { to: "center-right" }
                  : {})
          }
        ]
      });
      expect(v2Res.diagnostics, `v2 ${entry.action}`).toEqual([]);
      expect(v2Res.valid, `v2 ${entry.action}`).toBe(true);
      const v2Prog = v2Res.program!;
      const v2Dur = v2Res.spec!.durationMs;
      for (const frac of [0, 0.5, 1]) {
        const a = sampleAnimation(v2Prog, v2Dur * frac);
        const b = sampleAnimation(v2Prog, v2Dur * frac);
        expect(a, `v2 determinism ${entry.action}@${frac}`).toEqual(b);
        expect(a.segments).toHaveLength(9);
        expect(Number.isFinite(a.head.x)).toBe(true);
        expect(Number.isFinite(a.head.y)).toBe(true);
        for (const seg of a.segments) {
          expect(Math.max(seg.y1, seg.y2), `v2 floor ${entry.action}`).toBeLessThanOrEqual(
            a.groundY + 1e-5
          );
        }
      }
      expect(sampleAnimation(v2Prog, 0, "reduced")).toEqual(sampleAnimation(v2Prog, 0, "reduced"));
    }
  });

  it("Scenario D (Multi-Actor Cue Sync & All Examples CLI Validation): verifies cue handoffs, accessories, and all 6 examples/*.json", async () => {
    const collabPath = resolve(process.cwd(), "examples", "v2-two-actors-collab.json");
    const collabRaw = JSON.parse(await readFile(collabPath, "utf8")) as unknown;
    const collabCompiled = compileAnimation(collabRaw);
    expect(collabCompiled.valid).toBe(true);
    const collabProg = collabCompiled.program!;
    const collabSpec = collabProg.spec as AnimationSpecV2;

    const presenter = collabSpec.actors.find((a) => a.id === "presenter")!;
    const colleague = collabSpec.actors.find((a) => a.id === "colleague")!;
    expect(presenter.accessory).toBe("tie");
    expect(colleague.accessory).toBe("glasses");

    // Verify exact emitCue -> afterCue chain: write-board -> surprised -> thumbs-up -> fist-pump
    const writeBoard = presenter.actions[0]!;
    const surprised = colleague.actions[0]!;
    const thumbsUp = colleague.actions[1]!;
    const colleaguePump = colleague.actions[2]!;
    const presenterPump = presenter.actions[1]!;

    expect(writeBoard.action).toBe("write-board");
    expect(surprised.action).toBe("surprised");
    expect(thumbsUp.action).toBe("thumbs-up");
    expect(colleaguePump.action).toBe("fist-pump");
    expect(presenterPump.action).toBe("fist-pump");

    const writeEnd = writeBoard.startMs + writeBoard.durationMs;
    const surprisedEnd = surprised.startMs + surprised.durationMs;
    const thumbsEnd = thumbsUp.startMs + thumbsUp.durationMs;

    expect(surprised.startMs).toBe(writeEnd);
    expect(thumbsUp.startMs).toBe(surprisedEnd);
    expect(colleaguePump.startMs).toBe(thumbsEnd);
    expect(presenterPump.startMs).toBe(thumbsEnd);

    const collabAnalysis = analyzeStoryboard(collabProg);
    expect(collabAnalysis.outOfBoundsCount).toBe(0);
    expect(collabAnalysis.actorOverlapWarnings).toEqual([]);
    expect(collabAnalysis.maxSeamStepPx).toBeLessThan(2);

    const collabFrameSvg = renderSvgFrame(collabProg, writeBoard.startMs + writeBoard.durationMs * 0.6);
    assertWellFormedScriptlessSvg(collabFrameSvg, "collab frame");
    expect(collabFrameSvg).toContain('data-actor="presenter"');
    expect(collabFrameSvg).toContain('data-actor="colleague"');
    expect(collabFrameSvg).toContain('data-accessory="tie"');
    expect(collabFrameSvg).toContain('data-accessory="glasses"');
    expect(collabFrameSvg).toContain('data-addon="board"');

    // Enumerate & validate all 8 JSON files in examples/
    const examplesDir = resolve(process.cwd(), "examples");
    const jsonFiles = (await readdir(examplesDir))
      .filter((name) => name.endsWith(".json"))
      .sort();

    expect(jsonFiles).toEqual([
      "push-crate.json",
      "v2-presentation-story.json",
      "v2-sports-addons.json",
      "v2-two-actors-collab.json",
      "v3-handoff-and-stairs.json",
      "v3-incident-warroom-movie.json",
      "walk-and-wave.json",
      "wave.json"
    ]);

    for (const fileName of jsonFiles) {
      const fullPath = resolve(examplesDir, fileName);
      const parsed = JSON.parse(await readFile(fullPath, "utf8")) as { version: string };
      if (fileName === "v3-incident-warroom-movie.json") {
        expect(parsed.version, fileName).toBe(CONTRACT_VERSION_MOVIE);
        const composed = composeMovie(parsed);
        expect(composed.valid, `compose ${fileName}`).toBe(true);
        expect(composed.diagnostics, `diagnostics ${fileName}`).toEqual([]);
      } else {
        if (fileName.startsWith("v2-") || fileName.startsWith("v3-")) {
          expect(parsed.version, fileName).toBe(CONTRACT_VERSION_V2);
        } else {
          expect(parsed.version, fileName).toBe(CONTRACT_VERSION);
        }
        const comp = compileAnimation(parsed);
        expect(comp.valid, `compile ${fileName}`).toBe(true);
        expect(comp.diagnostics, `diagnostics ${fileName}`).toEqual([]);
      }

      const cliValidate = await runCliCaptured(["validate", "--input", fullPath]);
      expect(cliValidate.code, `CLI validate ${fileName}`).toBe(0);
      expect(JSON.parse(cliValidate.stdout)).toEqual({ valid: true, diagnostics: [] });

      const cliLint = await runCliCaptured(["storyboard", "--input", fullPath, "--lint-only"]);
      expect(cliLint.code, `CLI storyboard lint ${fileName}`).toBe(0);
      const lintReport = JSON.parse(cliLint.stdout) as { outOfBoundsCount: number };
      expect(lintReport.outOfBoundsCount, `OOB ${fileName}`).toBe(0);
    }
  });

  it("Scenario E (MCP v0.3.0 End-to-End Workflow): connects Client to createMcpServer, discovers, reads resources, choreographs, critiques storyboard, and exports artifacts", async () => {
    const outputRoot = await createWorkspaceTempRoot("v02-sim-mcp-out");
    const server = createMcpServer(outputRoot);
    const client = new Client({ name: "v02-simulation-client", version: "0.3.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    activeClosers.push(async () => {
      await client.close();
      await server.close();
    });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    expect(client.getServerVersion()).toEqual({ name: "stickman-mcp", version: "0.3.0" });
    const toolsList = await client.listTools();
    expect(toolsList.tools).toHaveLength(18);
    const resourcesList = await client.listResources();
    expect(resourcesList.resources).toHaveLength(14);
    const promptsList = await client.listPrompts();
    expect(promptsList.prompts.map((p) => p.name)).toEqual([
      "choreograph-slide",
      "two-actor-dialogue",
      "create-and-critique-movie"
    ]);

    const promptGuide = await client.getPrompt({
      name: "choreograph-slide",
      arguments: { topic: "v0.2 Release Architecture" }
    });
    expect(promptGuide.messages[0]?.content.type).toBe("text");

    // 1. Discover presentation actions
    const discoverRes = await client.callTool({
      name: "stickman_discover",
      arguments: { category: "presentation" }
    });
    expect(discoverRes.isError).not.toBe(true);
    const presentationActions = (
      discoverRes.structuredContent as { result: Array<{ action: string }> }
    ).result;
    expect(presentationActions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["walk-on", "walk-off", "present-card", "write-board", "swipe-next"])
    );

    // 2. Read stickman://anchors and stickman://templates/presentation-pitch
    const anchorsResource = await client.readResource({ uri: "stickman://anchors" });
    const anchorsJson = JSON.parse(
      (anchorsResource.contents[0] as { text: string }).text
    ) as {
      defaultCanvas: { width: number; height: number; fps: number };
      anchors: Record<string, { x: number; y: number }>;
    };
    expect(anchorsJson.defaultCanvas).toEqual({ width: 800, height: 450, fps: 30 });
    expect(anchorsJson.anchors["offstage-left"]).toBeDefined();
    expect(anchorsJson.anchors.left).toBeDefined();
    expect(anchorsJson.anchors.board).toBeDefined();
    expect(anchorsJson.anchors["offstage-right"]).toBeDefined();

    const pitchTemplateResource = await client.readResource({
      uri: "stickman://templates/presentation-pitch"
    });
    const pitchTemplate = JSON.parse(
      (pitchTemplateResource.contents[0] as { text: string }).text
    ) as Record<string, unknown>;
    expect(pitchTemplate.version).toBe(CONTRACT_VERSION_V2);

    // 3. Call stickman_choreograph on the template scene
    const choreoCall = await client.callTool({
      name: "stickman_choreograph",
      arguments: { scene: pitchTemplate }
    });
    expect(choreoCall.isError).not.toBe(true);
    const choreoPayload = (
      choreoCall.structuredContent as {
        result: {
          valid: boolean;
          spec: AnimationSpecV2;
          program: { contractVersion: string };
          summary: string;
        };
      }
    ).result;
    expect(choreoPayload.valid).toBe(true);
    expect(choreoPayload.program.contractVersion).toBe(CONTRACT_VERSION_V2);
    expect(choreoPayload.summary).toContain("presenter");

    // 4. Run stickman_storyboard self-critique
    const storyboardCall = await client.callTool({
      name: "stickman_storyboard",
      arguments: { animation: choreoPayload.spec, columns: 4, maxPanels: 8 }
    });
    expect(storyboardCall.isError).not.toBe(true);
    const parsedSb = CallToolResultSchema.parse(storyboardCall);
    const sbPayload = (
      storyboardCall.structuredContent as {
        result: {
          valid: boolean;
          svg: string;
          rasterizerAvailable: boolean;
          analysis: {
            outOfBoundsCount: number;
            actorOverlapWarnings: unknown[];
            maxSeamStepPx: number;
          };
        };
      }
    ).result;
    expect(sbPayload.valid).toBe(true);
    expect(sbPayload.analysis.outOfBoundsCount).toBe(0);
    expect(sbPayload.analysis.actorOverlapWarnings).toEqual([]);
    expect(sbPayload.analysis.maxSeamStepPx).toBeLessThan(8);
    assertWellFormedScriptlessSvg(sbPayload.svg, "MCP storyboard SVG");
    if (sbPayload.rasterizerAvailable) {
      expect(parsedSb.content.some((block) => block.type === "image" && block.mimeType === "image/png")).toBe(true);
    }

    // 5. Export storyboard-svg & html into outputRoot
    const exportStoryboard = await client.callTool({
      name: "stickman_export",
      arguments: {
        animation: choreoPayload.spec,
        path: "pitch-storyboard.svg",
        format: "storyboard-svg"
      }
    });
    expect(exportStoryboard.isError).not.toBe(true);

    const exportHtml = await client.callTool({
      name: "stickman_export",
      arguments: {
        animation: choreoPayload.spec,
        path: "pitch-player.html",
        format: "html"
      }
    });
    expect(exportHtml.isError).not.toBe(true);

    const writtenSvg = await readFile(resolve(outputRoot, "pitch-storyboard.svg"), "utf8");
    const writtenHtml = await readFile(resolve(outputRoot, "pitch-player.html"), "utf8");
    assertWellFormedScriptlessSvg(writtenSvg, "exported storyboard SVG");
    expect(writtenSvg).toContain("Stickman storyboard");
    expect(writtenHtml).toContain("<!doctype html>");
    expect(writtenHtml).toContain("stickman:marker");

    // Verify safe non-overwrite invariant holds in v0.2.0
    const duplicateExport = await client.callTool({
      name: "stickman_export",
      arguments: {
        animation: choreoPayload.spec,
        path: "pitch-player.html",
        format: "html"
      }
    });
    expect(duplicateExport.isError).toBe(true);
  });
});
