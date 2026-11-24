import { describe, expect, it } from "vitest";
import {
  choreographAnimation,
  compileAnimation,
  frameGeometry,
  renderSvgFrame,
  sampleAnimation,
  type SampledFrame
} from "../src/index.js";

function parseQuadraticBezier(d: string): {
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
} {
  const m = /^M(-?[\d.]+) (-?[\d.]+)Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(d);
  if (!m) throw new Error(`Expected quadratic Bezier path M...Q..., received: ${d}`);
  return {
    x1: Number(m[1]),
    y1: Number(m[2]),
    cx: Number(m[3]),
    cy: Number(m[4]),
    x2: Number(m[5]),
    y2: Number(m[6])
  };
}

function signedForwardOffset(frame: SampledFrame): {
  offsetRatio: number;
  bez: ReturnType<typeof parseQuadraticBezier>;
  torso: { x1: number; y1: number; x2: number; y2: number };
} {
  const geom = frameGeometry(frame);
  const torsoSeg = frame.segments.find((s) => s.id === "torso")!;
  const torsoPath = geom.paths.find((p) => p.id === "torso")!;
  const bez = parseQuadraticBezier(torsoPath.d);
  const dx = torsoSeg.x2 - torsoSeg.x1;
  const dy = torsoSeg.y2 - torsoSeg.y1;
  const len = Math.hypot(dx, dy);
  const dirSign = (frame.facing ?? 1) < 0 ? -1 : 1;
  const fwdPerpX = (-dy / len) * dirSign;
  const fwdPerpY = (dx / len) * dirSign;
  const midX = (torsoSeg.x1 + torsoSeg.x2) / 2;
  const midY = (torsoSeg.y1 + torsoSeg.y2) / 2;
  const signedDist = (bez.cx - midX) * fwdPerpX + (bez.cy - midY) * fwdPerpY;
  return { offsetRatio: signedDist / len, bez, torso: torsoSeg };
}

