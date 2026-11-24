import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION_V2,
  PROP_DEFINITIONS,
  analyzeStoryboard,
  animationSchemaV2,
  choreographAnimation,
  compileAnimation,
  defaultAddonsForAction,
  doorGeometry,
  renderAddonSvg,
  renderSvgFrame,
  sampleAnimation,
  validateAnimation,
  type CustomMotionDraftSpec,
  type PoseKey,
  type SampledAddon
} from "../src/index.js";

function makeStandPose(overrides: Partial<PoseKey> = {}): PoseKey {
  return {
    anchor: "both",
    lean: 2,
    neck: -1,
    bob: 0,
    rLeg: { hip: 5, knee: 13 },
    lLeg: { hip: -8, knee: 14 },
    rArm: { shoulder: -8, elbow: 45 },
    lArm: { shoulder: 8, elbow: 45 },
    ...overrides
  };
}

describe("v03-r2: bilateral prop mirroring, persistent elevation, stageProps, handoffs & customMotions", () => {
  it("orients hoop backboard on the far edge from the shooter for both right-facing and left-facing basketball-shot", () => {
    for (const facing of ["right", "left"] as const) {
      const anchor = facing === "right" ? "center-left" : "center-right";
      const choreo = choreographAnimation({
        actor: { x: anchor, facing },
        actions: [{ action: "basketball-shot" }]
      });
      expect(choreo.diagnostics, facing).toEqual([]);
      expect(choreo.valid, facing).toBe(true);
      const program = choreo.program!;
      const durationMs = choreo.spec!.durationMs;

      const swishFrame = sampleAnimation(program, durationMs * 0.629);
      const hoop = swishFrame.addons?.find((a) => a.type === "hoop")!;
      const ball = swishFrame.addons?.find((a) => a.type === "basketball")!;
      expect(hoop, facing).toBeDefined();
      expect(ball, facing).toBeDefined();

      const hoopSvg = renderAddonSvg(hoop);
      const backboardMatch = hoopSvg.match(/data-part="backboard"[^>]*x="([\d.-]+)"[^>]*width="([\d.-]+)"/);
      const rimMatch = hoopSvg.match(/data-part="hoop-rim"[^>]*d="M([\d.-]+) [\d.-]+L([\d.-]+) [\d.-]+"/);
      expect(backboardMatch, `${facing} backboard`).not.toBeNull();
      expect(rimMatch, `${facing} rim`).not.toBeNull();

      const rawBoardLeft = Number(backboardMatch![1]);
      const rawBoardRight = rawBoardLeft + Number(backboardMatch![2]);
      const rawRimMin = Math.min(Number(rimMatch![1]), Number(rimMatch![2]));
      const rawRimMax = Math.max(Number(rimMatch![1]), Number(rimMatch![2]));
      const hoopCx = hoop.x + hoop.width / 2;

      // Apply flip-x transform when mirrored to obtain true visual X extents
      const visualBoardLeft = hoop.flipX ? 2 * hoopCx - rawBoardRight : rawBoardLeft;
      const visualBoardRight = hoop.flipX ? 2 * hoopCx - rawBoardLeft : rawBoardRight;
      const visualRimCenter = hoop.flipX
        ? 2 * hoopCx - (rawRimMin + rawRimMax) / 2
        : (rawRimMin + rawRimMax) / 2;

      const ballCenterX = ball.x + ball.width / 2;
      expect(ballCenterX, `${facing} ball lands in rim mouth`).toBeCloseTo(visualRimCenter, 1);

      if (facing === "right") {
        expect(hoop.flipX).toBeUndefined();
        // Shooter is on left: rim faces left toward shooter, backboard sits on far right
        expect(visualRimCenter).toBeLessThan(visualBoardLeft);
        expect(ballCenterX).toBeLessThan(visualBoardLeft);
        // Verify flight never crosses through backboard
        for (const p of [0.47, 0.52, 0.57, 0.629]) {
          const b = sampleAnimation(program, durationMs * p).addons?.find((a) => a.type === "basketball")!;
          expect(b.x + b.width / 2, `right flight@${p}`).toBeLessThan(visualBoardLeft);
        }
      } else {
        expect(hoop.flipX).toBe(true);
        expect(hoopSvg).toContain('data-part="flip-x"');
        expect(hoopSvg).toContain("scale(-1 1)");
        // Shooter is on right: rim faces right toward shooter, backboard sits on far left
        expect(visualRimCenter).toBeGreaterThan(visualBoardRight);
        expect(ballCenterX).toBeGreaterThan(visualBoardRight);
        for (const p of [0.47, 0.52, 0.57, 0.629]) {
          const b = sampleAnimation(program, durationMs * p).addons?.find((a) => a.type === "basketball")!;
          expect(b.x + b.width / 2, `left flight@${p}`).toBeGreaterThan(visualBoardRight);
        }
      }
    }
  });

  it("bilaterally mirrors asymmetric props for facing: left (chair, desk, laptop, door, goal, stairs) while keeping text labels unflipped", () => {
    // 1. Chair & Desk when facing left
    const deskRes = choreographAnimation({
      actor: { x: "center", facing: "left" },
      actions: [{ action: "type-at-desk" }]
    });
    expect(deskRes.valid).toBe(true);
    const deskFrame = sampleAnimation(deskRes.program!, deskRes.spec!.durationMs * 0.5);
    const torso = deskFrame.segments.find((s) => s.id === "torso")!;
    const pelvisX = torso.x1;
    const chair = deskFrame.addons!.find((a) => a.type === "chair")!;
    const desk = deskFrame.addons!.find((a) => a.type === "desk")!;
    expect(chair.flipX).toBe(true);
    expect(desk.flipX).toBe(true);
    const chairSvg = renderAddonSvg(chair);
    expect(chairSvg).toContain('data-part="flip-x"');
    // Unmirrored chair backrest is at x + 0.2w -> mirrored around cx = x + 0.5w places backrest at x + 0.8w > pelvisX (behind left-facing actor!)
    const mirroredBackrestX = chair.x + chair.width * 0.8;
    expect(mirroredBackrestX).toBeGreaterThan(pelvisX);

    // Desk monitor mirrors to far-left edge while keyboard sits near actor on right
    const deskSvg = renderAddonSvg(desk);
    expect(deskSvg).toContain('data-part="flip-x"');
    const deskCx = desk.x + desk.width / 2;
    const monMatch = deskSvg.match(/data-part="desk-monitor"[^>]*x="([\d.-]+)"[^>]*width="([\d.-]+)"/)!;
    const monCenterVisual = 2 * deskCx - (Number(monMatch[1]) + Number(monMatch[2]) / 2);
    expect(monCenterVisual).toBeLessThan(deskCx);

    // 2. Laptop when facing left: lid sits on far-left edge facing right, keyboard sits on right under hands
    const laptopRes = choreographAnimation({
      actor: { x: "center", facing: "left" },
      actions: [{ action: "open-laptop" }]
    });
    expect(laptopRes.valid).toBe(true);
    const laptop = sampleAnimation(laptopRes.program!, laptopRes.spec!.durationMs * 0.75).addons!.find(
      (a) => a.type === "laptop"
    )!;
    expect(laptop.flipX).toBe(true);
    const laptopSvg = renderAddonSvg(laptop);
    expect(laptopSvg).toContain('data-part="flip-x"');
    const hingeMatch = laptopSvg.match(/data-part="laptop-hinge"[^>]*cx="([\d.-]+)"/)!;
    const laptopCx = laptop.x + laptop.width / 2;
    const visualHingeX = 2 * laptopCx - Number(hingeMatch[1]);
    expect(visualHingeX).toBeLessThan(laptopCx);

    // 3. Door when facing left: hinge flips to "left" (handle on right/actor side) + light slate doorway contrast
    const doorRes = choreographAnimation({
      actor: { x: "center", facing: "left" },
      actions: [{ action: "open-door" }]
    });
    expect(doorRes.valid).toBe(true);
    const doorMid = sampleAnimation(doorRes.program!, doorRes.spec!.durationMs * 0.55);
    const doorBack = doorMid.addons!.find((a) => a.type === "door" && a.layer === "back")!;
    expect(doorBack.hinge).toBe("left");
    expect(doorBack.flipX).toBe(true);
    // Actor's head stays cleanly outside the doorway post (no frame overlap) when facing left
    const doorRightPost = doorBack.x + doorBack.width;
    expect(doorMid.head.x - 16.5 * (doorMid.actors?.[0]?.scale ?? 1)).toBeGreaterThanOrEqual(doorRightPost - 1);
    const geom = doorGeometry(doorBack);
    expect(geom.hingeLeft).toBe(true);
    const doorSvg = renderAddonSvg(doorBack);
    expect(doorSvg).not.toContain('data-part="flip-x"'); // Door flips cleanly via hinge without double-flipping
    expect(doorSvg).toContain('data-part="door-opening"');
    expect(doorSvg).toContain('fill="#cbd5e1"');
    expect(doorSvg).toContain('opacity="0.65"');
    expect(doorSvg).not.toContain("#4a4f57");

    // 3b. Left-facing write-board keeps "AI" ink unmirrored left-to-right (no scale(-1 1))
    const boardLeftRes = choreographAnimation({
      actor: { x: "center", facing: "left" },
      actions: [{ action: "write-board" }]
    });
    expect(boardLeftRes.valid).toBe(true);
    const boardLeft = sampleAnimation(boardLeftRes.program!, boardLeftRes.spec!.durationMs * 0.7).addons!.find(
      (a) => a.type === "board"
    )!;
    expect(boardLeft.flipX).toBeUndefined();
    const boardLeftSvg = renderAddonSvg(boardLeft);
    expect(boardLeftSvg).toContain('data-part="board-ink"');
    expect(boardLeftSvg).not.toContain('data-part="flip-x"');
    expect(boardLeftSvg).not.toContain("scale(-1 1)");

    // Explicit hinge override is respected even when facing left
    const doorOverrideRes = choreographAnimation({
      actor: { x: "center", facing: "left" },
      actions: [{ action: "open-door", addon: [{ id: "door", type: "door", hinge: "right" }] }]
    });
    const doorOverridden = sampleAnimation(doorOverrideRes.program!, doorOverrideRes.spec!.durationMs * 0.6).addons!.find(
      (a) => a.id === "door"
    )!;
    expect(doorOverridden.hinge).toBe("right");

    // 4. Goal when facing left + kick-ball at anchor: "right" stays strictly in bounds (0 OOB)
    const kickRes = choreographAnimation({
      actor: { x: "right", facing: "left" },
      actions: [{ action: "kick-ball" }]
    });
    expect(kickRes.valid).toBe(true);
    const kickSb = analyzeStoryboard(kickRes.program!);
    expect(kickSb.outOfBoundsCount).toBe(0);
    const goal = sampleAnimation(kickRes.program!, kickRes.spec!.durationMs * 0.5).addons!.find(
      (a) => a.type === "goal"
    )!;
    expect(goal.flipX).toBe(true);
    expect(renderAddonSvg(goal)).toContain('data-part="flip-x"');

    // 5. Stairs when facing left
    const stairsLeftRes = choreographAnimation({
      actor: { x: "right", facing: "left" },
      actions: [{ action: "stairs-up" }]
    });
    expect(stairsLeftRes.valid).toBe(true);
    const stairsLeft = sampleAnimation(stairsLeftRes.program!, stairsLeftRes.spec!.durationMs * 0.5).addons!.find(
      (a) => a.type === "stairs"
    )!;
    expect(stairsLeft.flipX).toBe(true);
    expect(renderAddonSvg(stairsLeft)).toContain('data-part="flip-x"');

    // 6. Text labels on flipped props (board, card, sign, banner) stay OUTSIDE scale(-1 1)
    for (const type of ["board", "card", "sign", "banner"] as const) {
      const def = PROP_DEFINITIONS[type];
      const flippedLabeled: SampledAddon = {
        id: `labeled-${type}`,
        type,
        layer: "front",
        x: 200,
        y: 120,
        width: def.defaultSize.w,
        height: def.defaultSize.h,
        rotation: 0,
        scale: 1,
        opacity: 1,
        color: def.defaultColor,
        flipX: true,
        ...(type === "board" ? { ink: 0.9 } : {}),
        text: "HELLO"
      };
      const svg = renderAddonSvg(flippedLabeled);
      expect(svg, `${type} flip-x wrapper`).toContain('data-part="flip-x"');
      expect(svg, `${type} text present`).toContain(">HELLO</text>");
      const flipCloseIdx = svg.indexOf("</g>");
      const textIdx = svg.indexOf("<text ");
      expect(textIdx, `${type} <text> must sit outside flip-x group`).toBeGreaterThan(flipCloseIdx);
      if (type === "board") {
        const inkIdx = svg.indexOf('data-part="board-ink"');
        expect(inkIdx, "board ink must sit outside flip-x group even when manually flipped").toBeGreaterThan(flipCloseIdx);
      }
    }

    // 7. video-call default props fade in smoothly (not instant pop-in)
    const vcDefaults = defaultAddonsForAction("video-call");
    expect(vcDefaults.length).toBe(3);
    for (const cfg of vcDefaults) {
      expect(cfg.enter).toBe("fade");
      expect(cfg.enterDuration).toBeGreaterThan(0);
    }
  });

  it("preserves elevated footY across stairs-up -> cheer -> stairs-down with stationary staircase world X, plus explicit stageProps", () => {
    const res = choreographAnimation({
      actor: { x: "left" },
      actions: [
        { action: "stairs-up" },
        { action: "cheer" },
        { action: "stairs-down" }
      ]
    });
    expect(res.diagnostics).toEqual([]);
    expect(res.valid).toBe(true);
    const program = res.program!;
    const acts = res.spec!.actors[0]!.actions;
    const upAct = acts[0]!;
    const cheerAct = acts[1]!;
    const downAct = acts[2]!;
    const groundY = res.spec!.groundY!;

    // Measure stairs X during stairs-up, cheer, and stairs-down
    const fUpMid = sampleAnimation(program, upAct.startMs + upAct.durationMs * 0.5);
    const fUpEnd = sampleAnimation(program, upAct.startMs + upAct.durationMs - 1);
    const fCheerStart = sampleAnimation(program, cheerAct.startMs + 20);
    const fCheerEnd = sampleAnimation(program, cheerAct.startMs + cheerAct.durationMs - 10);
    const fDownStart = sampleAnimation(program, downAct.startMs + 20);
    const fDownMid = sampleAnimation(program, downAct.startMs + downAct.durationMs * 0.5);
    const fDownEnd = sampleAnimation(program, downAct.startMs + downAct.durationMs - 1);

    const stairsUp = fUpMid.addons?.find((a) => a.type === "stairs")!;
    const stairsCheer = fCheerStart.addons?.find((a) => a.type === "stairs")!;
    const stairsDown = fDownMid.addons?.find((a) => a.type === "stairs")!;

    expect(stairsUp).toBeDefined();
    expect(stairsCheer).toBeDefined();
    expect(stairsDown).toBeDefined();
    // Same-direction stairs-up -> cheer -> stairs-down renders a symmetric double-sided step platform
    expect(stairsUp.doubleSided).toBe(true);
    expect(stairsCheer.doubleSided).toBe(true);
    expect(stairsDown.doubleSided).toBe(true);
    expect(renderAddonSvg(stairsDown)).toContain('data-part="stairs-platform"');
    // Staircase world X and width stay 100% stationary (zero jump!)
    expect(stairsCheer.x).toBe(stairsUp.x);
    expect(stairsDown.x).toBe(stairsUp.x);
    expect(stairsCheer.y).toBe(stairsUp.y);
    expect(stairsDown.y).toBe(stairsUp.y);
    expect(stairsDown.width).toBe(stairsUp.width);
    // Descending feet during stairs-down mid-descent rest on real descending treads within platform X bounds
    const downMidLeftFootX = fDownMid.segments.find((s) => s.id === "left-shin")!.x2;
    const downMidRightFootX = fDownMid.segments.find((s) => s.id === "right-shin")!.x2;
    expect(Math.min(downMidLeftFootX, downMidRightFootX)).toBeGreaterThanOrEqual(stairsDown.x);
    expect(Math.max(downMidLeftFootX, downMidRightFootX)).toBeLessThanOrEqual(stairsDown.x + stairsDown.width);

    // Climber's feet stay elevated on top of the stairs (~groundY - 54) throughout cheer (0px drop through stairs!)
    const lowestFootY = (frame: ReturnType<typeof sampleAnimation>) => {
      const l = frame.segments.find((s) => s.id === "left-shin")!.y2;
      const r = frame.segments.find((s) => s.id === "right-shin")!.y2;
      return Math.max(l, r);
    };
    const topTreadY = groundY - 54;
    expect(lowestFootY(fUpEnd)).toBeCloseTo(topTreadY, 1);
    expect(lowestFootY(fCheerStart)).toBeLessThanOrEqual(topTreadY + 1);
    expect(lowestFootY(fCheerEnd)).toBeLessThanOrEqual(topTreadY + 1);
    // Throughout cheer, feet NEVER drop below top tread
    for (let frac = 0; frac <= 1; frac += 0.1) {
      const cf = sampleAnimation(program, cheerAct.startMs + cheerAct.durationMs * frac);
      expect(lowestFootY(cf), `cheer@${frac}`).toBeLessThanOrEqual(topTreadY + 1.5);
      // World ground line stays anchored at scene groundY
      expect(cf.groundY).toBe(groundY);
    }

    // stairs-down starts elevated at top tread and lands cleanly back on groundY
    expect(Math.abs(lowestFootY(fDownStart) - topTreadY)).toBeLessThan(0.5);
    expect(lowestFootY(fDownEnd)).toBeCloseTo(groundY, 1);

    // Explicit top-level stageProps persist across entire scene and suppress duplicate per-action auto-props
    const stagePropRes = choreographAnimation({
      stageProps: [
        { id: "fixed-stairs", type: "stairs", x: 194, facing: "right" }
      ],
      actor: { x: "left" },
      actions: [
        { action: "stairs-up" },
        { action: "cheer" },
        { action: "stairs-down" }
      ]
    });
    expect(stagePropRes.diagnostics).toEqual([]);
    expect(stagePropRes.valid).toBe(true);
    const spValidator = new AjvJsonSchemaValidator().getValidator(animationSchemaV2 as Record<string, unknown>);
    expect(spValidator(stagePropRes.spec!).valid).toBe(true);
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const frame = sampleAnimation(stagePropRes.program!, stagePropRes.spec!.durationMs * frac);
      const allStairs = (frame.addons ?? []).filter((a) => a.type === "stairs");
      expect(allStairs, `stageProps@${frac}`).toHaveLength(1);
      expect(allStairs[0]!.id).toBe("fixed-stairs");
      expect(allStairs[0]!.x).toBe(194);
    }
  });

  it("transfers one single shared card smoothly across sender hand-over -> receiver catch -> present-card with zero ball morphs", () => {
    const res = choreographAnimation({
      actors: [
        {
          id: "sender",
          x: "center-left",
          actions: [
            {
              action: "hand-over",
              emitCue: "cardPassed",
              handoffTo: { actorId: "receiver", propType: "card", propId: "shared-deck-card" },
              addon: { type: "card", text: "OK", color: "#2563eb" }
            }
          ]
        },
        {
          id: "receiver",
          x: "center-right",
          actions: [
            { action: "catch", afterCue: "cardPassed" },
            { action: "present-card" }
          ]
        }
      ]
    });
    expect(res.diagnostics).toEqual([]);
    expect(res.valid).toBe(true);
    const program = res.program!;
    const durationMs = res.spec!.durationMs;

    const validator = new AjvJsonSchemaValidator().getValidator(animationSchemaV2 as Record<string, unknown>);
    expect(validator(res.spec!).valid).toBe(true);

    let sawSenderHold = false;
    let sawReceiverHold = false;
    let prevCardX: number | undefined;
    let maxCardStep = 0;

    for (let t = 0; t <= durationMs; t += 40) {
      const frame = sampleAnimation(program, t);
      const addons = frame.addons ?? [];
      // Receiver must stay facing left (-1) toward sender throughout catch!
      const receiverFrame = frame.actors?.find((a) => a.id === "receiver")!;
      if (receiverFrame.action === "catch") {
        expect(receiverFrame.facing, `receiver facing during catch@${t}`).toBeLessThan(-0.5);
      }
      // Catch must NEVER spawn a phantom ball while receiving a handed-off card!
      expect(addons.filter((a) => a.type === "ball"), `t=${t}`).toEqual([]);
      const cards = addons.filter((a) => a.type === "card");
      expect(cards.length, `t=${t} at most 1 shared card`).toBeLessThanOrEqual(1);
      if (cards.length === 1) {
        const card = cards[0]!;
        expect(card.id).toBe("shared-deck-card");
        expect(card.text).toBe("OK");
        expect(card.color).toBe("#2563eb");
        if (card.actorId === "sender") sawSenderHold = true;
        if (card.actorId === "receiver") {
          sawReceiverHold = true;
          // Card held by receiver must stay clear of receiver's head/glasses
          const hr = 16.5 * receiverFrame.scale;
          const overlapsHead =
            card.x < receiverFrame.head.x + hr &&
            card.x + card.width > receiverFrame.head.x - hr &&
            card.y < receiverFrame.head.y + hr &&
            card.y + card.height > receiverFrame.head.y - hr;
          expect(overlapsHead, `card@${t} must not clip receiver head`).toBe(false);
        }
        if (prevCardX !== undefined) {
          maxCardStep = Math.max(maxCardStep, Math.abs(card.x - prevCardX));
        }
        prevCardX = card.x;
      }
    }

    expect(sawSenderHold).toBe(true);
    expect(sawReceiverHold).toBe(true);
    expect(maxCardStep).toBeLessThan(35);
  });

  it("compiles, validates, and renders inline customMotions (coffee-sip with coffee-mug prop) with zero unsupported_action errors", () => {
    const coffeeSipDraft: CustomMotionDraftSpec = {
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
        { frame: 0, pose: makeStandPose({ rArm: { shoulder: 18, elbow: 55 } }), ease: "inOut" },
        { frame: 22, pose: makeStandPose({ lean: -3, neck: -8, rArm: { shoulder: 42, elbow: 112 } }), ease: "inOut" },
        { frame: 44, pose: makeStandPose({ rArm: { shoulder: 18, elbow: 55 } }) }
      ]
    };

    const input = {
      version: CONTRACT_VERSION_V2,
      customMotions: {
        "coffee-sip": coffeeSipDraft
      },
      actor: { x: "center", facing: "right" as const },
      actions: [{ action: "coffee-sip" }]
    };

    const validator = new AjvJsonSchemaValidator().getValidator(animationSchemaV2 as Record<string, unknown>);
    expect(validator(input).valid).toBe(true);

    const val = validateAnimation(input);
    expect(val.diagnostics).toEqual([]);
    expect(val.valid).toBe(true);

    const choreo = choreographAnimation(input);
    expect(choreo.diagnostics).toEqual([]);
    expect(choreo.valid).toBe(true);

    const compiled = compileAnimation(choreo.spec!);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.valid).toBe(true);
    expect(compiled.program!.events?.some((e) => e.action === "coffee-sip" && e.marker === "sip")).toBe(true);

    const midTime = choreo.spec!.durationMs * 0.5;
    for (const sampleT of [0, midTime, choreo.spec!.durationMs]) {
      const sampleF = sampleAnimation(compiled.program!, sampleT);
      const sampleMug = sampleF.addons?.find((a) => a.type === "coffee-mug");
      expect(sampleMug, `coffee-mug visible@${sampleT}`).toBeDefined();
      expect(sampleMug!.opacity, `coffee-mug opacity@${sampleT}`).toBeGreaterThan(0.95);
    }
    const frame = sampleAnimation(compiled.program!, midTime);
    expect(frame.action).toBe("coffee-sip");
    const mug = frame.addons?.find((a) => a.type === "coffee-mug");
    expect(mug).toBeDefined();

    const svg = renderSvgFrame(compiled.program!, midTime);
    expect(svg).toContain('data-addon="coffee-mug"');
    expect(svg).toContain('data-part="mug-body"');
    expect(svg).toContain('data-part="mug-handle"');
    expect(svg).toContain('data-part="mug-steam"');
    expect(svg).not.toMatch(/<script\b/i);

    // Also verify mug alias and left-facing mirroring on coffee-mug
    const leftCoffee = choreographAnimation({
      customMotions: { "coffee-sip": { ...coffeeSipDraft, prop: "mug" } },
      actor: { x: "center", facing: "left" },
      actions: [{ action: "coffee-sip" }]
    });
    expect(leftCoffee.valid).toBe(true);
    const leftSvg = renderSvgFrame(leftCoffee.program!, leftCoffee.spec!.durationMs * 0.5);
    expect(leftSvg).toContain('data-addon="mug"');
    expect(leftSvg).toContain('data-part="flip-x"');
  });
});
