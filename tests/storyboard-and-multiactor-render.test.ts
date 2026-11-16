import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeStoryboard,
  choreographAnimation,
  compileAnimation,
  exportAnimation,
  rasterizeStoryboardPng,
  renderAddonSvg,
  renderAnimatedSvg,
  renderArtifact,
  renderBlueprintDefsSvg,
  renderHtml,
  renderHtmlPreview,
  renderStoryboardSvg,
  renderSvgFrame,
  sampleAnimation,
  selectStoryboardTimestamps,
  type CompiledAnimation,
  type SampledAddon
} from "../src/index.js";

const localScratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    localScratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

function assertValidScriptlessSvg(svg: string, label: string): void {
  expect(svg.length, `${label}: empty`).toBeGreaterThan(0);
  expect(svg, `${label}: script forbidden`).not.toMatch(/<script\b/i);
  expect(svg, `${label}: NaN/Infinity/undefined forbidden`).not.toMatch(/\b(NaN|Infinity|undefined)\b/);
  expect(svg, `${label}: -0 forbidden`).not.toMatch(/(?<![0-9.])-(0(?:\.0+)?)(?![0-9.])/);

  const withoutXmlDecl = svg.replace(/^<\?xml[^?]*\?>\s*/, "");
  const stack: string[] = [];
  const tagRe = /<\/?([A-Za-z][A-Za-z0-9:-]*)(\s[^<>]*?)?(\/?)>/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(withoutXmlDecl)) !== null) {
    const between = withoutXmlDecl.slice(lastIdx, match.index);
    expect(between, `${label}: unescaped bracket in text`).not.toMatch(/[<>]/);
    lastIdx = tagRe.lastIndex;
    const full = match[0];
    const tag = match[1]!;
    const selfClosing = match[3] === "/";
    if (full.startsWith("</")) {
      expect(stack.pop(), `${label}: closing </${tag}> mismatch`).toBe(tag);
    } else if (!selfClosing) {
      stack.push(tag);
    }
  }
  expect(withoutXmlDecl.slice(lastIdx), `${label}: trailing unescaped bracket`).not.toMatch(/[<>]/);
  expect(stack, `${label}: unclosed tags`).toEqual([]);
}