describe("v03-r1 expressive curved spine, gaze pitch, hand glyphs & scale-adaptive strokes", () => {
  describe("curved quadratic Bezier spine (#torso)", () => {
    it.each([
      ["run", { action: "run", from: "left", to: "right" }],
      ["crouch", { action: "crouch" }],
      ["type-at-desk", { action: "type-at-desk" }]
    ] as const)("renders a backward-bowed forward C-curve on athletic/hunched %s while keeping exact hip/chest endpoints", (_label, action) => {
      const res = choreographAnimation({
        actor: { x: "center", facing: "right" },
        actions: [action]
      });
      expect(res.diagnostics).toEqual([]);
      const program = res.program!;
      const frame = sampleAnimation(program, program.spec.durationMs * 0.5);
      const { offsetRatio, bez, torso } = signedForwardOffset(frame);

      expect(bez.x1).toBeCloseTo(torso.x1, 2);
      expect(bez.y1).toBeCloseTo(torso.y1, 2);
      expect(bez.x2).toBeCloseTo(torso.x2, 2);
      expect(bez.y2).toBeCloseTo(torso.y2, 2);
      // Forward C-curve bows backward (-forwardPerp) between 4.5% and 11% of torsoLen
      expect(offsetRatio).toBeLessThanOrEqual(-0.044);
      expect(offsetRatio).toBeGreaterThanOrEqual(-0.111);
    });

    it.each(["cheer", "idea"] as const)("renders an open-chest arch quadratic Bezier on %s with exact hip/chest endpoints", (action) => {
      const res = choreographAnimation({
        actor: { x: "center", facing: "right" },
        actions: [{ action }]
      });
      expect(res.diagnostics).toEqual([]);
      const program = res.program!;
      const frame = sampleAnimation(program, program.spec.durationMs * 0.55);
      const { offsetRatio, bez, torso } = signedForwardOffset(frame);

      expect(bez.x1).toBeCloseTo(torso.x1, 2);
      expect(bez.y1).toBeCloseTo(torso.y1, 2);
      expect(bez.x2).toBeCloseTo(torso.x2, 2);
      expect(bez.y2).toBeCloseTo(torso.y2, 2);
      expect(offsetRatio).toBeGreaterThanOrEqual(0.018);
      expect(offsetRatio).toBeLessThanOrEqual(0.11);
    });

    it("preserves head-to-neck attachment distance and ground clearance under gaze/landing micro-pitch", () => {
      const res = choreographAnimation({
        actor: { x: "center", facing: "right" },
        actions: [{ action: "type-at-desk" }, { action: "jump" }, { action: "idea" }]
      });
      expect(res.diagnostics).toEqual([]);
      const program = res.program!;
      for (let t = 0; t <= program.spec.durationMs; t += 150) {
        const frame = sampleAnimation(program, t);
        const geom = frameGeometry(frame);
        const torso = frame.segments.find((s) => s.id === "torso")!;
        const neckDist = Math.hypot(geom.head.x - torso.x2, geom.head.y - torso.y2);
        expect(neckDist).toBeCloseTo(geom.headRadius, 3);
        expect(geom.head.y + geom.headRadius + geom.strokeWidth / 2).toBeLessThanOrEqual(frame.groundY + 0.02);
      }
    });
  });

  describe("automatic gaze inference, explicit overrides & SVG gaze rendering", () => {
    it("infers downward gaze on type-at-desk and upward gaze on idea and basketball-shot", () => {
      const desk = choreographAnimation({ actions: [{ action: "type-at-desk" }] });
      expect(desk.diagnostics).toEqual([]);
      const deskFrame = sampleAnimation(desk.program!, desk.program!.spec.durationMs * 0.5);
      expect(deskFrame.gazeDir).toBeDefined();
      expect(Math.hypot(deskFrame.gazeDir!.x, deskFrame.gazeDir!.y)).toBeCloseTo(1, 3);
      expect(deskFrame.gazeDir!.y).toBeGreaterThan(0.15);
      expect(deskFrame.actors![0]!.gazeDir!.y).toBeGreaterThan(0.15);

      for (const action of ["idea", "basketball-shot"] as const) {
        const upRes = choreographAnimation({ actions: [{ action }] });
        expect(upRes.diagnostics).toEqual([]);
        const upFrame = sampleAnimation(upRes.program!, upRes.program!.spec.durationMs * 0.55);
        expect(upFrame.gazeDir).toBeDefined();
        expect(Math.hypot(upFrame.gazeDir!.x, upFrame.gazeDir!.y)).toBeCloseTo(1, 3);
        expect(upFrame.gazeDir!.y).toBeLessThan(-0.15);
      }
    });

    it("supports explicit gaze modes ('down', 'up', 'forward', and { x, y }) and validates bad values", () => {
      const res = choreographAnimation({
        actor: { x: "center", facing: "right" },
        actions: [
          { action: "idle", durationMs: 600, gaze: "down" },
          { action: "idle", durationMs: 600, gaze: "up" },
          { action: "idle", durationMs: 600, gaze: { x: 650, y: 120 } }
        ]
      });
      expect(res.diagnostics).toEqual([]);
      const program = res.program!;

      const downFrame = sampleAnimation(program, 300);
      const upFrame = sampleAnimation(program, 900);
      const ptFrame = sampleAnimation(program, 1500);

      expect(downFrame.gazeDir!.y).toBeGreaterThan(0.15);
      expect(upFrame.gazeDir!.y).toBeLessThan(-0.15);
      expect(ptFrame.gazeDir!.x).toBeGreaterThan(0.5);
      expect(ptFrame.gazeDir!.y).toBeLessThan(-0.15);

      const invalid = choreographAnimation({
        actions: [{ action: "idle", gaze: "sideways" as unknown as "forward" }]
      });
      expect(invalid.valid).toBe(false);
      expect(invalid.diagnostics.some((d) => d.code === "invalid_gaze")).toBe(true);
    });

    it("renders data-part='gaze' inside the head circle and shifts eye vertical position with gaze pitch", () => {
      const deskRes = choreographAnimation({ actions: [{ action: "type-at-desk" }] });
      const ideaRes = choreographAnimation({ actions: [{ action: "idea" }] });
      const cheerRes = choreographAnimation({ actions: [{ action: "cheer" }] });
      expect(deskRes.valid && ideaRes.valid && cheerRes.valid).toBe(true);

      const deskSvg = renderSvgFrame(deskRes.program!, deskRes.program!.spec.durationMs * 0.5);
      const ideaSvg = renderSvgFrame(ideaRes.program!, ideaRes.program!.spec.durationMs * 0.6);
      const cheerSvg = renderSvgFrame(cheerRes.program!, cheerRes.program!.spec.durationMs * 0.5);

      const extractGaze = (svg: string) => {
        const gMatch = /<g data-part="gaze"[^>]*>([\s\S]*?)<\/g>/.exec(svg);
        expect(gMatch).not.toBeNull();
        const circles = [...gMatch![1]!.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="(-?[\d.]+)"\/>/g)].map(
          (m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) })
        );
        const headMatch = /<circle data-segment="head" cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="(-?[\d.]+)"/.exec(svg);
        expect(headMatch).not.toBeNull();
        return {
          circles,
          head: { cx: Number(headMatch![1]), cy: Number(headMatch![2]), r: Number(headMatch![3]) }
        };
      };

      const deskGaze = extractGaze(deskSvg);
      const ideaGaze = extractGaze(ideaSvg);
      const cheerGaze = extractGaze(cheerSvg);

      // Side profile: 1 eye dot; front view (cheer): 2 eye dots
      expect(deskGaze.circles).toHaveLength(1);
      expect(ideaGaze.circles).toHaveLength(1);
      expect(cheerGaze.circles).toHaveLength(2);

      // Eyes stay strictly inside the head circle
      for (const item of [deskGaze, ideaGaze, cheerGaze]) {
        for (const eye of item.circles) {
          const dist = Math.hypot(eye.cx - item.head.cx, eye.cy - item.head.cy);
          expect(dist + eye.r).toBeLessThan(item.head.r);
        }
      }

      // Looking down places eye lower relative to head center than looking up
      const deskRelY = (deskGaze.circles[0]!.cy - deskGaze.head.cy) / deskGaze.head.r;
      const ideaRelY = (ideaGaze.circles[0]!.cy - ideaGaze.head.cy) / ideaGaze.head.r;
      expect(deskRelY).toBeGreaterThan(ideaRelY + 0.15);
    });
  });

  describe("expressive minimal hand glyphs", () => {
    it("renders distinct data-part='hand-glyph' silhouettes for thumbs-up, wave, idea, and hold-sign", () => {
      const cases = [
        ["thumbs-up", "thumbs-up"],
        ["wave", "open"],
        ["idea", "point"],
        ["hold-sign", "grip"]
      ] as const;

      const glyphs = new Map<string, string>();
      for (const [action, expectedKind] of cases) {
        const res = choreographAnimation({ actions: [{ action }] });
        expect(res.diagnostics).toEqual([]);
        const svg = renderSvgFrame(res.program!, res.program!.spec.durationMs * 0.6);
        const match = /<g data-part="hand-glyph" data-glyph="([^"]+)">([\s\S]*?)<\/g>/.exec(svg);
        expect(match, `${action} should render hand-glyph`).not.toBeNull();
        expect(match![1]).toBe(expectedKind);
        expect(match![2]!.length).toBeGreaterThan(10);
        expect(match![2]).not.toMatch(/NaN|Infinity/);
        glyphs.set(action, match![0]);
      }

      expect(new Set(glyphs.values()).size).toBe(4);
    });

    it("preserves v1 DOM structure without injecting gaze dots or hand glyphs into v1FrameMarkup", () => {
      const compiled = compileAnimation({
        version: "stickman.animation/v1",
        canvas: { width: 640, height: 360, fps: 30 },
        durationMs: 1600,
        actor: { x: 180, groundY: 290 },
        actions: [{ action: "wave", startMs: 0, durationMs: 1400 }]
      });
      expect(compiled.valid).toBe(true);
      const svg = renderSvgFrame(compiled.program!, 600);
      expect(svg).not.toContain('data-part="gaze"');
      expect(svg).not.toContain('data-part="hand-glyph"');
      expect(svg.match(/<circle\b/g) ?? []).toHaveLength(1);
      expect(svg).toMatch(/<path id="torso" d="M[^"]+Q[^"]+"/);
    });
  });

  describe("sub-linear scale-adaptive stroke width", () => {
    it("tapers stroke width cleanly across actor scales 0.4, 1.0, and 1.6 with strokeWidth/headRadius <= 0.28 at scale 0.4", () => {
      const measure = (scale: number) => {
        const res = choreographAnimation({
          canvas: { width: 800, height: 450, fps: 30 },
          actor: { x: "center", scale },
          actions: [{ action: "idle", durationMs: 800 }]
        });
        expect(res.diagnostics).toEqual([]);
        const frame = sampleAnimation(res.program!, 400);
        const geom = frameGeometry(frame);
        const svg = renderSvgFrame(res.program!, 400);
        return { geom, svg };
      };

      const small = measure(0.4);
      const standard = measure(1.0);
      const large = measure(1.6);

      expect(small.geom.strokeWidth).toBeGreaterThanOrEqual(1.25);
      expect(small.geom.strokeWidth / small.geom.headRadius).toBeLessThanOrEqual(0.28);
      expect(small.geom.strokeWidth).toBeLessThan(2.0);

      expect(standard.geom.strokeWidth / (standard.geom.headRadius * 2)).toBeCloseTo(0.09, 3);
      expect(standard.geom.strokeWidth).toBeGreaterThan(small.geom.strokeWidth);

      expect(large.geom.strokeWidth).toBeGreaterThan(standard.geom.strokeWidth);
      expect(large.geom.strokeWidth / large.geom.headRadius).toBeLessThan(standard.geom.strokeWidth / standard.geom.headRadius);

      for (const item of [small, standard, large]) {
        expect(item.svg).not.toMatch(/NaN|Infinity/);
        expect(item.svg).not.toMatch(/(?<![0-9.])-(0(?:\.0+)?)(?![0-9.])/);
      }
    });
  });
});
