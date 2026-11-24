import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION_V2,
  animationSchemaV2,
  cameraFrustum,
  choreographAnimation,
  inferStatusCalloutStyle,
  renderAnimatedSvg,
  renderCalloutSvg,
  renderHtml,
  renderStoryboardSvg,
  renderSvgFrame,
  resolveCompiledCallouts,
  sampleAnimation,
  sampleCallouts,
  sampleCamera,
  type SampledCallout
} from "../src/index.js";

function assertCleanSvg(svg: string, label: string): void {
  expect(svg.length, `${label}: non-empty`).toBeGreaterThan(0);
  expect(svg, `${label}: no <script>`).not.toMatch(/<script\b/i);
  expect(svg, `${label}: no NaN/Infinity/undefined`).not.toMatch(/\b(NaN|Infinity|undefined)\b/);
  expect(svg, `${label}: balanced svg root`).toContain("<svg");
  expect(svg, `${label}: closing svg root`).toContain("</svg>");
}

function boxesIntersect(a: SampledCallout, b: SampledCallout): boolean {
  return (
    a.x < b.x + b.width - 1e-3 &&
    a.x + a.width > b.x + 1e-3 &&
    a.y < b.y + b.height - 1e-3 &&
    a.y + a.height > b.y + 1e-3
  );
}

