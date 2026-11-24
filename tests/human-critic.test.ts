import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION_MOVIE,
  CONTRACT_VERSION_V2,
  CRITIQUE_DIMENSION_WEIGHTS,
  HUMAN_CRITIQUE_RUBRIC,
  choreographAnimation,
  composeMovie,
  critiqueAnimation,
  evaluateAnimationQuality,
  renderCritiqueSheetSvg
} from "../src/index.js";

function assertValidCritiqueSvg(svg: string, label: string): void {
  expect(svg.length, `${label}: non-empty`).toBeGreaterThan(200);
  expect(Buffer.byteLength(svg, "utf8"), `${label}: compact < 30 KB`).toBeLessThan(30_000);
  expect(svg, `${label}: scriptless`).not.toMatch(/<script\b/i);
  expect(svg, `${label}: no NaN/Infinity/undefined`).not.toMatch(/\b(NaN|Infinity|undefined)\b/);
  expect(svg, `${label}: svg root`).toContain("<svg");
  expect(svg, `${label}: closing svg`).toContain("</svg>");
}

describe("v03-r6: Two-tier human-perceptual animation critic", () => {
  it("exports structured HUMAN_CRITIQUE_RUBRIC with 6 calibrated dimensions summing to weight 1.0", () => {
    expect(HUMAN_CRITIQUE_RUBRIC.version).toBe("1.0.0");
    expect(HUMAN_CRITIQUE_RUBRIC.dimensions).toHaveLength(6);
    const weightSum = HUMAN_CRITIQUE_RUBRIC.dimensions.reduce((sum, d) => sum + d.weight, 0);
    expect(weightSum).toBeCloseTo(1.0, 5);
    expect(
      Object.values(CRITIQUE_DIMENSION_WEIGHTS).reduce((sum, w) => sum + w, 0)
    ).toBeCloseTo(1.0, 5);
    expect(HUMAN_CRITIQUE_RUBRIC.vlmSelfCritiqueChecklist.length).toBeGreaterThanOrEqual(5);
    for (const dim of HUMAN_CRITIQUE_RUBRIC.dimensions) {
      expect(dim.anchors["9-10"].length).toBeGreaterThan(10);
      expect(dim.anchors["1-3"].length).toBeGreaterThan(10);
    }
  });

  describe("Negative Calibration — Defective Scene Detection", () => {
    it("flags giants_vs_toddlers and unfocused_multi_actor_clutter and scores < 6.8 on a 6-actor flat-floor cluttered scene", () => {
      const res = choreographAnimation({
        version: CONTRACT_VERSION_V2,
        canvas: { width: 1280, height: 720, fps: 30 },
        durationMs: 2800,
        actors: [
          {
            id: "a1",
            x: 160,
            groundY: 590,
            scale: 1.05,
            actions: [{ action: "wave", startMs: 0, durationMs: 2400 }]
          },
          {
            id: "a2",
            x: 340,
            groundY: 590,
            scale: 0.65,
            actions: [{ action: "idea", startMs: 0, durationMs: 2400 }]
          },
          {
            id: "a3",
            x: 520,
            groundY: 590,
            scale: 1.05,
            actions: [{ action: "write-board", startMs: 0, durationMs: 2400 }]
          },
          {
            id: "a4",
            x: 720,
            groundY: 590,
            scale: 0.65,
            actions: [{ action: "cheer", startMs: 0, durationMs: 2400 }]
          },
          {
            id: "a5",
            x: 920,
            groundY: 590,
            scale: 1.05,
            actions: [{ action: "present", startMs: 0, durationMs: 2400 }]
          },
          {
            id: "a6",
            x: 1100,
            groundY: 590,
            scale: 0.65,
            actions: [{ action: "point", startMs: 0, durationMs: 2400 }]
          }
        ]
      });

      expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
      const report = evaluateAnimationQuality(res.program!);

      const codes = new Set(report.issues.map((i) => i.code));
      expect(codes.has("giants_vs_toddlers")).toBe(true);
      expect(codes.has("unfocused_multi_actor_clutter")).toBe(true);
      expect(report.metrics.giantsVsToddlersDetected).toBe(true);
      expect(report.metrics.clutterDurationMs).toBeGreaterThanOrEqual(1500);
      expect(report.overallScore).toBeLessThan(6.8);
      expect(report.passed).toBe(false);
      expect(report.suggestions.length).toBeGreaterThan(0);
    });

    it("flags dead_air_idle with suggestedPatch { trimIdleTails: true } on 3.5s trailing dead-air idle", () => {
      const res = choreographAnimation({
        version: CONTRACT_VERSION_V2,
        canvas: { width: 800, height: 450, fps: 30 },
        durationMs: 4700,
        actors: [
          {
            id: "presenter",
            x: "center",
            actions: [
              { action: "wave", startMs: 0, durationMs: 1000 },
              { action: "idle", startMs: 1000, durationMs: 3700 }
            ]
          }
        ]
      });

      expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
      const report = evaluateAnimationQuality(res.program!);
      const deadAirIssue = report.issues.find((i) => i.code === "dead_air_idle");
      expect(deadAirIssue).toBeDefined();
      expect(deadAirIssue!.suggestedPatch).toEqual({ trimIdleTails: true });
      expect(report.metrics.deadAirMs).toBeGreaterThanOrEqual(3000);
      expect(report.dimensions.pacingAndReadability).toBeLessThan(7.5);
    });

    it("flags rushed_callout on a 300ms speech callout", () => {
      const res = choreographAnimation({
        version: CONTRACT_VERSION_V2,
        canvas: { width: 800, height: 450, fps: 30 },
        durationMs: 2400,
        camera: "auto-director",
        actors: [
          {
            id: "speaker",
            x: "center",
            actions: [
              { action: "present", startMs: 0, durationMs: 1200 },
              { action: "thumbs-up", startMs: 1200, durationMs: 1200 }
            ]
          }
        ],
        callouts: [
          {
            kind: "speech",
            actorId: "speaker",
            text: "Deploying hotfix to production cluster right now!",
            startMs: 300,
            durationMs: 300
          }
        ]
      });

      expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
      const report = evaluateAnimationQuality(res.program!);
      const rushed = report.issues.find((i) => i.code === "rushed_callout");
      expect(rushed).toBeDefined();
      expect(rushed!.dimension).toBe("pacingAndReadability");
      expect(rushed!.severity).toBe("error");
      expect(report.passed).toBe(false);
    });

    it("flags asymmetric prop facing mismatch, uncoordinated handoff, and chunky stroke ratio", () => {
      const propRes = choreographAnimation({
        version: CONTRACT_VERSION_V2,
        canvas: { width: 800, height: 450, fps: 30 },
        durationMs: 2000,
        stageProps: [
          { id: "fixed-chair", type: "chair", x: 380, facing: "right", layer: "front" }
        ],
        actors: [
          {
            id: "worker",
            x: 410,
            facing: "left",
            scale: 0.25,
            actions: [{ action: "seated-idle", startMs: 0, durationMs: 1800, addon: "none" }]
          }
        ]
      });
      expect(propRes.valid, JSON.stringify(propRes.diagnostics)).toBe(true);
      const propReport = evaluateAnimationQuality(propRes.program!);
      const propCodes = new Set(propReport.issues.map((i) => i.code));
      expect(propCodes.has("asymmetric_prop_facing_mismatch")).toBe(true);
      expect(propCodes.has("prop_impalement_chair")).toBe(true);
      expect(propCodes.has("chunky_stroke_head_ratio")).toBe(true);
      expect(propReport.metrics.maxStrokeHeadRatio).toBeGreaterThan(0.28);

      const handoffRes = choreographAnimation({
        version: CONTRACT_VERSION_V2,
        canvas: { width: 800, height: 450, fps: 30 },
        durationMs: 2200,
        actors: [
          {
            id: "sender",
            x: "center-left",
            facing: "right",
            actions: [{ action: "hand-over", startMs: 0, durationMs: 1200 }]
          },
          {
            id: "receiver",
            x: "center-right",
            facing: "left",
            actions: [{ action: "catch", startMs: 600, durationMs: 1200 }]
          }
        ]
      });
      expect(handoffRes.valid, JSON.stringify(handoffRes.diagnostics)).toBe(true);
      const handoffReport = evaluateAnimationQuality(handoffRes.program!);
      expect(handoffReport.issues.some((i) => i.code === "uncoordinated_prop_handoff")).toBe(true);
    });
  });

  describe("Positive Calibration — Upgraded v0.3.0 Scenes", () => {
    it("scores >= 8.5 with passed=true and zero errors on a well-directed 2-actor cue-synced v0.3.0 scene", () => {
      const res = choreographAnimation({
        version: CONTRACT_VERSION_V2,
        canvas: { width: 1280, height: 720, fps: 30 },
        camera: "auto-director",
        spotlight: true,
        actors: [
          {
            id: "alice",
            x: "center-left",
            facing: "right",
            depth: 0,
            color: "#111827",
            accessory: "glasses",
            actions: [
              {
                action: "idea",
                durationMs: 1200,
                say: "Let us ship the patch!",
                emitCue: "alice-pitched"
              },
              {
                action: "thumbs-up",
                afterCue: "bob-verified",
                durationMs: 1000,
                badge: "SHIP READY"
              }
            ]
          },
          {
            id: "bob",
            x: "center-right",
            facing: "left",
            depth: 0.35,
            color: "#1e293b",
            accessory: "tie",
            actions: [
              {
                action: "type-at-desk",
                afterCue: "alice-pitched",
                durationMs: 1400,
                say: "Running checks now",
                emitCue: "bob-verified"
              },
              {
                action: "cheer",
                afterCue: "bob-verified",
                durationMs: 1000
              }
            ]
          }
        ]
      });

      expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
      const report = evaluateAnimationQuality(res.program!);
      const errors = report.issues.filter((i) => i.severity === "error");

      expect(errors, JSON.stringify(errors)).toHaveLength(0);
      expect(report.overallScore).toBeGreaterThanOrEqual(8.5);
      expect(report.passed).toBe(true);
      expect(report.metrics.giantsVsToddlersDetected).toBe(false);
      expect(report.metrics.outOfBoundsCount).toBe(0);
      expect(report.metrics.maxStrokeHeadRatio).toBeLessThanOrEqual(0.28);
    });

    it("scores >= 8.5 with passed=true and zero errors on a 3-scene CompiledMovie with trimIdleTails=true", () => {
      const movieRes = composeMovie({
        version: CONTRACT_VERSION_MOVIE,
        title: "Cloud Incident Recovery",
        canvas: { width: 1280, height: 720, fps: 30 },
        theme: { accentColor: "#b11f4b" },
        trimIdleTails: true,
        scenes: [
          {
            id: "triage",
            title: "War Room Triage",
            caption: "Alert spike detected in EU-West",
            backdrop: "war-room",
            transition: { kind: "fade", durationMs: 400 },
            camera: "auto-director",
            spotlight: "auto",
            durationMs: 5600,
            actors: [
              {
                id: "lead",
                x: "center-left",
                color: "#111827",
                accessory: "glasses",
                depth: 0,
                actions: [
                  { action: "surprised", durationMs: 1000, say: "Latency spiking!" },
                  { action: "point", durationMs: 1000, badge: "P1 INCIDENT" },
                  { action: "idle", durationMs: 3200 }
                ]
              },
              {
                id: "analyst",
                x: "center-right",
                facing: "left",
                color: "#334155",
                depth: 0.35,
                actions: [
                  { action: "type-at-desk", durationMs: 1600, think: "Checking rack 4B" }
                ]
              }
            ]
          },
          {
            id: "remediate",
            title: "Datacenter Fix",
            caption: "Failover uplink restored",
            backdrop: "datacenter",
            transition: { kind: "wipe", durationMs: 400 },
            camera: "auto-director",
            spotlight: true,
            actors: [
              {
                id: "sre",
                x: "left",
                color: "#1e293b",
                accessory: "badge",
                actions: [
                  { action: "walk", to: "center", durationMs: 1000 },
                  { action: "plug-cable", durationMs: 1200, say: "Failover link active" }
                ]
              }
            ]
          },
          {
            id: "resolved",
            title: "Office Recovery",
            caption: "All services healthy",
            backdrop: "office",
            transition: "cut",
            camera: "auto-director",
            actors: [
              {
                id: "lead",
                x: "center",
                color: "#111827",
                accessory: "tie",
                actions: [
                  { action: "thumbs-up", durationMs: 1000, say: "Zero data loss!" },
                  { action: "cheer", durationMs: 1000 }
                ]
              }
            ]
          }
        ]
      });

      expect(movieRes.valid, JSON.stringify(movieRes.diagnostics)).toBe(true);
      const report = evaluateAnimationQuality(movieRes.movie!);
      const errors = report.issues.filter((i) => i.severity === "error");

      expect(errors, JSON.stringify(errors)).toHaveLength(0);
      expect(report.metrics.sceneCount).toBe(3);
      expect(report.metrics.deadAirMs).toBe(0);
      expect(report.overallScore).toBeGreaterThanOrEqual(8.5);
      expect(report.passed).toBe(true);

      const movieSheet = renderCritiqueSheetSvg(movieRes.movie!, report, { maxPanels: 6 });
      assertValidCritiqueSvg(movieSheet, "3-scene movie critique sheet");
      expect(movieSheet).toContain("PASS");
      expect(movieSheet).toContain("S1 ·");
      expect(movieSheet).toContain("S3 ·");
    });
  });

  describe("Tier B — Critique Contact Sheet SVG & PNG Rasterization", () => {
    it("renders deterministic, compact (< 30 KB), scriptless critique sheets with score badge and issue pills", () => {
      const defective = choreographAnimation({
        version: CONTRACT_VERSION_V2,
        canvas: { width: 800, height: 450, fps: 30 },
        durationMs: 4600,
        actors: [
          {
            id: "a",
            x: "center-left",
            scale: 1.05,
            actions: [
              { action: "wave", startMs: 0, durationMs: 1000 },
              { action: "idle", startMs: 1000, durationMs: 3600 }
            ]
          },
          {
            id: "b",
            x: "center-right",
            scale: 0.65,
            actions: [{ action: "idle", startMs: 0, durationMs: 4600 }]
          }
        ]
      });
      expect(defective.valid).toBe(true);

      const report = evaluateAnimationQuality(defective.program!);
      const svg1 = renderCritiqueSheetSvg(defective.program!, report, { maxPanels: 6 });
      const svg2 = renderCritiqueSheetSvg(defective.program!, report, { maxPanels: 6 });

      assertValidCritiqueSvg(svg1, "defective critique sheet");
      expect(svg1).toBe(svg2);
      expect(svg1).toContain('data-part="score-badge"');
      expect(svg1).toContain("NEEDS POLISH");
      expect(svg1).toContain('data-issue-pill="error"');

      const bpSvg = renderCritiqueSheetSvg(defective.program!, report, {
        maxPanels: 4,
        theme: "blueprint"
      });
      assertValidCritiqueSvg(bpSvg, "blueprint critique sheet");
      expect(bpSvg).toContain('data-theme="blueprint"');
    });

    it("critiqueAnimation returns report, svg, rubric, and real resvg PNG base64", async () => {
      const good = choreographAnimation({
        version: CONTRACT_VERSION_V2,
        canvas: { width: 800, height: 450, fps: 30 },
        camera: "auto-director",
        actors: [
          {
            id: "host",
            x: "center",
            accessory: "tie",
            actions: [
              { action: "wave", durationMs: 900, say: "Welcome aboard!" },
              { action: "thumbs-up", durationMs: 1000, badge: "READY" }
            ]
          }
        ]
      });
      expect(good.valid).toBe(true);

      const result = await critiqueAnimation(good.program!, { maxPanels: 4, includePng: true });
      assertValidCritiqueSvg(result.svg, "critiqueAnimation svg");
      expect(result.svg).toContain("PASS");
      expect(result.rubric).toBe(HUMAN_CRITIQUE_RUBRIC);
      expect(result.report.passed).toBe(true);
      expect(result.rasterizerAvailable).toBe(true);
      expect(result.pngBase64).toBeDefined();
      expect(result.pngBase64!.length).toBeGreaterThan(200);
      // PNG magic bytes (89 50 4E 47 0D 0A 1A 0A -> iVBORw0KGgo)
      expect(result.pngBase64!.startsWith("iVBORw0KGgo")).toBe(true);

      const noPng = await critiqueAnimation(good.program!, { maxPanels: 4, includePng: false });
      expect(noPng.pngBase64).toBeUndefined();
      expect(noPng.rasterizerAvailable).toBe(false);
    });
  });
});
