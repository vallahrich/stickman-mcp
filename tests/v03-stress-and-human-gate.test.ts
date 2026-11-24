import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION_MOVIE,
  CONTRACT_VERSION_V2,
  choreographAnimation,
  compileAnimation,
  composeMovie,
  evaluateAnimationQuality,
  exportAnimation,
  renderHtml,
  renderSvgFrame,
  sampleAnimation,
  type AnimationSpecV2,
  type CustomMotionDraftSpec
} from "../src/index.js";
import { composeFilmRecipe, listFilmAssets } from "../src/film.js";

const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function createWorkspaceScratch(prefix: string): Promise<string> {
  const dir = resolve(process.cwd(), `.${prefix}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  scratchDirs.push(dir);
  return dir;
}

function makeCoffeeSipDraft(): CustomMotionDraftSpec {
  const basePose = (overrides: Record<string, unknown> = {}) => ({
    anchor: "both" as const,
    lean: 2,
    neck: -1,
    bob: 0,
    facing: 1,
    rLeg: { hip: 5, knee: 13 },
    lLeg: { hip: -8, knee: 14 },
    lArm: { shoulder: -8, elbow: 45 },
    rArm: { shoulder: 20, elbow: 62 },
    ...overrides
  });
  return {
    id: "coffee-sip",
    label: "Coffee Sip",
    status: "draft",
    kind: "oneshot",
    travel: "in-place",
    view: "side",
    frames: 45,
    fps: 30,
    loop: false,
    prop: "coffee-mug",
    markers: { sip: 22 },
    poseKeys: [
      { frame: 0, pose: basePose({ rArm: { shoulder: 20, elbow: 62 } }), ease: "inOut" },
      { frame: 22, pose: basePose({ lean: -2, neck: -6, rArm: { shoulder: 42, elbow: 112 } }), ease: "inOut" },
      { frame: 44, pose: basePose({ rArm: { shoulder: 20, elbow: 62 } }) }
    ]
  };
}

describe("v0.3.0 Stress & Human-Gate Verification Suite (All 9 Scenarios)", () => {
  it("01: mirrors left-facing asymmetric props cleanly across 7 prop-bearing actions with >= 8.5/10 critique", () => {
    const actions: ReadonlyArray<{ action: string; frac: number }> = [
      { action: "type-at-desk", frac: 0.55 },
      { action: "open-door", frac: 0.55 },
      { action: "basketball-shot", frac: 0.55 },
      { action: "kick-ball", frac: 0.55 },
      { action: "write-board", frac: 0.55 },
      { action: "present-card", frac: 0.55 },
      { action: "idea", frac: 0.68 }
    ];

    for (const { action, frac } of actions) {
      const choreo = choreographAnimation({
        canvas: { width: 800, height: 450, fps: 30 },
        actor: { id: "lefty", x: "center", facing: "left", accessory: "glasses" },
        actions: [{ action }]
      });
      expect(choreo.valid, action).toBe(true);
      const program = choreo.program!;
      const mid = choreo.spec!.durationMs * frac;
      const frame = sampleAnimation(program, mid);
      expect(frame.addons?.length ?? 0, `${action} addons`).toBeGreaterThan(0);

      const svg = renderSvgFrame(program, mid);
      expect(svg).not.toMatch(/\b(?:NaN|Infinity|undefined)\b/);
      if (action === "write-board") {
        expect(svg).toContain('data-part="board-ink"');
        expect(svg).not.toContain('data-part="flip-x"');
      }

      const report = evaluateAnimationQuality(program);
      expect(report.passed, `${action} critique passed`).toBe(true);
      expect(report.overallScore, `${action} critique score`).toBeGreaterThanOrEqual(8.5);
    }
  });

  it("02a: preserves stairs elevation with 0px drop during elevated cheer and stationary staircase", () => {
    const choreo = choreographAnimation({
      canvas: { width: 800, height: 450, fps: 30 },
      actor: { id: "climber", x: "left", facing: "right", accessory: "badge" },
      actions: [
        { action: "stairs-up" },
        { action: "cheer", badge: "✓ Top!" },
        { action: "stairs-down" }
      ]
    });
    expect(choreo.valid).toBe(true);
    const program = choreo.program!;
    const spec = choreo.spec as AnimationSpecV2;
    const [upAct, cheerAct, downAct] = spec.actors[0]!.actions;

    const stairsUp = sampleAnimation(program, upAct!.startMs + upAct!.durationMs * 0.5).addons?.find((a) => a.type === "stairs");
    const stairsCheer = sampleAnimation(program, cheerAct!.startMs + cheerAct!.durationMs * 0.5).addons?.find((a) => a.type === "stairs");
    const stairsDown = sampleAnimation(program, downAct!.startMs + downAct!.durationMs * 0.5).addons?.find((a) => a.type === "stairs");
    expect(stairsUp).toBeDefined();
    expect(stairsCheer).toBeDefined();
    expect(stairsDown).toBeDefined();
    expect(stairsCheer!.x).toBe(stairsUp!.x);
    expect(stairsDown!.x).toBe(stairsUp!.x);
    expect(stairsDown!.doubleSided).toBe(true);

    // "✓ Top!" callout must infer success/check and NEVER warning/alert
    const cheerFrame = sampleAnimation(program, cheerAct!.startMs + cheerAct!.durationMs * 0.5);
    const topBadge = cheerFrame.callouts?.find((c) => c.kind === "status");
    expect(topBadge?.tone).toBe("success");
    expect(topBadge?.icon).toBe("check");
    const cheerSvg = renderSvgFrame(program, cheerAct!.startMs + cheerAct!.durationMs * 0.5);
    expect(cheerSvg).toContain('data-callout-icon="check"');
    expect(cheerSvg).not.toContain('data-callout-icon="alert"');

    const lowestFootY = (t: number) => {
      const f = sampleAnimation(program, t);
      const l = f.segments.find((s) => s.id === "left-shin")!.y2;
      const r = f.segments.find((s) => s.id === "right-shin")!.y2;
      return Math.max(l, r);
    };
    const topTreadY = spec.actors[0]!.groundY - 54;
    for (let frac = 0; frac <= 1; frac += 0.2) {
      expect(lowestFootY(cheerAct!.startMs + cheerAct!.durationMs * frac)).toBeLessThanOrEqual(topTreadY + 1.5);
    }

    const report = evaluateAnimationQuality(program);
    expect(report.metrics.maxGravityDropPx).toBeLessThanOrEqual(1);
    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(8.5);
  });

  it("02b: maintains continuous seated chain (sit-down -> seated-idle -> video-call -> stand-up) with >= 8.5/10 critique", () => {
    const choreo = choreographAnimation({
      canvas: { width: 800, height: 450, fps: 30 },
      actor: { id: "caller", x: "center", facing: "right", accessory: "glasses" },
      actions: [
        { action: "sit-down" },
        { action: "seated-idle", durationMs: 800 },
        { action: "video-call", say: "Joining standup" },
        { action: "stand-up" }
      ]
    });
    expect(choreo.valid).toBe(true);
    const program = choreo.program!;
    const spec = choreo.spec as AnimationSpecV2;
    const videoAct = spec.actors[0]!.actions[2]!;
    const vcFrame = sampleAnimation(program, videoAct.startMs + videoAct.durationMs * 0.5);
    expect(vcFrame.addons?.some((a) => a.type === "chair")).toBe(true);
    expect(vcFrame.addons?.some((a) => a.type === "desk")).toBe(true);

    const report = evaluateAnimationQuality(program);
    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(8.5);
  });

  it("02c: executes flagship examples/v3-handoff-and-stairs.json single-card handoff and elevated cheer with >= 8.5/10 critique", async () => {
    const raw = JSON.parse(
      await readFile(resolve(process.cwd(), "examples", "v3-handoff-and-stairs.json"), "utf8")
    ) as unknown;
    const compiled = compileAnimation(raw);
    expect(compiled.valid).toBe(true);
    const program = compiled.program!;
    const spec = program.spec as AnimationSpecV2;
    expect(spec.actors).toHaveLength(2);

    // Ensure at most one card exists, receiver stays facing left during catch, and card never clips receiver's head
    for (let t = 0; t <= spec.durationMs; t += 150) {
      const f = sampleAnimation(program, t);
      const cards = (f.addons ?? []).filter((a) => a.type === "card" && a.opacity > 0.05);
      expect(cards.length, `cards@${t}`).toBeLessThanOrEqual(1);
      const recv = f.actors?.find((a) => a.id === "receiver")!;
      if (recv.action === "catch") {
        expect(recv.facing, `receiver facing during catch@${t}`).toBeLessThan(-0.5);
      }
      if (cards.length === 1 && cards[0]!.actorId === "receiver") {
        const card = cards[0]!;
        const hr = 16.5 * recv.scale;
        const overlapsHead =
          card.x < recv.head.x + hr &&
          card.x + card.width > recv.head.x - hr &&
          card.y < recv.head.y + hr &&
          card.y + card.height > recv.head.y - hr;
        expect(overlapsHead, `card@${t} clear of receiver head`).toBe(false);
      }
      for (const c of f.callouts ?? []) {
        if (c.kind === "status" && c.text.includes("Live")) {
          expect(c.tone).toBe("success");
          expect(c.icon).toBe("check");
        }
      }
    }

    const report = evaluateAnimationQuality(program);
    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(8.5);
  });

  it("03: stages 6-actor 1280x720 War-Room with 2.5D depth, spotlight, camera & callouts under 220 KB compact HTML", () => {
    const choreo = choreographAnimation({
      canvas: { width: 1280, height: 720, fps: 30 },
      camera: "auto-director",
      spotlight: "auto",
      actors: [
        { id: "lead", x: 180, depth: 0, facing: "right", accessory: "tie", color: "#0f172a", actions: [{ action: "frustrated-pc", badge: "! P1", emitCue: "c1" }] },
        { id: "sre", x: 390, depth: 0.15, facing: "right", accessory: "glasses", color: "#1e293b", actions: [{ action: "think", afterCue: "c1", emitCue: "c2" }] },
        { id: "sec", x: 600, depth: 0.3, facing: "left", accessory: "badge", color: "#334155", actions: [{ action: "idea", afterCue: "c2", say: "Isolate edge", emitCue: "c3" }] },
        { id: "net", x: 810, depth: 0.45, facing: "left", accessory: "hat", color: "#1e293b", actions: [{ action: "plug-cable", afterCue: "c3", emitCue: "c4" }] },
        { id: "db", x: 1000, depth: 0.6, facing: "left", accessory: "glasses", color: "#334155", actions: [{ action: "check-watch", afterCue: "c4", emitCue: "c5" }] },
        { id: "ops", x: 1150, depth: 0.75, facing: "left", accessory: "badge", color: "#475569", actions: [{ action: "thumbs-up", afterCue: "c5", badge: "✓ 99.99%" }] }
      ]
    });
    expect(choreo.valid).toBe(true);
    const program = choreo.program!;
    const html = renderHtml(program);
    const htmlBytes = Buffer.byteLength(html, "utf8");
    expect(htmlBytes).toBeLessThan(220 * 1024);

    const midSvg = renderSvgFrame(program, choreo.spec!.durationMs * 0.4);
    expect(midSvg).toContain('data-part="depth-shadow"');
    expect(midSvg).toContain('data-camera="true"');

    const report = evaluateAnimationQuality(program);
    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(8.5);
  });

  it("04a: composes flagship 3-scene examples/v3-incident-warroom-movie.json (>= 8.5/10) and runs healed src/film.ts", async () => {
    const movieRaw = JSON.parse(
      await readFile(resolve(process.cwd(), "examples", "v3-incident-warroom-movie.json"), "utf8")
    ) as unknown;
    const composed = composeMovie(movieRaw);
    expect(composed.valid).toBe(true);
    expect(composed.movie?.contractVersion).toBe(CONTRACT_VERSION_MOVIE);
    expect(composed.movie?.scenes).toHaveLength(3);

    const report = evaluateAnimationQuality(composed.movie!);
    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(8.5);

    const assets = await listFilmAssets();
    expect(Array.isArray(assets.motions)).toBe(true);
    expect((assets.motions as unknown[]).length).toBeGreaterThan(50);

    const filmRecipe = JSON.parse(
      await readFile(resolve(process.cwd(), "examples", "films", "team-handoff.json"), "utf8")
    ) as unknown;
    const filmResult = await composeFilmRecipe(filmRecipe);
    expect(filmResult).toBeDefined();
    expect(Number(filmResult.frames)).toBeGreaterThan(0);
  });

  it("04b: exports parallel MP4 and transparent VP9 WebM cleanly with >= 8.5/10 source critique", async () => {
    const outRoot = await createWorkspaceScratch("v03-stress-media");
    const choreo = choreographAnimation({
      canvas: { width: 640, height: 360, fps: 15 },
      actor: { id: "hero", x: "center", accessory: "tie" },
      actions: [{ action: "wave", say: "Live overlay!" }]
    });
    expect(choreo.valid).toBe(true);
    const program = choreo.program!;

    const report = evaluateAnimationQuality(program);
    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(8.5);

    const mp4 = await exportAnimation(program, outRoot, "clip.mp4", "mp4");
    const webm = await exportAnimation(program, outRoot, "clip-alpha.webm", "webm", {
      transparent: true
    });

    expect(mp4.bytes).toBeGreaterThan(1000);
    expect(webm.bytes).toBeGreaterThan(1000);
    const mp4Buf = await readFile(resolve(outRoot, mp4.path));
    const webmBuf = await readFile(resolve(outRoot, webm.path));
    expect(mp4Buf.includes(Buffer.from("ftyp"))).toBe(true);
    expect(webmBuf[0]).toBe(0x1a);
    expect(webmBuf[1]).toBe(0x45);
    expect(webmBuf[2]).toBe(0xdf);
    expect(webmBuf[3]).toBe(0xa3);
  }, 120_000);

  it("05: renders inline customMotions coffee-sip with coffee-mug prop and gaze pitch with >= 8.5/10 critique", () => {
    const choreo = choreographAnimation({
      canvas: { width: 800, height: 450, fps: 30 },
      customMotions: {
        "coffee-sip": makeCoffeeSipDraft()
      },
      actor: { id: "barista", x: "center", facing: "right", accessory: "glasses", gaze: "down" },
      actions: [
        { action: "coffee-sip", gaze: "down", say: "Morning brew" }
      ]
    });
    expect(choreo.valid).toBe(true);
    const program = choreo.program!;
    // Mug is cleanly visible at 0.00s, 0.75s, and 1.50s, and barista stands upright (not squatting)
    for (const frac of [0, 0.5, 1]) {
      const f = sampleAnimation(program, choreo.spec!.durationMs * frac);
      const mug = f.addons?.find((a) => a.type === "coffee-mug");
      expect(mug, `mug@${frac}`).toBeDefined();
      expect(mug!.opacity, `mug opacity@${frac}`).toBeGreaterThan(0.95);
      const torso = f.segments.find((s) => s.id === "torso")!;
      expect(f.groundY - torso.y1, `upright pelvis height@${frac}`).toBeGreaterThanOrEqual(62);
    }
    const svg = renderSvgFrame(program, choreo.spec!.durationMs * 0.5);
    expect(svg).toContain('data-addon="coffee-mug"');
    expect(svg).toContain('data-part="gaze"');

    const report = evaluateAnimationQuality(program);
    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(8.5);
  });

  it("06: preserves sub-linear strokes, curved Bezier spine, gaze dots & hand glyphs across 0.4x / 1.0x / 1.6x actors", () => {
    const choreo = choreographAnimation({
      canvas: { width: 1280, height: 720, fps: 30 },
      spotlight: "auto",
      actors: [
        { id: "mini", x: 260, scale: 0.4, depth: 0.7, facing: "right", accessory: "badge", color: "#0f172a", actions: [{ action: "thumbs-up" }] },
        { id: "std", x: 640, scale: 1.0, depth: 0.3, facing: "right", accessory: "tie", color: "#0f172a", actions: [{ action: "wave" }] },
        { id: "hero", x: 1020, scale: 1.6, depth: 0, facing: "left", accessory: "glasses", color: "#0f172a", actions: [{ action: "cheer" }] }
      ]
    });
    expect(choreo.valid).toBe(true);
    const program = choreo.program!;
    const svg = renderSvgFrame(program, choreo.spec!.durationMs * 0.5);

    expect(svg).toContain('data-actor="mini"');
    expect(svg).toContain('data-actor="std"');
    expect(svg).toContain('data-actor="hero"');
    expect(svg).toContain('data-part="gaze"');
    expect(svg).toContain('data-part="hand-glyph"');
    expect(svg).toMatch(/<path d="M[^"]*Q[^"]*"/);

    // Sub-linear stroke-width ratios: small scale stays readable, large scale avoids fat blobs
    const swMatches = [...svg.matchAll(/data-actor="(mini|std|hero)"[^>]*stroke-width="([0-9.]+)"/g)];
    const swMap = new Map(swMatches.map((m) => [m[1]!, Number(m[2]!)]));
    expect(swMap.get("mini")!).toBeGreaterThanOrEqual(1.25);
    expect(swMap.get("std")!).toBeGreaterThan(swMap.get("mini")!);
    expect(swMap.get("hero")!).toBeGreaterThan(swMap.get("std")!);
    expect(swMap.get("hero")!).toBeLessThan(6.5);

    const report = evaluateAnimationQuality(program);
    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(8.5);
  });
});