describe("v03-r3: 2D virtual camera track & auto-director", () => {
  it("supports explicit camera keyframes with zoom, followActor, thirds-left, atCue, holdMs, and cut vs inOut", () => {
    const res = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      canvas: { width: 800, height: 450, fps: 30 },
      durationMs: 3000,
      actors: [
        {
          id: "alice",
          x: 240,
          actions: [
            { action: "wave", startMs: 0, durationMs: 900, emitCue: "alice-done" },
            { action: "present", startMs: 900, durationMs: 1200 }
          ]
        },
        {
          id: "bob",
          x: 560,
          actions: [
            { action: "nod", startMs: 1200, durationMs: 1200 }
          ]
        }
      ],
      camera: [
        { timeMs: 0, x: 400, y: 225, zoom: 1, ease: "inOut" },
        { atCue: "alice-done", followActor: "alice", framing: "thirds-left", zoom: 1.5, holdMs: 400, ease: "inOut" },
        { timeMs: 2200, followActor: "bob", framing: "thirds-right", zoom: 1.6, ease: "cut" }
      ]
    });

    expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
    const program = res.program!;

    // t=0: wide establishing
    const f0 = sampleAnimation(program, 0);
    expect(f0.camera).toBeDefined();
    expect(f0.camera!.zoom).toBeCloseTo(1, 3);
    expect(f0.camera!.x).toBeCloseTo(400, 1);
    expect(f0.camera!.y).toBeCloseTo(225, 1);
    expect(f0.camera!.viewBox).toBe("0 0 800 450");

    // Mid-pan (inOut Hermite): halfway between 0 and 900ms (t=450ms) -> smooth midpoint zoom 1.25
    const fMid = sampleAnimation(program, 450);
    expect(fMid.camera!.zoom).toBeCloseTo(1.25, 2);

    // At cue (t=900ms): zoomed 1.5 on alice with thirds-left (~36% of viewport)
    const fCue = sampleAnimation(program, 900);
    expect(fCue.camera!.zoom).toBeCloseTo(1.5, 2);
    expect(fCue.camera!.activeActorId).toBe("alice");
    const frustumCue = cameraFrustum(fCue.camera!, 800, 450);
    const aliceRelX = (240 - frustumCue.x) / frustumCue.width;
    expect(aliceRelX).toBeGreaterThan(0.3);
    expect(aliceRelX).toBeLessThan(0.46);

    // During holdMs (t=1150ms): holds alice zoom 1.5
    const fHold = sampleAnimation(program, 1150);
    expect(fHold.camera!.zoom).toBeCloseTo(1.5, 2);
    expect(fHold.camera!.activeActorId).toBe("alice");

    // Before cut (t=2199ms): still on alice (cut holds previous keyframe until exact cut time)
    const fBeforeCut = sampleAnimation(program, 2199);
    expect(fBeforeCut.camera!.zoom).toBeCloseTo(1.5, 2);
    expect(fBeforeCut.camera!.activeActorId).toBe("alice");

    // At cut (t=2200ms): instant jump to bob with thirds-right (~64% of viewport)
    const fAfterCut = sampleAnimation(program, 2200);
    expect(fAfterCut.camera!.zoom).toBeCloseTo(1.6, 2);
    expect(fAfterCut.camera!.activeActorId).toBe("bob");
    const frustumBob = cameraFrustum(fAfterCut.camera!, 800, 450);
    const bobRelX = (560 - frustumBob.x) / frustumBob.width;
    expect(bobRelX).toBeGreaterThan(0.54);
    expect(bobRelX).toBeLessThan(0.72);

    // Standalone sampleCamera(program, timeMs) matches frame sampling cleanly
    const standalone = sampleCamera(program, 2200, fAfterCut);
    expect(standalone).toEqual(fAfterCut.camera);

    // SVG frame, animated SVG, HTML, and storyboard all render camera cleanly without <script> in SVG
    const svgFrame = renderSvgFrame(program, 900);
    assertCleanSvg(svgFrame, "camera svg-frame");
    expect(svgFrame).toContain('data-camera="true"');
    expect(svgFrame).toContain('clip-path="url(#sm-cam-clip)"');

    const animSvg = renderAnimatedSvg(program);
    assertCleanSvg(animSvg, "camera animated-svg");
    expect(animSvg).toContain('data-camera="true"');
    expect(animSvg).toContain('id="sm-cam-clip"');

    const html = renderHtml(program);
    expect(html).toContain('data-camera="true"');

    const sbSvg = renderStoryboardSvg(program, { maxPanels: 4 });
    assertCleanSvg(sbSvg, "camera storyboard-svg");
    expect(sbSvg).toContain('data-camera="true"');
  });

  it("drives deterministic auto-director framing with establishing wide, hero punch-in, finale pullback, and frustum clamp", () => {
    const res = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      canvas: { width: 800, height: 450, fps: 30 },
      durationMs: 4200,
      camera: "auto-director",
      actors: [
        {
          id: "speaker",
          x: 110,
          actions: [
            { action: "idea", startMs: 600, durationMs: 1200, say: "Eureka!" },
            { action: "cheer", startMs: 3600, durationMs: 600 }
          ]
        },
        {
          id: "writer",
          x: 690,
          actions: [
            { action: "write-board", startMs: 2000, durationMs: 1200 },
            { action: "cheer", startMs: 3600, durationMs: 600 }
          ]
        }
      ]
    });

    expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
    const program = res.program!;

    // Establishing wide at t=0
    const startCam = sampleAnimation(program, 0).camera!;
    expect(startCam.zoom).toBeCloseTo(1, 3);
    expect(startCam.x).toBeCloseTo(400, 1);
    expect(startCam.y).toBeCloseTo(225, 1);

    // Finale pullback at durationMs
    const endCam = sampleAnimation(program, 4200).camera!;
    expect(endCam.zoom).toBeCloseTo(1, 3);
    expect(endCam.x).toBeCloseTo(400, 1);

    // Scan timeline: verify determinism, hero punch-in, and strict stage frustum clamping + actor visibility
    let peakZoom = 1;
    for (let t = 0; t <= 4200; t += 150) {
      const fA = sampleAnimation(program, t);
      const fB = sampleAnimation(program, t);
      expect(fA.camera).toEqual(fB.camera);

      const cam = fA.camera!;
      peakZoom = Math.max(peakZoom, cam.zoom);
      expect(cam.zoom).toBeGreaterThanOrEqual(1);
      expect(cam.zoom).toBeLessThanOrEqual(1.32);

      const frustum = cameraFrustum(cam, 800, 450);
      expect(frustum.x).toBeGreaterThanOrEqual(-0.05);
      expect(frustum.y).toBeGreaterThanOrEqual(-0.05);
      expect(frustum.x + frustum.width).toBeLessThanOrEqual(800.05);
      expect(frustum.y + frustum.height).toBeLessThanOrEqual(450.05);

      if (cam.activeActorId) {
        const focal = fA.actors!.find((a) => a.id === cam.activeActorId)!;
        const headTop = focal.head.y - 11 * focal.scale;
        expect(headTop).toBeGreaterThanOrEqual(frustum.y - 2);
        expect(focal.groundY).toBeLessThanOrEqual(frustum.y + frustum.height + 2);
        expect(focal.x).toBeGreaterThanOrEqual(frustum.x - 2);
        expect(focal.x).toBeLessThanOrEqual(frustum.x + frustum.width + 2);
      }
    }

    // Hero beat (`idea` / `write-board`) should punch in close to 1.28
    expect(peakZoom).toBeGreaterThanOrEqual(1.24);
  });
});