function buildTwoActorRichStory(): CompiledAnimation {
  const result = choreographAnimation({
    theme: { accentColor: "#2563eb", background: "#ffffff" },
    actors: [
      {
        id: "presenter",
        label: "Lead Presenter",
        x: "offstage-left",
        color: "#0f172a",
        accessory: "tie",
        accentColor: "#e11d48",
        zIndex: 2,
        actions: [
          { action: "walk-on", to: "left" },
          { action: "write-board", emitCue: "boardReady" },
          { action: "idea", emitCue: "ahaMoment", emitCueAt: "end" },
          { action: "walk-off", to: "offstage-right" }
        ]
      },
      {
        id: "teammate",
        label: "Court Demo",
        x: "center-right",
        color: "#334155",
        accessory: "glasses",
        scale: 0.94,
        zIndex: 1,
        actions: [
          { action: "basketball-shot", afterCue: "boardReady" },
          { action: "cheer" }
        ]
      }
    ]
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.valid).toBe(true);
  return result.program!;
}

describe("R5 multi-actor + accessories + layered add-ons renderer & standalone HTML", () => {
  it("renders layered back/front add-ons and all actor accessories cleanly in static SVG frames", () => {
    const program = buildTwoActorRichStory();
    const v2 = program.spec;
    expect(program.contractVersion).toBe("stickman.animation/v2");
    if (v2.version !== "stickman.animation/v2") throw new Error("Expected v2 spec");

    const presenterActions = v2.actors.find((a) => a.id === "presenter")!.actions;
    const teammateActions = v2.actors.find((a) => a.id === "teammate")!.actions;

    const writeMidMs = presenterActions[1]!.startMs + presenterActions[1]!.durationMs * 0.7;
    const ideaPeakMs = presenterActions[2]!.startMs + presenterActions[2]!.durationMs * 0.7;
    const shotMidMs = teammateActions[0]!.startMs + teammateActions[0]!.durationMs * 0.56;

    const writeSvg = renderSvgFrame(program, writeMidMs);
    const ideaSvg = renderSvgFrame(program, ideaPeakMs);
    const shotSvg = renderSvgFrame(program, shotMidMs);

    for (const [name, svg] of [
      ["write-board", writeSvg],
      ["idea", ideaSvg],
      ["basketball-shot", shotSvg]
    ] as const) {
      assertValidScriptlessSvg(svg, name);
      expect(svg).toContain('id="ground"');
      expect(svg).toContain('data-actor="presenter"');
      expect(svg).toContain('data-actor="teammate"');
      expect(svg).toContain('data-accessory="tie"');
      expect(svg).toContain('data-accessory="glasses"');
      expect(svg).toContain("#e11d48"); // presenter custom accentColor on tie
      expect(svg).toContain("#2563eb"); // teammate inherited theme.accentColor on glasses
    }

    // Back-layer board renders BEFORE actors
    expect(writeSvg).toContain('data-addon="board"');
    expect(writeSvg).toContain('data-part="board-ink"');
    expect(writeSvg.indexOf('data-addon="board"')).toBeLessThan(writeSvg.indexOf('data-actor="teammate"'));

    // Front-layer bulb renders AFTER actors
    expect(ideaSvg).toContain('data-addon="bulb"');
    expect(ideaSvg.indexOf('data-addon="bulb"')).toBeGreaterThan(ideaSvg.indexOf('data-actor="presenter"'));

    // Basketball-shot has back-layer hoop BEFORE actors and front-layer basketball AFTER actors
    expect(shotSvg).toContain('data-addon="hoop"');
    expect(shotSvg).toContain('data-addon="basketball"');
    expect(shotSvg.indexOf('data-addon="hoop"')).toBeLessThan(shotSvg.indexOf('data-actor="teammate"'));
    expect(shotSvg.indexOf('data-addon="basketball"')).toBeGreaterThan(shotSvg.indexOf('data-actor="presenter"'));

    // Also verify "hat" and "badge" accessories + default "#2563eb" accent fallback
    const hatBadge = choreographAnimation({
      actors: [
        { id: "captain", x: "left", accessory: "hat", actions: [{ action: "wave" }] },
        { id: "marshal", x: "right", accessory: "badge", actions: [{ action: "thumbs-up" }] }
      ]
    });
    expect(hatBadge.valid).toBe(true);
    const hbSvg = renderSvgFrame(hatBadge.program!, 500);
    assertValidScriptlessSvg(hbSvg, "hat-badge");
    expect(hbSvg).toContain('data-accessory="hat"');
    expect(hbSvg).toContain('data-accessory="badge"');
    expect(hbSvg).toContain("#2563eb");
  });

  it("renders scriptless CSS @keyframes step-frame animated SVG with reduced-motion fallback for v2 scenes", () => {
    const program = buildTwoActorRichStory();
    const animated = renderAnimatedSvg(program);
    assertValidScriptlessSvg(animated, "v2-animated-svg");
    expect(animated).toContain("@keyframes sm-slice");
    expect(animated).toContain("@keyframes sm-final");
    expect(animated).toContain("steps(1,end)");
    expect(animated).toContain("prefers-reduced-motion:reduce");
    expect(animated).toContain('class="sm-reduced"');
    expect(animated).toContain('data-actor="presenter"');
    expect(animated).toContain('data-actor="teammate"');
    expect(animated).toContain('data-addon="board"');
    expect(animated).toContain('data-addon="bulb"');
    expect(animated).toContain('data-addon="basketball"');
    expect(animated).toContain('data-addon="hoop"');
  });

  it("executes v2 standalone HTML preview 100% offline in Node vm with controls, reduced-motion, and stickman:marker events", () => {
    const program = buildTwoActorRichStory();
    expect(renderHtmlPreview).toBe(renderHtml);
    const html = renderHtmlPreview(program);
    expect(html).toContain('id="stickman-player"');
    expect(html).not.toMatch(/<(?:script|link|img)\b[^>]+(?:src|href)=["']https?:\/\//i);

    const stageMatch = /<div id="stage">([\s\S]+?)<\/div><\/main>/.exec(html);
    expect(stageMatch).not.toBeNull();
    expect(stageMatch![1]).toBe(renderSvgFrame(program, 0));

    const scriptMatch = /<script id="stickman-player">([\s\S]+?)<\/script>/.exec(html);
    expect(scriptMatch).not.toBeNull();
    const playerScript = scriptMatch![1]!;

    function runVmPreview(reducedMotion: boolean) {
      const makeNode = (initialText = "") => {
        const attributes = new Map<string, string>();
        const listeners = new Map<string, (ev?: unknown) => void>();
        return {
          value: "",
          textContent: initialText,
          innerHTML: "",
          attributes,
          listeners,
          setAttribute(k: string, v: string) {
            attributes.set(k, String(v));
          },
          addEventListener(type: string, fn: (ev?: unknown) => void) {
            listeners.set(type, fn);
          }
        };
      };

      const nodes = new Map([
        ["stage-svg", makeNode()],
        ["scene", makeNode()],
        ["ground", makeNode()],
        ["mode", makeNode()],
        ["seek", makeNode()],
        ["toggle", makeNode("Pause")]
      ]);

      const markerDetails: Array<Record<string, unknown>> = [];
      const rafCallbacks = new Map<number, (now: number) => void>();
      let nextRaf = 1;

      class MockCustomEvent {
        readonly type: string;
        readonly detail: Record<string, unknown>;
        constructor(type: string, init?: { detail?: Record<string, unknown> }) {
          this.type = type;
          this.detail = init?.detail ?? {};
        }
      }

      runInNewContext(playerScript, {
        CustomEvent: MockCustomEvent,
        document: {
          querySelector(sel: string) {
            if (sel === "#stage svg") return nodes.get("stage-svg") ?? null;
            return nodes.get(sel.replace(/^#/, "")) ?? null;
          },
          getElementById(id: string) {
            return nodes.get(id) ?? null;
          },
          dispatchEvent(ev: MockCustomEvent) {
            if (ev.type === "stickman:marker") markerDetails.push(ev.detail);
            return true;
          }
        },
        matchMedia: () => ({ matches: reducedMotion }),
        requestAnimationFrame(cb: (now: number) => void) {
          const id = nextRaf++;
          rafCallbacks.set(id, cb);
          return id;
        },
        cancelAnimationFrame(id: number) {
          rafCallbacks.delete(id);
        }
      });

      const stepFrame = (nowMs: number): void => {
        const pending = [...rafCallbacks.entries()];
        rafCallbacks.clear();
        for (const [, fn] of pending) fn(nowMs);
      };

      return { nodes, markerDetails, rafCallbacks, stepFrame };
    }

    // 1. Reduced-motion VM boot: paused on onstage summary frame, 0 RAF scheduled
    const reducedVm = runVmPreview(true);
    expect(reducedVm.nodes.get("mode")!.value).toBe("reduced");
    expect(reducedVm.nodes.get("toggle")!.textContent).toBe("Play");
    expect(reducedVm.rafCallbacks.size).toBe(0);
    expect(reducedVm.nodes.get("scene")!.innerHTML).toContain('data-actor="presenter"');
    expect(reducedVm.nodes.get("scene")!.innerHTML).toContain('data-actor="teammate"');
    reducedVm.nodes.get("toggle")!.listeners.get("click")!();
    expect(reducedVm.nodes.get("mode")!.value).toBe("normal");
    expect(reducedVm.nodes.get("toggle")!.textContent).toBe("Pause");
    expect(reducedVm.rafCallbacks.size).toBe(1);

    // 2. Normal playback VM boot: advances timeline offline, updates scene DOM, emits markers
    const normalVm = runVmPreview(false);
    expect(normalVm.nodes.get("mode")!.value).toBe("normal");
    expect(normalVm.nodes.get("toggle")!.textContent).toBe("Pause");
    expect(normalVm.rafCallbacks.size).toBe(1);

    const v2 = program.spec;
    if (v2.version !== "stickman.animation/v2") throw new Error("Expected v2");
    const ideaAct = v2.actors[0]!.actions[2]!;
    const ideaSampleTime = Math.round(ideaAct.startMs + ideaAct.durationMs * 0.7);

    // Seek directly to idea aha moment and confirm bulb + accessories appear in DOM
    normalVm.nodes.get("seek")!.value = String(ideaSampleTime);
    normalVm.nodes.get("seek")!.listeners.get("input")!();
    expect(normalVm.nodes.get("scene")!.innerHTML).toContain('data-addon="bulb"');
    expect(normalVm.nodes.get("scene")!.innerHTML).toContain('data-accessory="tie"');

    // Reset to 0 and step RAF across full duration to verify stickman:marker dispatch & completion stop
    normalVm.nodes.get("seek")!.value = "0";
    normalVm.nodes.get("seek")!.listeners.get("input")!();
    normalVm.nodes.get("mode")!.value = "normal";
    normalVm.nodes.get("mode")!.listeners.get("change")!();

    let clockMs = 100;
    normalVm.stepFrame(clockMs); // establishes `previous`
    while (normalVm.rafCallbacks.size > 0) {
      clockMs += 250;
      normalVm.stepFrame(clockMs);
    }

    expect(normalVm.nodes.get("toggle")!.textContent).toBe("Play");
    expect(normalVm.markerDetails.map((d) => d.marker)).toEqual(
      expect.arrayContaining(["boardReady", "ahaMoment"])
    );
    expect(normalVm.markerDetails.some((d) => d.actorId === "presenter")).toBe(true);
  });
});

describe("R5 storyboard contact sheet, spatial lint & optional PNG rasterizer", () => {
  it("renders a compact (< 25 KB), scriptless 8-panel storyboard SVG with timestamp badges & beat labels", async () => {
    const program = buildTwoActorRichStory();
    const timestamps = selectStoryboardTimestamps(program, 8);
    expect(timestamps).toHaveLength(8);
    expect(timestamps[0]).toBe(0);
    expect(timestamps.at(-1)).toBe(program.spec.durationMs);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeGreaterThan(timestamps[i - 1]!);
    }

    const storyboardSvg = renderStoryboardSvg(program, { maxPanels: 8, columns: 4 });
    const bytes = Buffer.byteLength(storyboardSvg, "utf8");
    expect(bytes).toBeLessThan(25_000);
    expect(bytes).toBeGreaterThan(2_000);
    assertValidScriptlessSvg(storyboardSvg, "storyboard-8-panel");

    const panels = storyboardSvg.match(/<g data-panel="\d+"/g) ?? [];
    expect(panels).toHaveLength(8);
    expect(storyboardSvg).toContain('data-part="timestamp-badge"');
    expect(storyboardSvg).toContain('data-part="panel-label"');
    expect(storyboardSvg).toContain("0.00s");
    expect(storyboardSvg).toContain("presenter:");
    expect(storyboardSvg).toContain("teammate:");
    expect(storyboardSvg).toContain('data-accessory="tie"');
    expect(storyboardSvg).toContain('data-accessory="glasses"');

    // renderArtifact & exportAnimation support "storyboard-svg"
    expect(renderArtifact(program, "storyboard-svg")).toBe(storyboardSvg);
    const outDir = resolve(process.cwd(), `.test-sb-out-${randomUUID()}`);
    localScratchDirs.push(outDir);
    await mkdir(outDir, { recursive: true });
    const exported = await exportAnimation(program, outDir, "story-sheet.svg", "storyboard-svg");
    expect(exported).toMatchObject({
      format: "storyboard-svg",
      path: "story-sheet.svg",
      bytes,
      warnings: []
    });
    expect(await readFile(resolve(outDir, "story-sheet.svg"), "utf8")).toBe(storyboardSvg);
  });

  it("analyzes valid walk-on/walk-off stories with 0 out-of-bounds, and catches deliberate out-of-bounds & actor overlaps", () => {
    const validStory = buildTwoActorRichStory();
    const clean = analyzeStoryboard(validStory);

    expect(clean.panelCount).toBe(8);
    expect(clean.timestampsMs).toHaveLength(8);
    expect(clean.durationMs).toBe(validStory.spec.durationMs);
    expect(clean.actorIds).toEqual(["presenter", "teammate"]);
    expect(clean.addonTypes).toEqual(expect.arrayContaining(["board", "bulb", "hoop", "basketball"]));
    expect(clean.outOfBoundsCount).toBe(0);
    expect(clean.outOfBoundsFrames).toEqual([]);
    expect(clean.actorOverlapWarnings).toEqual([]);
    expect(clean.maxSeamStepPx).toBeLessThan(10);
    expect(clean.beatSummary).toHaveLength(8);
    expect(clean.beatSummary[0]).toContain("0.00s:");

    // Deliberate out-of-bounds: non-sliding hand addon pushed far outside right canvas boundary + tall actor near top
    const oobChoreo = choreographAnimation({
      canvas: { width: 400, height: 300, fps: 24 },
      actors: [
        {
          id: "giant",
          x: 392,
          groundY: 260,
          scale: 2.2,
          actions: [
            {
              action: "point",
              to: "right",
              durationMs: 1200,
              addon: { type: "sign", socket: "rHand", dx: 180, text: "OOB" }
            }
          ]
        }
      ]
    });
    expect(oobChoreo.valid).toBe(true);
    const oobReport = analyzeStoryboard(oobChoreo.program!);
    expect(oobReport.outOfBoundsCount).toBeGreaterThan(0);
    expect(oobReport.outOfBoundsFrames.length).toBe(oobReport.outOfBoundsCount);

    // Deliberate actor overlap: two onstage actors standing 6px apart (< 14px) for 1200ms (>= 500ms)
    const overlapChoreo = choreographAnimation({
      actors: [
        { id: "alice", x: 400, actions: [{ action: "wave", durationMs: 1200 }] },
        { id: "bob", x: 406, actions: [{ action: "clap", durationMs: 1200 }] }
      ]
    });
    expect(overlapChoreo.valid).toBe(true);
    const overlapReport = analyzeStoryboard(overlapChoreo.program!);
    expect(overlapReport.actorOverlapWarnings).toHaveLength(1);
    expect(overlapReport.actorOverlapWarnings[0]).toMatchObject({
      actorA: "alice",
      actorB: "bob"
    });
    expect(overlapReport.actorOverlapWarnings[0]!.durationMs).toBeGreaterThanOrEqual(500);
    expect(overlapReport.actorOverlapWarnings[0]!.minDistancePx).toBeLessThan(14);

    // Passing actors crossing briefly (< 500ms) should NOT emit an overlap warning
    const crossingChoreo = choreographAnimation({
      actors: [
        { id: "runnerA", x: "left", actions: [{ action: "run", to: "right", durationMs: 1400 }] },
        { id: "runnerB", x: "right", actions: [{ action: "run", to: "left", durationMs: 1400 }] }
      ]
    });
    expect(crossingChoreo.valid).toBe(true);
    const crossingReport = analyzeStoryboard(crossingChoreo.program!);
    expect(crossingReport.actorOverlapWarnings).toEqual([]);
    expect(crossingReport.outOfBoundsCount).toBe(0);

    // Check sampleAnimation consistency at storyboard timestamps
    for (const t of clean.timestampsMs) {
      expect(sampleAnimation(validStory, t).actors).toHaveLength(2);
    }
  });

  it("rasterizeStoryboardPng falls back gracefully when @resvg/resvg-js is unavailable and renders PNG when available", async () => {
    const program = buildTwoActorRichStory();
    const svg = renderStoryboardSvg(program);

    const unavailable = await rasterizeStoryboardPng(svg, {
      loadResvg: async () => {
        const err = Object.assign(new Error("Cannot find package '@resvg/resvg-js'"), {
          code: "ERR_MODULE_NOT_FOUND"
        });
        throw err;
      }
    });
    expect(unavailable).toEqual({ rasterizerAvailable: false });
    expect(unavailable.pngBase64).toBeUndefined();

    const actual = await rasterizeStoryboardPng(svg);
    if (actual.rasterizerAvailable) {
      expect(typeof actual.pngBase64).toBe("string");
      const buf = Buffer.from(actual.pngBase64!, "base64");
      // PNG magic header: 89 50 4E 47
      expect(buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    } else {
      expect(actual).toEqual({ rasterizerAvailable: false });
    }
  });

  it("renders orthographic CAD blueprint contact sheets (theme: 'blueprint') with grid, registration marks, datum, anchor ticks, dimension leaders & title block", async () => {
    const program = buildTwoActorRichStory();
    const blueprintSvg = renderStoryboardSvg(program, {
      maxPanels: 6,
      columns: 3,
      theme: "blueprint",
      title: "Two-Actor CAD Spec"
    });
    assertValidScriptlessSvg(blueprintSvg, "storyboard-blueprint");

    expect(blueprintSvg).toContain('data-theme="blueprint"');
    expect(blueprintSvg).toContain('id="sm-bp-grid"');
    expect(blueprintSvg).toContain('id="sm-bp-hatch"');
    expect(blueprintSvg).toContain('fill="url(#sm-bp-hatch)"');
    expect(blueprintSvg).toContain('data-style="blueprint"');
    expect(blueprintSvg).toContain('data-part="registration-mark"');
    expect(blueprintSvg).toContain('data-part="blueprint-header"');
    expect(blueprintSvg).toContain('data-part="blueprint-footer"');
    expect(blueprintSvg).toContain("Two-Actor CAD Spec");
    expect(blueprintSvg).toContain("800×450 @ 30FPS");
    expect(blueprintSvg).toContain("SCALE 1:");
    expect(blueprintSvg).toContain('stroke-dasharray="3 3"');
    expect(blueprintSvg).toContain('data-part="ground-datum"');
    expect(blueprintSvg).toContain("Y=369");
    expect(blueprintSvg).toContain('data-part="anchor-ticks"');
    expect(blueprintSvg).toContain(">L<");
    expect(blueprintSvg).toContain(">C<");
    expect(blueprintSvg).toContain(">R<");
    expect(blueprintSvg).toContain('data-part="dimension-leader"');
    expect(blueprintSvg).toContain("144u");
    expect(blueprintSvg).toMatch(/x=-?\d+/);
    expect(blueprintSvg).toContain("T+0.00s");
    // Monochrome technical-line ink: presenter's #e11d48 tie and #2563eb glasses are normalized to blueprint slate
    expect(blueprintSvg).not.toContain("#e11d48");
    expect(blueprintSvg).not.toContain("#2563eb");
    expect(blueprintSvg).toContain("#0f172a");
    expect(blueprintSvg).toContain("#1e3a5f");

    expect(renderArtifact(program, "storyboard-svg", { maxPanels: 6, columns: 3, theme: "blueprint", title: undefined })).toContain(
      'data-theme="blueprint"'
    );
    const rasterized = await rasterizeStoryboardPng(blueprintSvg);
    if (rasterized.rasterizerAvailable) {
      expect(Buffer.from(rasterized.pngBase64!, "base64").subarray(0, 4)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47])
      );
    }
  });
});

describe("P1 full-stage CAD blueprint render mode & diagonal hatched prop geometry", () => {
  it("exports deterministic renderBlueprintDefsSvg and hatches solid prop bodies while preserving wire fill='none'", () => {
    const defs = renderBlueprintDefsSvg();
    expect(defs).toContain('<pattern id="sm-bp-grid" width="24" height="24" patternUnits="userSpaceOnUse">');
    expect(defs).toContain(
      '<pattern id="sm-bp-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#f8fafc"/><line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" stroke-width="1"/></pattern>'
    );

    const customDefs = renderBlueprintDefsSvg({ gridPatternId: "g-1", hatchPatternId: "h-1" });
    expect(customDefs).toContain('id="g-1"');
    expect(customDefs).toContain('id="h-1"');

    const cardAddon: SampledAddon = {
      id: "kpi-card",
      type: "card",
      layer: "front",
      x: 100,
      y: 120,
      width: 34,
      height: 22,
      rotation: 0,
      scale: 1,
      opacity: 1,
      color: "#b11f4b",
      text: "Q4"
    };
    const bpCard = renderAddonSvg(cardAddon, { blueprint: true });
    expect(bpCard).toContain('data-style="blueprint"');
    expect(bpCard).toContain('fill="url(#sm-bp-hatch)"');
    expect(bpCard).toContain('stroke="#1e3a5f"');
    expect(bpCard).not.toContain("#b11f4b");
    expect(bpCard).toContain('fill="#0f172a" stroke="none">Q4</text>');

    const wireChair: SampledAddon = {
      id: "chair",
      type: "chair",
      layer: "back",
      x: 200,
      y: 269,
      width: 60,
      height: 100,
      rotation: 0,
      scale: 1,
      opacity: 1,
      color: "#ff0055"
    };
    const bpChair = renderAddonSvg(wireChair, { blueprint: true });
    expect(bpChair).toContain('data-style="blueprint"');
    expect(bpChair).toContain('fill="none"');
    expect(bpChair).not.toContain("url(#sm-bp-hatch)");
    expect(bpChair).not.toContain("#ff0055");
  });

  it("renders full-stage CAD blueprint mode across renderSvgFrame, renderAnimatedSvg, renderHtml & renderArtifact (via option and v2 theme.style, for both v2 and v1)", () => {
    const program = buildTwoActorRichStory();
    const v2 = program.spec;
    if (v2.version !== "stickman.animation/v2") throw new Error("Expected v2 spec");
    const shotAct = v2.actors.find((a) => a.id === "teammate")!.actions[0]!;
    const shotMidMs = shotAct.startMs + shotAct.durationMs * 0.56;

    const frameBp = renderSvgFrame(program, shotMidMs, "normal", { style: "blueprint" });
    assertValidScriptlessSvg(frameBp, "v2-frame-blueprint");
    expect(frameBp).toContain('data-style="blueprint"');
    expect(frameBp).toContain('id="sm-bp-grid"');
    expect(frameBp).toContain('id="sm-bp-hatch"');
    expect(frameBp).toContain('fill="#f8fafc"');
    expect(frameBp).toContain('fill="url(#sm-bp-grid)"');
    expect(frameBp).toContain('fill="url(#sm-bp-hatch)"');
    expect(frameBp).toContain('data-part="registration-mark"');
    expect(frameBp).toContain('stroke-dasharray="4 3"');
    expect(frameBp).toContain("Y=369");
    expect(frameBp).toContain(">L<");
    expect(frameBp).toContain(">CL<");
    expect(frameBp).toContain(">C<");
    expect(frameBp).toContain(">CR<");
    expect(frameBp).toContain(">R<");
    expect(frameBp).toContain("X=400");
    expect(frameBp).toContain('stroke-dasharray="2 2"');
    expect(frameBp).toContain("144u");
    expect(frameBp).toContain("144u (135px)"); // teammate scale 0.94 => round(144 * 0.94) = 135px
    expect(frameBp).toMatch(/x=-?\d+/);
    // Monochrome technical ink (#0f172a actor + #1e3a5f accessories/props, no rainbow accents)
    expect(frameBp).not.toContain("#e11d48");
    expect(frameBp).not.toContain("#2563eb");
    expect(frameBp).not.toContain("#f28c28");

    const animBp = renderAnimatedSvg(program, { style: "blueprint" });
    assertValidScriptlessSvg(animBp, "v2-animated-blueprint");
    expect(animBp).toContain('data-style="blueprint"');
    expect(animBp).toContain('id="sm-bp-hatch"');
    expect(animBp).toContain('fill="url(#sm-bp-hatch)"');
    expect(animBp).toContain('stroke-dasharray="4 3"');
    expect(animBp).toContain('stroke-dasharray="2 2"');
    expect(animBp).toContain(">L<");
    expect(animBp).toContain(">C<");
    expect(animBp).toContain(">R<");
    expect(animBp).toContain("144u");

    const htmlBp = renderHtml(program, { style: "blueprint" });
    expect(htmlBp).toContain('id="sm-bp-hatch"');
    expect(htmlBp).toContain("url(#sm-bp-hatch)");
    expect(htmlBp).toContain('stroke-dasharray="4 3"');
    expect(htmlBp).toContain('stroke-dasharray="2 2"');
    expect(htmlBp).toContain(">L<");
    expect(htmlBp).toContain(">C<");
    expect(htmlBp).toContain(">R<");
    expect(htmlBp).toContain("144u");
    expect(renderArtifact(program, "svg-frame", { timeMs: shotMidMs, style: "blueprint" })).toBe(frameBp);
    expect(renderArtifact(program, "svg", { style: "blueprint" })).toBe(animBp);
    expect(renderArtifact(program, "html", { style: "blueprint" })).toBe(htmlBp);

    // Automatic activation via v2 spec theme: { style: "blueprint" }
    const themedChoreo = choreographAnimation({
      theme: { style: "blueprint", accentColor: "#e11d48" },
      actor: { id: "lead", x: "center", accessory: "tie" },
      actions: [
        { action: "write-board" },
        { action: "present-card", addon: { type: "card", text: "CAD" } }
      ]
    });
    expect(themedChoreo.valid).toBe(true);
    expect(themedChoreo.spec?.theme?.style).toBe("blueprint");
    const themedCardAct = themedChoreo.spec!.actors[0]!.actions[1]!;
    const themedMidMs = themedCardAct.startMs + themedCardAct.durationMs * 0.55;
    const autoBpFrame = renderSvgFrame(themedChoreo.program!, themedMidMs);
    assertValidScriptlessSvg(autoBpFrame, "v2-theme-auto-blueprint");
    expect(autoBpFrame).toContain('id="sm-bp-hatch"');
    expect(autoBpFrame).toContain('fill="url(#sm-bp-hatch)"');
    expect(autoBpFrame).toContain('stroke-dasharray="4 3"');
    expect(autoBpFrame).toContain(">L<");
    expect(autoBpFrame).toContain(">C<");
    expect(autoBpFrame).toContain(">R<");
    expect(autoBpFrame).toContain("144u");
    expect(autoBpFrame).not.toContain("#e11d48");
    expect(renderAnimatedSvg(themedChoreo.program!)).toContain('fill="url(#sm-bp-hatch)"');
    expect(renderHtml(themedChoreo.program!)).toContain('fill="url(#sm-bp-hatch)"');
    // Explicit { style: "default" } overrides theme.style
    expect(renderSvgFrame(themedChoreo.program!, themedMidMs, "normal", { style: "default" })).not.toContain('id="sm-bp-hatch"');

    // v1 program with rectangular pushed prop in blueprint mode
    const v1Compiled = compileAnimation({
      version: "stickman.animation/v1",
      canvas: { width: 640, height: 360, fps: 24 },
      durationMs: 3600,
      actor: { x: 40, groundY: 210, color: "#b11f4b" },
      targets: { arrival: { x: 105, y: 210 } },
      prop: { id: "crate", x: 150, y: 160, width: 50, height: 50, toX: 250, handle: { x: 5, y: 8 } },
      actions: [
        { action: "walk", startMs: 0, durationMs: 1000, target: "arrival" },
        { action: "push", startMs: 1000, durationMs: 2600, target: "crate" }
      ]
    });
    expect(v1Compiled.valid).toBe(true);
    const v1BpFrame = renderSvgFrame(v1Compiled.program!, 1500, "normal", { style: "blueprint" });
    assertValidScriptlessSvg(v1BpFrame, "v1-frame-blueprint");
    expect(v1BpFrame).toContain('id="sm-bp-hatch"');
    expect(v1BpFrame).toContain('data-prop="crate" data-style="blueprint"');
    expect(v1BpFrame).toContain('fill="url(#sm-bp-hatch)"');
    expect(v1BpFrame).toContain("Y=210");
    expect(v1BpFrame).toContain("144u");
    expect(v1BpFrame).not.toContain("#b11f4b");
    const v1BpAnim = renderAnimatedSvg(v1Compiled.program!, { style: "blueprint" });
    assertValidScriptlessSvg(v1BpAnim, "v1-anim-blueprint");
    expect(v1BpAnim).toContain('fill="url(#sm-bp-hatch)"');
    expect(renderHtml(v1Compiled.program!, { style: "blueprint" })).toContain('fill="url(#sm-bp-hatch)"');
  });
});
