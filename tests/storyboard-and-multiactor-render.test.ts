import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeStoryboard,
  choreographAnimation,
  exportAnimation,
  rasterizeStoryboardPng,
  renderAnimatedSvg,
  renderArtifact,
  renderHtml,
  renderHtmlPreview,
  renderStoryboardSvg,
  renderSvgFrame,
  sampleAnimation,
  selectStoryboardTimestamps,
  type CompiledAnimation
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
});