describe("v03-r3: 2.5D depth horizon & active-actor spotlight", () => {
  it("couples depth to smaller scale, higher horizon groundY, lower zIndex, back-to-front SVG paint order, and depth shadow pill", () => {
    const res = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      canvas: { width: 800, height: 450, fps: 30 },
      actors: [
        {
          id: "fg",
          x: 320,
          depth: 0,
          actions: [{ action: "wave", durationMs: 1200 }]
        },
        {
          id: "bg",
          x: 480,
          depth: 0.7,
          actions: [{ action: "present", durationMs: 1200 }]
        }
      ]
    });

    expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
    const program = res.program!;
    const frame = sampleAnimation(program, 500);
    const fg = frame.actors!.find((a) => a.id === "fg")!;
    const bg = frame.actors!.find((a) => a.id === "bg")!;

    // Depth coupling checks
    expect(bg.scale).toBeLessThan(fg.scale);
    expect(bg.scale).toBeCloseTo(1 - 0.7 * 0.32, 2);
    expect(fg.scale).toBeCloseTo(1, 2);

    expect(bg.groundY).toBeLessThan(fg.groundY);
    const expectedHorizonShift = Math.round(0.7 * Math.round(450 * 0.14));
    expect(fg.groundY - bg.groundY).toBe(expectedHorizonShift);

    expect(bg.zIndex).toBeLessThan(fg.zIndex);
    expect(bg.depth).toBe(0.7);
    expect(fg.depth).toBe(0);

    // Back-to-front painter's order in sampled actors & rendered SVG
    expect(frame.actors![0]!.id).toBe("bg");
    expect(frame.actors![1]!.id).toBe("fg");

    const svg = renderSvgFrame(program, 500);
    assertCleanSvg(svg, "depth horizon svg");
    const bgIndex = svg.indexOf('data-actor="bg"');
    const fgIndex = svg.indexOf('data-actor="fg"');
    expect(bgIndex).toBeGreaterThan(-1);
    expect(fgIndex).toBeGreaterThan(bgIndex);
    // Subtle horizon shadow pill rendered for depth > 0.05 only
    expect(svg).toContain('data-part="depth-shadow"');
    expect(svg.match(/data-part="depth-shadow"/g)?.length).toBe(1);
  });

  it("dims idle background actors under spotlight: 'auto' on a 4-actor scene and keeps all at 1.0 when everyone celebrates", () => {
    const res = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      canvas: { width: 800, height: 450, fps: 30 },
      durationMs: 3000,
      spotlight: "auto",
      actors: [
        {
          id: "lead",
          x: 180,
          actions: [
            { action: "present", startMs: 200, durationMs: 1400 },
            { action: "cheer", startMs: 2200, durationMs: 800 }
          ]
        },
        {
          id: "peer1",
          x: 340,
          actions: [{ action: "cheer", startMs: 2200, durationMs: 800 }]
        },
        {
          id: "peer2",
          x: 500,
          actions: [{ action: "cheer", startMs: 2200, durationMs: 800 }]
        },
        {
          id: "peer3",
          x: 660,
          actions: [{ action: "cheer", startMs: 2200, durationMs: 800 }]
        }
      ]
    });

    expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
    const program = res.program!;

    // t=0: everyone idle -> all at opacity 1
    const fIdle = sampleAnimation(program, 0);
    for (const actor of fIdle.actors!) {
      expect(actor.opacity).toBe(1);
    }

    // t=900ms: only lead is active -> lead opacity === 1, idle peers < 0.7 (0.58)
    const fSolo = sampleAnimation(program, 900);
    const lead = fSolo.actors!.find((a) => a.id === "lead")!;
    expect(lead.opacity).toBe(1);
    for (const peerId of ["peer1", "peer2", "peer3"]) {
      const peer = fSolo.actors!.find((a) => a.id === peerId)!;
      expect(peer.opacity).toBeDefined();
      expect(peer.opacity!).toBeLessThan(0.7);
      expect(peer.opacity!).toBeCloseTo(0.58, 2);
    }

    const soloSvg = renderSvgFrame(program, 900);
    assertCleanSvg(soloSvg, "spotlight svg");
    expect(soloSvg).toContain('opacity="0.58"');

    // t=2600ms: all 4 actors celebrating -> all stay at opacity 1
    const fFinale = sampleAnimation(program, 2600);
    for (const actor of fFinale.actors!) {
      expect(actor.opacity).toBe(1);
    }
  });
});

