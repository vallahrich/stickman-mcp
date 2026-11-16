import { runInNewContext } from "node:vm";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  CONTRACT_VERSION_V2,
  PlaybackSession,
  STAGE_ANCHOR_NAMES,
  analyzeStoryboard,
  animationSchema,
  animationSchemaV2,
  choreographAnimation,
  compileAnimation,
  renderSvgFrame,
  resolveStageAnchors,
  sampleAnimation,
  validateAnimation,
  type SampledActorFrame,
  type SampledFrame
} from "../src/index.js";

function maxJointStep(a: SampledActorFrame | SampledFrame, b: SampledActorFrame | SampledFrame): number {
  const pts = (f: SampledActorFrame | SampledFrame) => [
    f.head,
    ...f.segments.flatMap((s) => [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 }
    ])
  ];
  const pa = pts(a);
  const pb = pts(b);
  return Math.max(...pa.map((p, idx) => Math.hypot(p.x - pb[idx]!.x, p.y - pb[idx]!.y)));
}

describe("R4 stickman.animation/v2 multi-actor choreography, stage anchors & auto-sequencing", () => {
  it("resolves all built-in semantic stage anchors and merges custom anchors", () => {
    const anchors = resolveStageAnchors({ width: 800, height: 450 }, undefined, {
      lectern: { x: 240 }
    });
    for (const name of STAGE_ANCHOR_NAMES) {
      expect(anchors[name], name).toBeDefined();
    }
    expect(anchors["offstage-left"]).toEqual({ x: -48, y: 369 });
    expect(anchors.left).toEqual({ x: 144, y: 369 });
    expect(anchors["center-left"]).toEqual({ x: 280, y: 369 });
    expect(anchors.center).toEqual({ x: 400, y: 369 });
    expect(anchors["center-right"]).toEqual({ x: 520, y: 369 });
    expect(anchors.right).toEqual({ x: 656, y: 369 });
    expect(anchors["offstage-right"]).toEqual({ x: 848, y: 369 });
    expect(anchors.board!.x).toBeGreaterThan(anchors.center!.x);
    expect(anchors.board!.y).toBeLessThan(369);
    expect(anchors.lectern).toEqual({ x: 240, y: 369 });
  });

  it("compiles & samples a zero-coordinate, zero-timestamp single-actor presentation story end-to-end", () => {
    const res = choreographAnimation({
      actor: { x: "offstage-left", color: "#1e293b", accessory: "tie" },
      theme: { accentColor: "#2563eb" },
      actions: [
        { action: "walk-on", to: "left" },
        { action: "point", to: "board" },
        { action: "think" }, // Sign 7: aim clip with NO target needed!
        { action: "idea@1.1.0" }, // Versioned ID normalized + yellow bulb auto-addon!
        { action: "present-card" },
        { action: "swipe-next" },
        { action: "cheer" },
        { action: "walk-off", to: "offstage-right" }
      ]
    });

    expect(res.diagnostics).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.spec).toBeDefined();
    expect(res.program).toBeDefined();

    const spec = res.spec!;
    const program = res.program!;
    expect(program.contractVersion).toBe(CONTRACT_VERSION_V2);
    expect(spec.canvas).toEqual({ width: 800, height: 450, fps: 30 });
    expect(spec.groundY).toBe(369);
    expect(spec.addons).toBe("auto");

    // Versioned action ID normalized to bare "idea" and timestamps auto-chained
    const resolvedActions = spec.actors[0]!.actions;
    expect(resolvedActions.map((a) => a.action)).toEqual([
      "walk-on",
      "point",
      "think",
      "idea",
      "present-card",
      "swipe-next",
      "cheer",
      "walk-off"
    ]);
    for (let i = 0; i < resolvedActions.length; i++) {
      const act = resolvedActions[i]!;
      expect(act.durationMs).toBeGreaterThanOrEqual(300);
      if (i > 0) {
        const prev = resolvedActions[i - 1]!;
        expect(act.startMs).toBe(prev.startMs + prev.durationMs);
      } else {
        expect(act.startMs).toBe(0);
      }
    }
    expect(spec.durationMs).toBe(resolvedActions.at(-1)!.startMs + resolvedActions.at(-1)!.durationMs);

    // Round-trip validateAnimation & compileAnimation on v2 spec
    expect(validateAnimation(spec)).toEqual({ valid: true, diagnostics: [] });
    const recompiled = compileAnimation(spec);
    expect(recompiled.valid).toBe(true);
    expect(recompiled.program).toEqual(program);

    // 1. Entrance: offstage-left (-48) -> left (144)
    const walkOnAct = resolvedActions[0]!;
    const enterStart = sampleAnimation(program, 0);
    const enterEnd = sampleAnimation(program, walkOnAct.startMs + walkOnAct.durationMs - 1);
    expect(enterStart.x).toBeCloseTo(-48, 1);
    expect(enterEnd.x).toBeCloseTo(144, 0);
    expect(enterEnd.actors).toHaveLength(1);
    expect(enterEnd.actors![0]!.accessory).toBe("tie");

    // 2. Point at board: right hand extends toward board (x > torso)
    const pointAct = resolvedActions[1]!;
    const pointMid = sampleAnimation(program, pointAct.startMs + pointAct.durationMs * 0.6);
    expect(pointMid.action).toBe("point");
    const rForearm = pointMid.segments.find((s) => s.id === "right-forearm")!;
    const torso = pointMid.segments.find((s) => s.id === "torso")!;
    expect(rForearm.x2).toBeGreaterThan(torso.x2);

    // 3. Think without explicit target: stays at "left" facing forward without unbound_target
    const thinkAct = resolvedActions[2]!;
    const thinkMid = sampleAnimation(program, thinkAct.startMs + thinkAct.durationMs * 0.5);
    expect(thinkMid.action).toBe("think");
    expect(thinkMid.x).toBeCloseTo(144, 1);

    // 4. Idea: yellow bulb pops above head automatically
    const ideaAct = resolvedActions[3]!;
    const ideaAha = sampleAnimation(program, ideaAct.startMs + ideaAct.durationMs * 0.7);
    expect(ideaAha.action).toBe("idea");
    const bulb = ideaAha.addons?.find((a) => a.type === "bulb");
    expect(bulb).toBeDefined();
    expect(bulb!.color).toBe("#f59e0b");
    expect(bulb!.secondaryColor).toBe("#ffd43b");
    expect(bulb!.y + bulb!.height).toBeLessThan(ideaAha.head.y);

    // 5. Present-card: themed accent color & pins forward after release
    const cardAct = resolvedActions[4]!;
    const cardPinnedA = sampleAnimation(program, cardAct.startMs + cardAct.durationMs * 0.6);
    const cardPinnedB = sampleAnimation(program, cardAct.startMs + cardAct.durationMs * 0.82);
    const cardA = cardPinnedA.addons?.find((a) => a.type === "card");
    const cardB = cardPinnedB.addons?.find((a) => a.type === "card");
    expect(cardA).toBeDefined();
    expect(cardB).toBeDefined();
    expect(cardA!.color).toBe("#2563eb");
    expect(cardB!.x).toBeCloseTo(cardA!.x, 2);
    expect(cardB!.y).toBeCloseTo(cardA!.y, 2);

    // 6. C1 continuity across action boundaries
    for (let i = 1; i < resolvedActions.length; i++) {
      const boundary = resolvedActions[i]!.startMs;
      const before = sampleAnimation(program, boundary - 1);
      const atBoundary = sampleAnimation(program, boundary);
      expect(maxJointStep(before, atBoundary)).toBeLessThan(8);
    }

    // 7. Walk-off reaches offstage-right in normal mode, while reduced & static stay visible onstage!
    const walkOffEnd = sampleAnimation(program, spec.durationMs, "normal");
    expect(walkOffEnd.x).toBeCloseTo(848, 1);

    for (const mode of ["reduced", "static"] as const) {
      const summary = sampleAnimation(program, 0, mode);
      expect(summary.timeMs).toBe(spec.durationMs);
      expect(summary.x).toBeCloseTo(144, 1);
      expect(summary.actors![0]!.x).toBeGreaterThan(0);
      expect(summary.actors![0]!.x).toBeLessThan(spec.canvas.width);
    }
  });

  it("synchronizes 2 actors via emitCue / afterCue with zIndex sorting, accessories, and marker actorId", () => {
    const res = choreographAnimation({
      actors: [
        {
          id: "presenter",
          label: "Lead Presenter",
          x: "left",
          color: "#111827",
          accessory: "tie",
          zIndex: 2,
          actions: [
            { action: "write-board", emitCue: "pointReady" },
            { action: "point", to: "board" }
          ]
        },
        {
          id: "colleague",
          label: "Reviewer",
          x: "right",
          color: "#374151",
          accessory: "glasses",
          scale: 0.92,
          zIndex: 1,
          actions: [
            { action: "surprised", afterCue: "pointReady" },
            { action: "thumbs-up" },
            { action: "clap" }
          ]
        }
      ]
    });

    expect(res.diagnostics).toEqual([]);
    expect(res.valid).toBe(true);
    const program = res.program!;
    const spec = res.spec!;

    const presenterSpec = spec.actors.find((a) => a.id === "presenter")!;
    const colleagueSpec = spec.actors.find((a) => a.id === "colleague")!;
    const cueTimestamp = presenterSpec.actions[0]!.startMs + presenterSpec.actions[0]!.durationMs;

    expect(colleagueSpec.actions[0]!.startMs).toBe(cueTimestamp);
    expect(colleagueSpec.actions[1]!.startMs).toBe(
      colleagueSpec.actions[0]!.startMs + colleagueSpec.actions[0]!.durationMs
    );
    expect(colleagueSpec.actions[2]!.startMs).toBe(
      colleagueSpec.actions[1]!.startMs + colleagueSpec.actions[1]!.durationMs
    );

    // Before cue: presenter writes on board (with progressive ink), colleague waits in idle facing left
    const midWrite = sampleAnimation(program, Math.round(cueTimestamp * 0.6));
    expect(midWrite.actors!.map((a) => a.id)).toEqual(["colleague", "presenter"]); // sorted by zIndex (1, 2)
    expect(midWrite.action).toBe("write-board"); // top-level populated from primary actors[0] (presenter)
    expect(midWrite.x).toBe(midWrite.actors!.find((a) => a.id === "presenter")!.x);

    const colIdle = midWrite.actors!.find((a) => a.id === "colleague")!;
    const presWrite = midWrite.actors!.find((a) => a.id === "presenter")!;
    expect(colIdle.action).toBe("idle");
    expect(colIdle.accessory).toBe("glasses");
    expect(colIdle.scale).toBeCloseTo(0.92, 3);
    expect(colIdle.facing).toBeLessThan(0); // faces left toward presenter
    expect(presWrite.action).toBe("write-board");
    expect(presWrite.accessory).toBe("tie");

    const boardAddon = midWrite.addons?.find((a) => a.type === "board" && a.actorId === "presenter");
    expect(boardAddon).toBeDefined();
    expect(boardAddon!.ink).toBeGreaterThan(0);

    // After cue: colleague reacts with surprised -> thumbs-up -> clap
    const colSurprisedFrame = sampleAnimation(program, cueTimestamp + 400);
    expect(colSurprisedFrame.actors!.find((a) => a.id === "colleague")!.action).toBe("surprised");

    // Smooth C1 transition from colleague idle into surprised at cueTimestamp
    const justBeforeCue = sampleAnimation(program, cueTimestamp - 1).actors!.find((a) => a.id === "colleague")!;
    const rightAtCue = sampleAnimation(program, cueTimestamp).actors!.find((a) => a.id === "colleague")!;
    expect(maxJointStep(justBeforeCue, rightAtCue)).toBeLessThan(6);

    const thumbsUpStart = colleagueSpec.actions[1]!.startMs;
    expect(
      sampleAnimation(program, thumbsUpStart + 300).actors!.find((a) => a.id === "colleague")!.action
    ).toBe("thumbs-up");

    const clapStart = colleagueSpec.actions[2]!.startMs;
    expect(
      sampleAnimation(program, clapStart + 300).actors!.find((a) => a.id === "colleague")!.action
    ).toBe("clap");

    // MarkerEvents carry actorId in v2 and PlaybackSession advances cleanly
    expect(program.events?.some((e) => e.actorId === "presenter" && e.marker === "pointReady")).toBe(true);
    expect(program.events?.every((e) => e.actorId === "presenter" || e.actorId === "colleague")).toBe(true);

    const session = new PlaybackSession(program);
    session.play();
    const snap = session.advance(cueTimestamp + 300);
    expect(snap.frame.actors).toHaveLength(2);
    expect(session.eventsBetween(0, cueTimestamp).some((e) => e.marker === "pointReady")).toBe(true);
  });

  it("supports emitCueAt clip marker names and look-around without explicit target", () => {
    const res = choreographAnimation({
      actors: [
        {
          id: "scout",
          x: "left",
          actions: [{ action: "look-around", emitCue: "spottedTarget", emitCueAt: "spotted" }]
        },
        {
          id: "partner",
          x: "center-right",
          actions: [{ action: "wave", afterCue: "spottedTarget" }]
        }
      ]
    });
    expect(res.valid).toBe(true);
    const scoutDur = res.spec!.actors[0]!.actions[0]!.durationMs;
    const partnerStart = res.spec!.actors[1]!.actions[0]!.startMs;
    expect(partnerStart).toBeGreaterThan(0);
    expect(partnerStart).toBeLessThan(scoutDur);
  });

  it("persists shared stage props across sit-down -> type-at-desk -> stand-up and plants world originX during hurdle", () => {
    // 1. Stage prop persistence across consecutive seated actions
    const deskRes = choreographAnimation({
      actor: { id: "coder", x: "center" },
      actions: [
        { action: "sit-down" },
        { action: "type-at-desk" },
        { action: "stand-up" }
      ]
    });
    expect(deskRes.diagnostics).toEqual([]);
    const deskProgram = deskRes.program!;
    const acts = deskRes.spec!.actors[0]!.actions;
    const tSitEnd = acts[0]!.startMs + acts[0]!.durationMs - 1;
    const tTypeStart = acts[1]!.startMs;
    const tTypeMid = acts[1]!.startMs + Math.round(acts[1]!.durationMs * 0.5);
    const tTypeEnd = acts[1]!.startMs + acts[1]!.durationMs - 1;
    const tStandStart = acts[2]!.startMs;

    const chairAt = (t: number) => sampleAnimation(deskProgram, t).addons?.find((a) => a.id === "chair");
    const cSitEnd = chairAt(tSitEnd)!;
    const cTypeStart = chairAt(tTypeStart)!;
    const cTypeMid = chairAt(tTypeMid)!;
    const cTypeEnd = chairAt(tTypeEnd)!;
    const cStandStart = chairAt(tStandStart)!;

    for (const c of [cSitEnd, cTypeStart, cTypeMid, cTypeEnd, cStandStart]) {
      expect(c).toBeDefined();
      expect(c.opacity).toBe(1);
      expect(c.x).toBe(cSitEnd.x);
      expect(c.y).toBe(cSitEnd.y);
    }
    expect(sampleAnimation(deskProgram, tTypeMid).addons?.find((a) => a.type === "desk")).toBeDefined();

    // 2. Sign 8: Hurdle stage prop stays planted at world originX while actor leaps across it
    const hurdleRes = choreographAnimation({
      actor: { id: "runner", x: "left" },
      actions: [{ action: "hurdle" }]
    });
    expect(hurdleRes.diagnostics).toEqual([]);
    const hurdleProg = hurdleRes.program!;
    const hurdleDur = hurdleRes.spec!.durationMs;

    const early = sampleAnimation(hurdleProg, hurdleDur * 0.15);
    const midAir = sampleAnimation(hurdleProg, hurdleDur * 0.55);
    const landed = sampleAnimation(hurdleProg, hurdleDur * 0.82);

    const hEarly = early.addons?.find((a) => a.type === "hurdle")!;
    const hMid = midAir.addons?.find((a) => a.type === "hurdle")!;
    const hLanded = landed.addons?.find((a) => a.type === "hurdle")!;

    expect(hEarly).toBeDefined();
    expect(hMid).toBeDefined();
    expect(hLanded).toBeDefined();
    // Planted at identical world coordinates throughout travel!
    expect(hMid.x).toBe(hEarly.x);
    expect(hLanded.x).toBe(hEarly.x);
    expect(hMid.y).toBe(hEarly.y);
    // Actor crosses from left of hurdle to right of hurdle!
    expect(early.x).toBeLessThan(hEarly.x);
    expect(landed.x).toBeGreaterThan(hEarly.x + hEarly.width);
  });

  it("reports actionable diagnostics for duplicate actors, missing/cyclic cues, bad anchors, offstage misuse, and typos", () => {
    // 1. Duplicate actor IDs
    const dup = choreographAnimation({
      actors: [
        { id: "alex", actions: [{ action: "wave" }] },
        { id: "alex", actions: [{ action: "clap" }] }
      ]
    });
    expect(dup.valid).toBe(false);
    expect(dup.diagnostics.map((d) => d.code)).toContain("duplicate_actor_id");

    // 2. Unknown afterCue
    const unknownCue = choreographAnimation({
      actors: [{ id: "a", actions: [{ action: "wave", afterCue: "ghostCue" }] }]
    });
    expect(unknownCue.valid).toBe(false);
    expect(unknownCue.diagnostics.map((d) => d.code)).toContain("invalid_cue_reference");

    // 3. Direct cyclic afterCue (A waits for B, B waits for A)
    const directCycle = choreographAnimation({
      actors: [
        { id: "a", actions: [{ action: "wave", afterCue: "fromB", emitCue: "fromA" }] },
        { id: "b", actions: [{ action: "clap", afterCue: "fromA", emitCue: "fromB" }] }
      ]
    });
    expect(directCycle.valid).toBe(false);
    expect(directCycle.diagnostics.map((d) => d.code)).toContain("cyclic_cue_dependency");

    // 4. Indirect sequential + cue cycle
    const indirectCycle = choreographAnimation({
      actors: [
        {
          id: "a",
          actions: [
            { action: "wave", afterCue: "bDone" },
            { action: "cheer", emitCue: "aDone" }
          ]
        },
        {
          id: "b",
          actions: [
            { action: "surprised", afterCue: "aDone" },
            { action: "clap", emitCue: "bDone" }
          ]
        }
      ]
    });
    expect(indirectCycle.valid).toBe(false);
    expect(indirectCycle.diagnostics.map((d) => d.code)).toContain("cyclic_cue_dependency");

    // 5. Unknown anchor -> unbound_target
    const badAnchor = choreographAnimation({
      actions: [{ action: "walk", to: "nonexistent-spot" }]
    });
    expect(badAnchor.valid).toBe(false);
    expect(badAnchor.diagnostics.map((d) => d.code)).toContain("unbound_target");

    // 6. Offstage anchor disallowed on non-entrance/exit action
    const badOffstage = choreographAnimation({
      actions: [{ action: "point", to: "offstage-right" }]
    });
    expect(badOffstage.valid).toBe(false);
    expect(badOffstage.diagnostics.map((d) => d.code)).toContain("target_outside_canvas");

    // 7. Unknown action with fuzzy suggestion
    const typo = choreographAnimation({
      actions: [{ action: "thumbsup" }]
    });
    expect(typo.valid).toBe(false);
    const unsupported = typo.diagnostics.find((d) => d.code === "unsupported_action")!;
    expect(unsupported).toBeDefined();
    expect(unsupported.message).toContain("thumbs-up");
  });

  it("resolves reduced and static playback modes cleanly for multi-actor scenes", () => {
    const res = choreographAnimation({
      actors: [
        {
          id: "alice",
          x: "offstage-left",
          actions: [
            { action: "walk-on", to: "center-left" },
            { action: "present-card", persist: true },
            { action: "walk-off", to: "offstage-right" }
          ]
        },
        {
          id: "bob",
          x: "right",
          actions: [{ action: "sit-down" }, { action: "type-at-desk" }]
        }
      ]
    });
    expect(res.valid).toBe(true);
    const program = res.program!;

    for (const mode of ["reduced", "static"] as const) {
      const frame = sampleAnimation(program, 250, mode);
      expect(frame.timeMs).toBe(res.spec!.durationMs);
      expect(frame.actors).toHaveLength(2);
      const alice = frame.actors!.find((a) => a.id === "alice")!;
      const bob = frame.actors!.find((a) => a.id === "bob")!;
      // Alice exited in normal mode, so reduced/static keeps her at her onstage center-left spot!
      expect(alice.x).toBeCloseTo(280, 1);
      expect(alice.segments).toHaveLength(9);
      // Bob ended seated typing at desk on the right!
      expect(bob.action).toBe("type-at-desk");
      expect(frame.addons?.some((a) => a.actorId === "alice" && a.type === "card")).toBe(true);
      expect(frame.addons?.some((a) => a.actorId === "bob" && a.type === "desk")).toBe(true);
    }
  });

  it("preserves strict v1 contractVersion, schema, MarkerEvent shape, and VM-serialized sampler", () => {
    expect(animationSchema.$id).toContain("animation-v1.json");
    expect(animationSchemaV2.$id).toContain("animation-v2.json");

    const v1Compiled = compileAnimation({
      version: CONTRACT_VERSION,
      canvas: { width: 640, height: 360, fps: 30 },
      durationMs: 2000,
      actor: { x: 140, groundY: 290 },
      targets: { mark: { x: 420, y: 180 } },
      actions: [{ action: "point", startMs: 0, durationMs: 1400, target: "mark" }]
    });
    expect(v1Compiled.valid).toBe(true);
    const v1Prog = v1Compiled.program!;
    expect(v1Prog.contractVersion).toBe(CONTRACT_VERSION);
    for (const evt of v1Prog.events ?? []) {
      expect("actorId" in evt).toBe(false);
    }
    const v1Frame = sampleAnimation(v1Prog, 600);
    expect("actors" in v1Frame).toBe(false);
    expect("addons" in v1Frame).toBe(false);

    // Sign 6: VM serialization of sampleAnimation.toString() has zero outer-scope ReferenceErrors on v1
    const vmSampler = runInNewContext(`(${sampleAnimation.toString()})`) as typeof sampleAnimation;
    expect(vmSampler(v1Prog, 600)).toEqual(v1Frame);
  });

  it("supports zero-actor-boilerplate presentation stories, addon overrides, travel-prop originX, and Ajv schema validation", () => {
    const validator = new AjvJsonSchemaValidator().getValidator(animationSchemaV2 as Record<string, unknown>);

    // Pure actions-only story (no actor, no canvas, no durationMs, no startMs/durationMs)
    const minimal = choreographAnimation({
      actions: [
        { action: "walk-on", to: "left" },
        { action: "tap-element" },
        { action: "idea", addon: { color: "#10b981" } },
        { action: "walk-off" }
      ]
    });
    expect(minimal.valid).toBe(true);
    expect(validator({ version: CONTRACT_VERSION_V2, actions: [{ action: "idea@1.1.0" }] }).valid).toBe(true);
    expect(validator(minimal.spec!).valid).toBe(true);
    expect(sampleAnimation(minimal.program!, 0).x).toBeCloseTo(-48, 1);

    const ideaAct = minimal.spec!.actors[0]!.actions[2]!;
    const customBulb = sampleAnimation(
      minimal.program!,
      ideaAct.startMs + ideaAct.durationMs * 0.7
    ).addons?.find((a) => a.type === "bulb");
    expect(customBulb?.color).toBe("#10b981");

    // Scene addons: "none" with selective per-action addon activation & idle gap stage prop bridge
    const selective = choreographAnimation({
      addons: "none",
      actions: [
        { action: "idea" }, // suppressed by scene addons: "none"
        { action: "sit-down", addon: "auto" },
        { action: "type-at-desk", delayMs: 200, addon: "auto" },
        { action: "stand-up", addon: "auto" }
      ]
    });
    expect(selective.valid).toBe(true);
    const selActs = selective.spec!.actors[0]!.actions;
    expect(sampleAnimation(selective.program!, selActs[0]!.startMs + selActs[0]!.durationMs * 0.7).addons).toEqual([]);
    // During the 200ms idle gap between sit-down and type-at-desk, shared stage chair stays visible!
    const gapMid = selActs[1]!.startMs + selActs[1]!.durationMs + 100;
    const gapChair = sampleAnimation(selective.program!, gapMid).addons?.find((a) => a.id === "chair");
    expect(gapChair).toBeDefined();
    expect(gapChair!.opacity).toBe(1);

    // Sign 8: Planted stage prop originX across stairs-up, stairs-down, long-jump, and vault
    for (const [travelClip, propType] of [
      ["stairs-up", "stairs"],
      ["stairs-down", "stairs"],
      ["long-jump", "sand-pit"],
      ["vault", "box"]
    ] as const) {
      const tr = choreographAnimation({
        actor: { x: "left" },
        actions: [{ action: travelClip }]
      });
      expect(tr.valid, travelClip).toBe(true);
      const dur = tr.spec!.durationMs;
      const a = sampleAnimation(tr.program!, dur * 0.2).addons?.find((p) => p.type === propType)!;
      const b = sampleAnimation(tr.program!, dur * 0.75).addons?.find((p) => p.type === propType)!;
      expect(a, travelClip).toBeDefined();
      expect(b, travelClip).toBeDefined();
      expect(b.x, travelClip).toBe(a.x);
      expect(b.y, travelClip).toBe(a.y);
    }
  });

  it("keeps walk-turn smooth, grounded, facing-accurate, and strictly in-bounds in both v1 and v2", () => {
    // 1. v2 walk-turn across stage anchors & initial facings (no backward fling, 0 OOB, clean 180° flip)
    for (const [anchor, initFacing, sign] of [
      ["left", "right", 1],
      ["right", "left", -1],
      ["center", "right", 1]
    ] as const) {
      const res = choreographAnimation({
        actor: { x: anchor, facing: initFacing },
        actions: [
          { action: "walk-turn" },
          { action: "wave" }
        ]
      });
      expect(res.diagnostics, `v2 walk-turn ${anchor}`).toEqual([]);
      expect(res.valid).toBe(true);
      const prog = res.program!;
      const walkTurnAct = res.spec!.actors[0]!.actions[0]!;
      const dur = walkTurnAct.durationMs;

      // Round-trip v2 spec compilation preserves identical trajectory & facing
      const roundTrip = compileAnimation(res.spec!);
      expect(roundTrip.valid).toBe(true);
      expect(roundTrip.program).toEqual(prog);

      const sb = analyzeStoryboard(prog);
      expect(sb.outOfBoundsCount, `OOB ${anchor} (${initFacing})`).toBe(0);
      expect(sb.outOfBoundsFrames).toEqual([]);
      expect(sb.maxSeamStepPx).toBeLessThan(4);

      const fStart = sampleAnimation(prog, 0);
      const fApproach = sampleAnimation(prog, dur * 0.36);
      const fFront = sampleAnimation(prog, dur * 0.49);
      const fEnd = sampleAnimation(prog, dur - 1);
      const fWave = sampleAnimation(prog, walkTurnAct.startMs + dur + 300);

      // Walks forward in initial facing before pivoting, then returns in flipped facing
      expect((fApproach.x - fStart.x) * sign).toBeGreaterThan(50);
      expect((fEnd.x - fApproach.x) * sign).toBeLessThan(-35);
      expect(Math.sign(fStart.facing ?? 0)).toBe(sign);
      expect(Math.abs(fFront.facing ?? 1)).toBeLessThan(0.25);
      expect(Math.sign(fEnd.facing ?? 0)).toBe(-sign);
      expect(Math.sign(fWave.facing ?? 0)).toBe(-sign);

      // Verify frame-by-frame smooth root progression (no sudden jumps)
      let prev = fStart;
      for (let t = 33; t <= dur; t += 33) {
        const cur = sampleAnimation(prog, t);
        expect(Math.abs(cur.x - prev.x)).toBeLessThan(12);
        prev = cur;
      }
    }

    // 2. v1 walk-turn on standard 640x360 and 800x450 canvases
    for (const [width, height, groundY, startX, targetX] of [
      [640, 360, 290, 180, 220],
      [800, 450, 369, 220, 280]
    ] as const) {
      const v1Compiled = compileAnimation({
        version: CONTRACT_VERSION,
        canvas: { width, height, fps: 30 },
        durationMs: 4600,
        actor: { x: startX, groundY },
        targets: { dest: { x: targetX, y: groundY } },
        actions: [{ action: "walk-turn", startMs: 0, durationMs: 4267, target: "dest" }]
      });
      expect(v1Compiled.diagnostics, `v1 walk-turn ${width}x${height}`).toEqual([]);
      expect(v1Compiled.valid).toBe(true);
      const v1Prog = v1Compiled.program!;

      const v1Sb = analyzeStoryboard(v1Prog);
      expect(v1Sb.outOfBoundsCount, `v1 OOB ${width}x${height}`).toBe(0);

      const s0 = sampleAnimation(v1Prog, 0);
      const sTurn = sampleAnimation(v1Prog, 1500);
      const sEnd = sampleAnimation(v1Prog, 4267);
      const sAfter = sampleAnimation(v1Prog, 4500);
      expect(s0.x).toBeCloseTo(startX, 1);
      expect(sTurn.x).toBeGreaterThan(startX + 40);
      expect(sEnd.x).toBeCloseTo(targetX, 1);
      expect(s0.facing).toBeGreaterThan(0.9);
      expect(sEnd.facing).toBeLessThan(-0.9);
      // Idle after walk-turn preserves flipped leftward facing
      const afterTorso = sAfter.segments.find((s) => s.id === "torso")!;
      expect(afterTorso.x2).toBeLessThanOrEqual(afterTorso.x1 + 1);
    }
  });

  it("rejects malformed custom addon fields with path-specific diagnostics without throwing", () => {
    const malformed = {
      version: CONTRACT_VERSION_V2,
      actions: [
        {
          action: "present-card",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          addon: { type: "card", text: 12345 as any, keyframes: "bad" as any }
        }
      ]
    };

    const choreo = choreographAnimation(malformed);
    expect(choreo.valid).toBe(false);
    expect(choreo.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.actions[0].addon.text", code: "invalid_type" }),
        expect.objectContaining({ path: "$.actions[0].addon.keyframes", code: "invalid_type" })
      ])
    );
    expect(validateAnimation(malformed)).toEqual({ valid: false, diagnostics: choreo.diagnostics });

    const deepMalformed = choreographAnimation({
      actions: [
        {
          action: "basketball-shot",
          addon: [
            {
              type: "basketball",
              id: "" as unknown as string,
              color: 99 as unknown as string,
              secondaryColor: false as unknown as string,
              socket: "nose" as unknown as "rHand",
              layer: "middle" as unknown as "front",
              enter: "explode" as unknown as "pop",
              exit: "vanish" as unknown as "fade",
              persist: "yes" as unknown as boolean,
              x: Number.NaN,
              width: -10,
              scale: 0,
              attachWindow: { from: -0.2, until: 1.5, pinOnRelease: "yes" as unknown as boolean },
              flight: { from: 0.2, to: 1.4, target: 42 as unknown as string },
              impact: { at: 2, peakBulge: -1 },
              keyframes: [{ at: 1.5, opacity: 2 }, "not-an-object" as unknown as { at: number }],
              extraUnknown: true
            } as unknown as Record<string, unknown>
          ]
        }
      ]
    });
    expect(deepMalformed.valid).toBe(false);
    const paths = deepMalformed.diagnostics.map((d) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "$.actions[0].addon[0].extraUnknown",
        "$.actions[0].addon[0].id",
        "$.actions[0].addon[0].color",
        "$.actions[0].addon[0].secondaryColor",
        "$.actions[0].addon[0].socket",
        "$.actions[0].addon[0].layer",
        "$.actions[0].addon[0].enter",
        "$.actions[0].addon[0].exit",
        "$.actions[0].addon[0].persist",
        "$.actions[0].addon[0].x",
        "$.actions[0].addon[0].width",
        "$.actions[0].addon[0].scale",
        "$.actions[0].addon[0].attachWindow.from",
        "$.actions[0].addon[0].attachWindow.until",
        "$.actions[0].addon[0].attachWindow.pinOnRelease",
        "$.actions[0].addon[0].flight.to",
        "$.actions[0].addon[0].flight.target",
        "$.actions[0].addon[0].impact.at",
        "$.actions[0].addon[0].impact.peakBulge",
        "$.actions[0].addon[0].keyframes[0].at",
        "$.actions[0].addon[0].keyframes[0].opacity",
        "$.actions[0].addon[0].keyframes[1]"
      ])
    );
  });

  it("validates v1 blendMs in animationSchema and full AddonConfig fields (attachWindow, flight, impact, keyframes) in animationSchemaV2", () => {
    const v1Validator = new AjvJsonSchemaValidator().getValidator(animationSchema as Record<string, unknown>);
    const v2Validator = new AjvJsonSchemaValidator().getValidator(animationSchemaV2 as Record<string, unknown>);

    const v1WithBlend = {
      version: CONTRACT_VERSION,
      canvas: { width: 640, height: 360, fps: 30 },
      durationMs: 2200,
      actions: [
        { action: "wave", startMs: 0, durationMs: 900, blendMs: 0 },
        { action: "cheer", startMs: 900, durationMs: 1100, blendMs: 180 }
      ]
    };
    expect(v1Validator(v1WithBlend).valid).toBe(true);
    expect(validateAnimation(v1WithBlend)).toEqual({ valid: true, diagnostics: [] });
    expect(
      v1Validator({
        ...v1WithBlend,
        actions: [{ action: "wave", startMs: 0, durationMs: 900, blendMs: -5 }]
      }).valid
    ).toBe(false);

    const v2RichAddon = {
      version: CONTRACT_VERSION_V2,
      actor: { x: "left" },
      actions: [
        {
          action: "basketball-shot",
          addon: [
            {
              id: "custom-hoop",
              type: "hoop" as const,
              socket: "stage" as const,
              layer: "back" as const,
              x: 150,
              y: 150,
              width: 72,
              height: 64,
              impact: { at: 0.63, duration: 0.12, peakBulge: 1 },
              keyframes: [
                { at: 0, opacity: 1, scale: 1, netBulge: 0 },
                { at: 1, opacity: 1, scale: 1, netBulge: 0 }
              ]
            },
            {
              id: "custom-ball",
              type: "basketball" as const,
              socket: "rHand" as const,
              layer: "front" as const,
              attachWindow: {
                from: 0,
                until: 0.46,
                pinOnRelease: false,
                pinnedPoint: { x: 32, y: 180 }
              },
              flight: {
                from: 0.46,
                to: 0.63,
                target: "custom-hoop",
                apex: 44,
                spin: 720,
                releaseOffset: { x: 32, y: 184 },
                dropToGroundAt: 0.72
              }
            }
          ]
        }
      ]
    };

    expect(v2Validator(v2RichAddon).valid).toBe(true);
    const choreo = choreographAnimation(v2RichAddon);
    expect(choreo.diagnostics).toEqual([]);
    expect(choreo.valid).toBe(true);
    expect(v2Validator(choreo.spec!).valid).toBe(true);
    const midSvg = renderSvgFrame(choreo.program!, choreo.spec!.durationMs * 0.56);
    expect(midSvg).toContain('data-addon-id="custom-ball"');
    expect(midSvg).toContain('data-addon-id="custom-hoop"');

    // Schema also rejects malformed keyframes / flight in v2
    expect(
      v2Validator({
        version: CONTRACT_VERSION_V2,
        actions: [{ action: "present-card", addon: { type: "card", keyframes: "bad" } }]
      }).valid
    ).toBe(false);
  });
});