describe("v03-r3: editorial speech, thought, status & caption callouts", () => {
  it("supports inline say, think, badge shorthands with tone/icon auto-inference and >= 900ms readable hold", () => {
    expect(inferStatusCalloutStyle("! Alert: latency spike")).toEqual({ tone: "danger", icon: "alert" });
    expect(inferStatusCalloutStyle("! P1")).toEqual({ tone: "danger", icon: "alert" });
    expect(inferStatusCalloutStyle("Error!")).toEqual({ tone: "danger", icon: "alert" });
    expect(inferStatusCalloutStyle("Build failed!")).toEqual({ tone: "danger", icon: "alert" });
    expect(inferStatusCalloutStyle("✓ Verified")).toEqual({ tone: "success", icon: "check" });
    expect(inferStatusCalloutStyle("✓ Top!")).toEqual({ tone: "success", icon: "check" });
    expect(inferStatusCalloutStyle("✓ Live!")).toEqual({ tone: "success", icon: "check" });
    expect(inferStatusCalloutStyle("Live!")).toEqual({ tone: "success", icon: "check" });
    expect(inferStatusCalloutStyle("Top!")).toEqual({ tone: "success", icon: "check" });
    expect(inferStatusCalloutStyle("Done!")).toEqual({ tone: "success", icon: "check" });
    expect(inferStatusCalloutStyle("All green!")).toEqual({ tone: "success", icon: "check" });
    expect(inferStatusCalloutStyle("Passed!")).toEqual({ tone: "success", icon: "check" });
    expect(inferStatusCalloutStyle("99.98%")).toEqual({ tone: "accent", icon: "metric" });

    const res = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      canvas: { width: 800, height: 450, fps: 30 },
      actors: [
        {
          id: "ops",
          x: 260,
          actions: [
            { action: "surprised", startMs: 0, durationMs: 400, say: "Watch <out> & check \"logs\"!", badge: "! Alert" },
            { action: "think", startMs: 1200, durationMs: 500, think: "Could it be cache expiry?" },
            { action: "thumbs-up", startMs: 2200, durationMs: 450, badge: "✓ Verified" }
          ]
        }
      ],
      callouts: [
        { kind: "caption", text: "Incident response timeline", startMs: 0, durationMs: 2000 }
      ]
    });

    expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
    const program = res.program!;
    const compiled = resolveCompiledCallouts(program);

    // Every callout enforces >= 900ms readable hold even for 400ms actions
    for (const item of compiled) {
      expect(item.durationMs).toBeGreaterThanOrEqual(900);
    }

    // At t=700ms (after 400ms action ended), the speech & alert badge remain readable within their 900ms hold!
    const f700 = sampleAnimation(program, 700);
    expect(f700.callouts!.some((c) => c.kind === "speech")).toBe(true);
    const alertBadge = f700.callouts!.find((c) => c.kind === "status");
    expect(alertBadge).toBeDefined();
    expect(alertBadge!.tone).toBe("danger");
    expect(alertBadge!.icon).toBe("alert");

    // At t=1400ms, thought bubble is active
    const f1400 = sampleAnimation(program, 1400);
    expect(f1400.callouts!.some((c) => c.kind === "thought")).toBe(true);

    // At t=2400ms, verified badge is active with success/check
    const f2400 = sampleAnimation(program, 2400);
    const okBadge = f2400.callouts!.find((c) => c.kind === "status");
    expect(okBadge!.tone).toBe("success");
    expect(okBadge!.icon).toBe("check");

    // XML escaping & zero <script> in SVG
    const svg = renderSvgFrame(program, 700);
    assertCleanSvg(svg, "callouts svg");
    expect(svg).toContain('data-layer="callouts"');
    expect(svg).toContain("&lt;out&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&quot;logs&quot;");
    expect(svg).toContain('data-callout-kind="caption"');
    expect(svg).toContain('data-callout-icon="alert"');
  });

  it("prevents overlapping bubbles, head collisions, and viewport overflow for nearby simultaneous speakers", () => {
    const res = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      canvas: { width: 800, height: 450, fps: 30 },
      durationMs: 2000,
      camera: [{ timeMs: 0, x: 400, y: 240, zoom: 1.25 }],
      actors: [
        {
          id: "a",
          x: 370,
          actions: [
            {
              action: "present",
              startMs: 0,
              durationMs: 1600,
              say: "Deploying the new routing layer right now.",
              badge: "99.98%"
            }
          ]
        },
        {
          id: "b",
          x: 425,
          actions: [
            {
              action: "wave",
              startMs: 0,
              durationMs: 1600,
              say: "Telemetry looks completely green on my side!",
              think: "Zero retries observed."
            }
          ]
        }
      ],
      callouts: [
        { kind: "caption", text: "Simultaneous dialogue anti-collision test", startMs: 0, durationMs: 1800 }
      ]
    });

    expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
    const program = res.program!;
    const frame = sampleAnimation(program, 600);
    const callouts = frame.callouts!;
    expect(callouts.length).toBe(5);

    const frustum = cameraFrustum(frame.camera!, 800, 450);

    // 1. Zero viewport & camera frustum overflow
    for (const c of callouts) {
      expect(c.x).toBeGreaterThanOrEqual(Math.max(8, frustum.x + 8) - 0.1);
      expect(c.y).toBeGreaterThanOrEqual(Math.max(8, frustum.y + 8) - 0.1);
      expect(c.x + c.width).toBeLessThanOrEqual(Math.min(792, frustum.x + frustum.width - 8) + 0.1);
      expect(c.y + c.height).toBeLessThanOrEqual(Math.min(442, frustum.y + frustum.height - 8) + 0.1);

      // 2. Does not cover any actor's head
      for (const actor of frame.actors!) {
        const hr = 11 * actor.scale;
        const overlapsHead =
          c.x < actor.head.x + hr - 0.5 &&
          c.x + c.width > actor.head.x - hr + 0.5 &&
          c.y < actor.head.y + hr - 0.5 &&
          c.y + c.height > actor.head.y - hr + 0.5;
        expect(overlapsHead, `callout ${c.id} overlaps head of ${actor.id}`).toBe(false);
      }
    }

    // 3. Zero pairwise intersections across all 5 active callouts
    for (let i = 0; i < callouts.length; i++) {
      for (let j = i + 1; j < callouts.length; j++) {
        expect(
          boxesIntersect(callouts[i]!, callouts[j]!),
          `callout ${callouts[i]!.id} intersects ${callouts[j]!.id}`
        ).toBe(false);
      }
    }

    // 4. Direct renderCalloutSvg produces valid scriptless SVG markup
    for (const c of callouts) {
      const markup = renderCalloutSvg(c);
      expect(markup).not.toMatch(/<script\b/i);
      expect(markup).toContain(`data-callout="${c.id}"`);
    }

    // 5. Direct sampleCallouts matches frame.callouts deterministically
    expect(sampleCallouts(program, 600, frame)).toEqual(callouts);
  });

  it("preserves 100% backward compatibility when camera, depth, spotlight, and callouts are omitted, and validates invalid inputs", () => {
    const plain = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      actors: [
        { id: "solo", x: "center", actions: [{ action: "wave", durationMs: 1000 }] }
      ]
    });
    expect(plain.valid).toBe(true);
    const frame = sampleAnimation(plain.program!, 400);
    expect(frame.camera).toBeUndefined();
    expect(frame.callouts).toBeUndefined();
    expect(frame.actors![0]!.depth).toBeUndefined();
    expect(frame.actors![0]!.opacity).toBeUndefined();
    expect(frame.actors![0]!.zIndex).toBe(0);

    const svg = renderSvgFrame(plain.program!, 400);
    expect(svg).not.toContain("data-camera");
    expect(svg).not.toContain("data-layer=\"callouts\"");
    expect(svg).not.toContain("depth-shadow");

    // Validation diagnostics on invalid camera/depth/spotlight/callouts
    const bad = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      spotlight: "always" as unknown as boolean,
      camera: [{ timeMs: 0, zoom: 9, followActor: "ghost" }],
      callouts: [{ text: "Hi", actorId: "ghost" }],
      actors: [{ id: "a", depth: 1.5, actions: [{ action: "wave" }] }]
    });
    expect(bad.valid).toBe(false);
    const codes = bad.diagnostics.map((d) => d.code);
    expect(codes).toContain("out_of_range");
    expect(codes).toContain("unknown_camera_actor");
    expect(codes).toContain("unknown_callout_actor");

    // JSON Schema exposes the new fields
    expect(animationSchemaV2.properties.camera).toBeDefined();
    expect(animationSchemaV2.properties.spotlight).toBeDefined();
    expect(animationSchemaV2.properties.callouts).toBeDefined();
  });
});
