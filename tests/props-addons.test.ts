import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { actionCatalog, describeAction } from "../src/catalog.js";
import { choreographAnimation } from "../src/choreograph.js";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";
import { CONTRACT_VERSION, type AddonType, type SampledAddon, type SampledFrame } from "../src/contract.js";
import { RUNTIME_MOTION_LIBRARY } from "../src/motion-library.js";
import { frameGeometry } from "../src/render.js";
import {
  ADDON_TYPES,
  AUTO_MAPPED_ACTIONS,
  PROP_CATALOG_VERSION,
  PROP_DEFINITIONS,
  addonLifecycleState,
  computeAddonFlightPoint,
  defaultAddonsForAction,
  doorGeometry,
  escapeXml,
  renderAddonSvg,
  renderAddonsLayerSvg,
  sampleActionAddons
} from "../src/props.js";

function assertWellFormedXmlFragment(svg: string, context: string): void {
  expect(svg.length, `${context}: empty SVG`).toBeGreaterThan(0);
  expect(svg, `${context}: script tag forbidden`).not.toMatch(/<script\b/i);
  expect(svg, `${context}: NaN/Infinity/undefined forbidden`).not.toMatch(/\b(NaN|Infinity|undefined)\b/);
  expect(svg, `${context}: negative zero forbidden`).not.toMatch(/(?<![0-9.])-(0(?:\.0+)?)(?![0-9.])/);

  const stack: string[] = [];
  const tagRegex = /<\/?([A-Za-z][A-Za-z0-9:-]*)(\s[^<>]*?)?(\/?)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(svg)) !== null) {
    const between = svg.slice(lastIndex, match.index);
    expect(between, `${context}: unescaped angle bracket in text`).not.toMatch(/[<>]/);
    lastIndex = tagRegex.lastIndex;

    const full = match[0];
    const tagName = match[1]!;
    const selfClosing = match[3] === "/";
    const closing = full.startsWith("</");

    if (closing) {
      expect(stack.length, `${context}: unexpected closing </${tagName}>`).toBeGreaterThan(0);
      expect(stack.pop(), `${context}: mismatched closing tag`).toBe(tagName);
    } else if (!selfClosing) {
      stack.push(tagName);
    }
  }
  expect(svg.slice(lastIndex), `${context}: trailing unescaped angle bracket`).not.toMatch(/[<>]/);
  expect(stack, `${context}: unclosed tags`).toEqual([]);
}

function compileSingleAction(
  action: string,
  durationMs = 2400,
  extra: { target?: { x: number; y: number }; actorX?: number; groundY?: number } = {}
) {
  const actorX = extra.actorX ?? 260;
  const groundY = extra.groundY ?? 360;
  const desc = describeAction(action);
  const autoTarget =
    extra.target ??
    (desc?.requiredBinding === "named target"
      ? desc.travel === "travel"
        ? { x: actorX + 260, y: groundY }
        : { x: actorX + 260, y: groundY - 140 }
      : undefined);
  const result = compileAnimation({
    version: CONTRACT_VERSION,
    canvas: { width: 960, height: 480, fps: 30 },
    durationMs,
    actor: { x: actorX, groundY },
    ...(autoTarget ? { targets: { dest: autoTarget } } : {}),
    actions: [
      {
        action,
        startMs: 0,
        durationMs,
        ...(autoTarget ? { target: "dest" } : {})
      }
    ]
  });
  expect(result.diagnostics, action).toEqual([]);
  return result.program!;
}

describe("R3 runtime props & add-ons lifecycle engine", () => {
  it("keeps PROP_DEFINITIONS 100% in sync with motions/props-catalog.json and stays zero-FS browser-safe", async () => {
    const catalogRaw = JSON.parse(
      await readFile(resolve(process.cwd(), "motions", "props-catalog.json"), "utf8")
    ) as {
      version: number;
      props: Array<{
        type: AddonType;
        label: string;
        category: string;
        defaultSize: { w: number; h: number; r?: number; rungs?: number; steps?: number };
        defaultColor: string;
        socket: string;
      }>;
    };

    expect(PROP_CATALOG_VERSION).toBe(catalogRaw.version);
    expect(ADDON_TYPES).toEqual(catalogRaw.props.map((item) => item.type));
    expect(ADDON_TYPES).toHaveLength(53);

    for (const entry of catalogRaw.props) {
      expect(PROP_DEFINITIONS[entry.type], entry.type).toEqual(entry);
    }

    const propsSource = await readFile(resolve(process.cwd(), "src", "props.ts"), "utf8");
    expect(propsSource).not.toMatch(/node:fs|readFile|readFileSync|process\.cwd/);
  });

  it("maps prop-bearing runtime actions cleanly via defaultAddonsForAction and returns defensive clones", () => {
    const expectedActionTypes: Array<[string, AddonType[]]> = [
      ["idea", ["bulb"]],
      ["present-card", ["card"]],
      ["reveal", ["card"]],
      ["write-board", ["board"]],
      ["open-door", ["door", "door"]],
      ["type-at-desk", ["chair", "desk"]],
      ["sit-down", ["chair"]],
      ["stand-up", ["chair"]],
      ["basketball-shot", ["hoop", "basketball"]],
      ["kick-ball", ["goal", "football"]],
      ["throw-ball", ["ball"]],
      ["throw", ["ball"]],
      ["hurdle", ["hurdle"]],
      ["phone-call", ["phone"]],
      ["hold-sign", ["sign"]],
      ["pull-banner", ["banner"]],
      ["pull-banner-top", ["banner"]],
      ["pull-banner-bottom", ["banner"]],
      ["pull-banner-left", ["banner"]],
      ["pull-banner-right", ["banner"]],
      ["punch", ["gloves", "gloves"]],
      ["check-watch", ["watch"]],
      ["look-around", ["binoculars"]],
      ["climb-ladder", ["ladder"]],
      ["step-up", ["stairs"]],
      ["stairs-up", ["stairs"]],
      ["stairs-down", ["stairs"]]
    ];

    for (const [action, types] of expectedActionTypes) {
      const configs = defaultAddonsForAction(action);
      expect(configs.map((c) => c.type), action).toEqual(types);
    }

    expect(AUTO_MAPPED_ACTIONS.length).toBeGreaterThanOrEqual(expectedActionTypes.length);
    expect(defaultAddonsForAction("walk")).toEqual([]);
    expect(defaultAddonsForAction("idle")).toEqual([]);
    expect(defaultAddonsForAction("push")).toEqual([]);

    const first = defaultAddonsForAction("idea");
    first[0]!.color = "#000000";
    expect(defaultAddonsForAction("idea")[0]!.color).toBe("#f59e0b");
  });

  it("computes appear & exit lifecycles (pop overshoot + puff, fade, slide, shrink, tip, persist)", () => {
    const popCfg = { enter: "pop" as const, enterAt: 0.2, enterDuration: 0.2, exit: "shrink" as const, exitAt: 0.8, exitDuration: 0.1 };
    expect(addonLifecycleState(popCfg, 0.15).visible).toBe(false);
    const popMid = addonLifecycleState(popCfg, 0.3);
    expect(popMid.visible).toBe(true);
    expect(popMid.scale).toBeCloseTo(1.12, 3);
    expect(popMid.puff).toBe(true);
    const popDone = addonLifecycleState(popCfg, 0.5);
    expect(popDone.scale).toBe(1);
    expect(popDone.puff).toBe(false);
    const shrinkMid = addonLifecycleState(popCfg, 0.85);
    expect(shrinkMid.scale).toBeCloseTo(0.5, 3);
    expect(addonLifecycleState(popCfg, 0.91).visible).toBe(false);

    const fadeCfg = { enter: "fade" as const, enterAt: 0.1, enterDuration: 0.2, exit: "fade" as const, exitAt: 0.7, exitDuration: 0.2 };
    expect(addonLifecycleState(fadeCfg, 0.2).opacity).toBeCloseTo(0.5, 3);
    expect(addonLifecycleState(fadeCfg, 0.5).opacity).toBe(1);
    expect(addonLifecycleState(fadeCfg, 0.8).opacity).toBeCloseTo(0.5, 3);

    const slideLeft = addonLifecycleState({ enter: "slide", enterAt: 0, enterDuration: 0.4, slideFrom: "left" }, 0.2, { slideDistanceX: 200 });
    expect(slideLeft.dx).toBeCloseTo(-100, 3);
    expect(slideLeft.opacity).toBe(1);
    const slideRight = addonLifecycleState({ enter: "slide", enterAt: 0, enterDuration: 0.4, slideFrom: "right" }, 0.2, { slideDistanceX: 200 });
    expect(slideRight.dx).toBeCloseTo(100, 3);
    const slideTop = addonLifecycleState({ enter: "slide", enterAt: 0, enterDuration: 0.4, slideFrom: "top" }, 0.2, { slideDistanceY: 160 });
    expect(slideTop.dy).toBeCloseTo(-80, 3);
    expect(addonLifecycleState({ enter: "slide", enterAt: 0, enterDuration: 0.4, slideFrom: "left" }, 0.5, { slideDistanceX: 200 }).dx).toBe(0);

    const tipMid = addonLifecycleState({ exit: "tip", exitAt: 0.6, exitDuration: 0.2 }, 0.7);
    expect(tipMid.tip).toBe(true);
    expect(tipMid.rotation).toBeCloseTo(7.5, 3);
    expect(tipMid.opacity).toBeCloseTo(0.5, 3);

    const persisted = addonLifecycleState({ exit: "fade", exitAt: 0.5, exitDuration: 0.2, persist: true }, 0.95);
    expect(persisted.visible).toBe(true);
    expect(persisted.opacity).toBe(1);
  });

  it("tracks body sockets accurately as hands, head, eyes, wrist, and feet move", () => {
    // 1. Idea bulb above head: hidden early, pops in at aha beat, moves when head moves
    const ideaProgram = compileSingleAction("idea", 2100);
    const earlyPose = sampleAnimation(ideaProgram, 300);
    expect(sampleActionAddons({ action: "idea", progress: 300 / 2100, pose: earlyPose })).toEqual([]);

    const ahaPose = sampleAnimation(ideaProgram, 1300);
    const ahaAddons = sampleActionAddons({ action: "idea", progress: 1300 / 2100, pose: ahaPose });
    expect(ahaAddons).toHaveLength(1);
    const bulb = ahaAddons[0]!;
    expect(bulb.type).toBe("bulb");
    expect(bulb.color).toBe("#f59e0b");
    expect(bulb.puff).toBe(true);
    expect(bulb.scale).toBeGreaterThan(1);
    expect(bulb.y + bulb.height).toBeLessThan(ahaPose.head.y);

    // Shifting the actor's head and torso shifts the attached aboveHead bulb by the exact same delta
    const shiftedPose: SampledFrame = {
      ...ahaPose,
      x: ahaPose.x + 45,
      head: { x: ahaPose.head.x + 45, y: ahaPose.head.y - 25 },
      segments: ahaPose.segments.map((s) => ({
        ...s,
        x1: s.x1 + 45,
        x2: s.x2 + 45,
        y1: s.y1 - 25,
        y2: s.y2 - 25
      }))
    };
    const shiftedBulb = sampleActionAddons({ action: "idea", progress: 1300 / 2100, pose: shiftedPose })[0]!;
    expect(shiftedBulb.x - bulb.x).toBeCloseTo(45, 2);
    expect(shiftedBulb.y - bulb.y).toBeCloseTo(-25, 2);

    // 2. Present-card: tracks rHand during draw -> show, then pins in place after release
    const cardProgram = compileSingleAction("present-card", 2200);
    const poseAt = (p: number) => sampleAnimation(cardProgram, p * 2200);
    const cardDraw = sampleActionAddons({ action: "present-card", progress: 0.3, pose: poseAt(0.3), poseAtProgress: poseAt })[0]!;
    const cardShow = sampleActionAddons({ action: "present-card", progress: 0.48, pose: poseAt(0.48), poseAtProgress: poseAt })[0]!;
    expect(Math.hypot(cardShow.x - cardDraw.x, cardShow.y - cardDraw.y)).toBeGreaterThan(10);

    const cardPinned1 = sampleActionAddons({ action: "present-card", progress: 0.55, pose: poseAt(0.55), poseAtProgress: poseAt })[0]!;
    const cardPinned2 = sampleActionAddons({ action: "present-card", progress: 0.8, pose: poseAt(0.8), poseAtProgress: poseAt })[0]!;
    expect(cardPinned2.x).toBeCloseTo(cardPinned1.x, 3);
    expect(cardPinned2.y).toBeCloseTo(cardPinned1.y, 3);

    // 3. Punch: right and left gloves move independently with jab and cross
    const punchProgram = compileSingleAction("punch", 2000);
    const jabFrame = sampleAnimation(punchProgram, 800); // ~0.4 (jab peak)
    const crossFrame = sampleAnimation(punchProgram, 1300); // ~0.65 (cross peak)
    const jabGloves = sampleActionAddons({ action: "punch", progress: 0.4, pose: jabFrame });
    const crossGloves = sampleActionAddons({ action: "punch", progress: 0.65, pose: crossFrame });
    expect(jabGloves).toHaveLength(2);
    expect(jabGloves.find((g) => g.id === "gloves-r")!.x).toBeGreaterThan(crossGloves.find((g) => g.id === "gloves-r")!.x);
    expect(crossGloves.find((g) => g.id === "gloves-l")!.x).toBeGreaterThan(jabGloves.find((g) => g.id === "gloves-l")!.x);

    // 4. Look-around: binoculars at eyes shift horizontally when facing flips from +1 to -1
    const lookProgram = compileSingleAction("look-around", 4000);
    const lookRight = sampleAnimation(lookProgram, 800);
    const lookLeft = sampleAnimation(lookProgram, 2400);
    const binoRight = sampleActionAddons({ action: "look-around", progress: 0.2, pose: lookRight })[0]!;
    const binoLeft = sampleActionAddons({ action: "look-around", progress: 0.6, pose: lookLeft })[0]!;
    expect(binoRight.x).toBeGreaterThan(binoLeft.x);

    // 5. Check-watch on wrist & foot socket tracking
    const watchProgram = compileSingleAction("check-watch", 1800);
    const watchUp = sampleAnimation(watchProgram, 900);
    const watchAddons = sampleActionAddons({ action: "check-watch", progress: 0.5, pose: watchUp });
    expect(watchAddons).toHaveLength(1);
    expect(watchAddons[0]!.type).toBe("watch");

    const footBall = sampleActionAddons({
      action: "walk",
      progress: 0.5,
      pose: watchUp,
      addons: [{ id: "foot-sensor", type: "ball", socket: "rFoot" }],
      mergeDefaults: false
    })[0]!;
    const rShin = watchUp.segments.find((s) => s.id === "right-shin")!;
    expect(footBall.x + footBall.width / 2).toBeCloseTo(rShin.x2, 2);
    expect(footBall.y + footBall.height / 2).toBeCloseTo(rShin.y2, 2);
  });

  it("solves parabolic projectile flight and target netBulge for basketball-shot and kick-ball", () => {
    const start = { x: 100, y: 220 };
    const end = { x: 300, y: 180 };
    const fpStart = computeAddonFlightPoint(start, end, { from: 0.4, to: 0.7, apex: 50, spin: 720 }, 0.4, 1);
    const fpMid = computeAddonFlightPoint(start, end, { from: 0.4, to: 0.7, apex: 50, spin: 720 }, 0.55, 1);
    const fpEnd = computeAddonFlightPoint(start, end, { from: 0.4, to: 0.7, apex: 50, spin: 720 }, 0.7, 1);
    expect(fpStart).toMatchObject({ x: 100, y: 220, rotation: 0 });
    expect(fpEnd).toMatchObject({ x: 300, y: 180, rotation: 720 });
    expect(fpMid.x).toBeCloseTo(200, 3);
    expect(fpMid.y).toBeCloseTo(150, 3); // 200 linear mid - 50 apex = 150 (higher in SVG space)

    // Basketball-shot full action sampling
    const bballProgram = compileSingleAction("basketball-shot", 4000, { actorX: 220, groundY: 400 });
    const bballPoseAt = (p: number) => sampleAnimation(bballProgram, p * 4000);

    const gather = sampleActionAddons({ action: "basketball-shot", progress: 0.3, pose: bballPoseAt(0.3), poseAtProgress: bballPoseAt });
    const gatherBall = gather.find((a) => a.type === "basketball")!;
    const gatherHoop = gather.find((a) => a.type === "hoop")!;
    const rForearmGather = bballPoseAt(0.3).segments.find((s) => s.id === "right-forearm")!;
    expect(gatherBall.x + gatherBall.width / 2).toBeCloseTo(rForearmGather.x2, 2);
    expect(gatherHoop.netBulge ?? 0).toBe(0);

    const releaseAddons = sampleActionAddons({ action: "basketball-shot", progress: 0.468, pose: bballPoseAt(0.468), poseAtProgress: bballPoseAt });
    const midAirAddons = sampleActionAddons({ action: "basketball-shot", progress: 0.55, pose: bballPoseAt(0.55), poseAtProgress: bballPoseAt });
    const swishAddons = sampleActionAddons({ action: "basketball-shot", progress: 0.629, pose: bballPoseAt(0.629), poseAtProgress: bballPoseAt });
    const bulgeAddons = sampleActionAddons({ action: "basketball-shot", progress: 0.689, pose: bballPoseAt(0.689), poseAtProgress: bballPoseAt });

    const releaseBall = releaseAddons.find((a) => a.type === "basketball")!;
    const midAirBall = midAirAddons.find((a) => a.type === "basketball")!;
    const swishBall = swishAddons.find((a) => a.type === "basketball")!;
    expect(midAirBall.x).toBeGreaterThan(releaseBall.x);
    expect(midAirBall.x).toBeLessThan(swishBall.x);
    // Parabolic apex rises higher (smaller SVG y) than both release and rim entry
    expect(midAirBall.y).toBeLessThan(Math.min(releaseBall.y, swishBall.y));
    expect(midAirBall.rotation).toBeGreaterThan(0);

    const bulgingHoop = bulgeAddons.find((a) => a.type === "hoop")!;
    expect(bulgingHoop.netBulge).toBeGreaterThan(0.8);
    expect(renderAddonSvg(bulgingHoop)).not.toBe(renderAddonSvg(gatherHoop));

    // Kick-ball full action sampling
    const kickProgram = compileSingleAction("kick-ball", 6000, { actorX: 240, groundY: 400 });
    const kickPoseAt = (p: number) => sampleAnimation(kickProgram, p * 6000);
    const preKick = sampleActionAddons({ action: "kick-ball", progress: 0.25, pose: kickPoseAt(0.25), poseAtProgress: kickPoseAt });
    const midKick = sampleActionAddons({ action: "kick-ball", progress: 0.636, pose: kickPoseAt(0.636), poseAtProgress: kickPoseAt });
    const goalImpact = sampleActionAddons({ action: "kick-ball", progress: 0.768, pose: kickPoseAt(0.768), poseAtProgress: kickPoseAt });

    const preBall = preKick.find((a) => a.type === "football")!;
    const midBall = midKick.find((a) => a.type === "football")!;
    expect(midBall.x).toBeGreaterThan(preBall.x);
    expect(midBall.y).toBeLessThan(preBall.y);
    expect(goalImpact.find((a) => a.type === "goal")!.netBulge).toBeGreaterThan(0.8);
  });

  it("advances progressive board ink 0..1 on write-board and renders partial ink strokes", () => {
    const boardProgram = compileSingleAction("write-board", 2500);
    const inks = [0, 0.2, 0.4, 0.6, 0.75, 0.9].map((p) => {
      const frame = sampleAnimation(boardProgram, p * 2500);
      const board = sampleActionAddons({ action: "write-board", progress: p, pose: frame })[0]!;
      expect(board.type).toBe("board");
      return { p, board, ink: board.ink ?? 0, svg: renderAddonSvg(board) };
    });

    expect(inks[0]!.ink).toBe(0);
    expect(inks[0]!.svg).not.toContain('data-part="board-ink"');
    for (let i = 1; i < inks.length; i++) {
      expect(inks[i]!.ink).toBeGreaterThanOrEqual(inks[i - 1]!.ink);
    }
    expect(inks[2]!.ink).toBeGreaterThan(0);
    expect(inks[2]!.ink).toBeLessThan(1);
    expect(inks[5]!.ink).toBe(1);
    expect(inks[5]!.svg.length).toBeGreaterThan(inks[2]!.svg.length);
  });

  it("animates hinged door opening/closing and separates back opening/leaf from front frame on open-door", () => {
    const doorProgram = compileSingleAction("open-door", 3000);
    const closedStart = sampleActionAddons({ action: "open-door", progress: 0.1, pose: sampleAnimation(doorProgram, 300) });
    const wideOpen = sampleActionAddons({ action: "open-door", progress: 0.6, pose: sampleAnimation(doorProgram, 1800) });
    const closedEnd = sampleActionAddons({ action: "open-door", progress: 0.85, pose: sampleAnimation(doorProgram, 2550) });

    expect(closedStart.map((d) => d.layer)).toEqual(["back", "front"]);
    expect(closedStart[0]!.open).toBe(0);
    expect(wideOpen[0]!.open).toBeGreaterThan(0.9);
    expect(closedEnd[0]!.open).toBe(0);

    const backSvg = renderAddonsLayerSvg(wideOpen, "back");
    const frontSvg = renderAddonsLayerSvg(wideOpen, "front");
    expect(backSvg).toContain('data-part="door-opening"');
    expect(backSvg).toContain('data-part="door-leaf"');
    expect(frontSvg).toContain('data-part="door-frame"');
    expect(frontSvg).toContain('data-part="door-post"');
    expect(frontSvg).not.toContain('data-part="door-leaf"');

    for (const hinge of ["left", "right"] as const) {
      for (const open of [0, 0.35, 0.75, 1]) {
        const g = doorGeometry({ x: 100, y: 120, width: 67, height: 185, hinge, open });
        expect(g.freeX).toBeGreaterThanOrEqual(g.x - 1e-6);
        expect(g.freeX).toBeLessThanOrEqual(g.x + g.width + 1e-6);
      }
    }
  });

  it("persists shared stage chair seamlessly across sit-down -> type-at-desk -> stand-up", () => {
    const result = compileAnimation({
      version: CONTRACT_VERSION,
      canvas: { width: 960, height: 480, fps: 30 },
      durationMs: 6000,
      actor: { x: 320, groundY: 380 },
      actions: [
        { action: "sit-down", startMs: 0, durationMs: 2000 },
        { action: "type-at-desk", startMs: 2000, durationMs: 2000 },
        { action: "stand-up", startMs: 4000, durationMs: 2000 }
      ]
    });
    expect(result.diagnostics).toEqual([]);
    const program = result.program!;

    const sitEnd = sampleActionAddons({
      action: "sit-down",
      progress: 1,
      pose: sampleAnimation(program, 1999),
      nextAction: "type-at-desk"
    });
    const typeStart = sampleActionAddons({
      action: "type-at-desk",
      progress: 0,
      pose: sampleAnimation(program, 2000),
      previousAction: "sit-down",
      nextAction: "stand-up"
    });
    const typeMid = sampleActionAddons({
      action: "type-at-desk",
      progress: 0.5,
      pose: sampleAnimation(program, 3000),
      previousAction: "sit-down",
      nextAction: "stand-up"
    });
    const typeEnd = sampleActionAddons({
      action: "type-at-desk",
      progress: 1,
      pose: sampleAnimation(program, 3999),
      previousAction: "sit-down",
      nextAction: "stand-up"
    });
    const standStart = sampleActionAddons({
      action: "stand-up",
      progress: 0,
      pose: sampleAnimation(program, 4000),
      previousAction: "type-at-desk"
    });
    const standEnd = sampleActionAddons({
      action: "stand-up",
      progress: 1,
      pose: sampleAnimation(program, 6000),
      previousAction: "type-at-desk"
    });

    const chairSitEnd = sitEnd.find((a) => a.id === "chair")!;
    const chairTypeStart = typeStart.find((a) => a.id === "chair")!;
    const chairTypeEnd = typeEnd.find((a) => a.id === "chair")!;
    const chairStandStart = standStart.find((a) => a.id === "chair")!;

    expect(chairSitEnd.opacity).toBe(1);
    expect(chairTypeStart.opacity).toBe(1);
    expect(chairTypeEnd.opacity).toBe(1);
    expect(chairStandStart.opacity).toBe(1);

    // Exact stationary geometry across all 3 actions
    expect(chairTypeStart.x).toBe(chairSitEnd.x);
    expect(chairTypeStart.y).toBe(chairSitEnd.y);
    expect(chairStandStart.x).toBe(chairTypeEnd.x);
    expect(chairStandStart.y).toBe(chairTypeEnd.y);

    // Desk is present during mid typing, fades out by end of type-at-desk (not in stand-up), and chair exits after stand-up
    expect(typeMid.some((a) => a.id === "desk" && a.opacity === 1)).toBe(true);
    expect(typeEnd.some((a) => a.id === "desk")).toBe(false);
    expect(standEnd.some((a) => a.id === "chair")).toBe(false);
  });

  it("strictly XML-escapes user text, applies theme/config overrides, and renders valid SVG for all 37 AddonTypes", () => {
    const signProgram = compileSingleAction("hold-sign", 2000);
    const signPose = sampleAnimation(signProgram, 1000);
    const unsafeText = `<script>alert("xss")</script> & 'R3'`;

    const customSign = sampleActionAddons({
      action: "hold-sign",
      progress: 0.5,
      pose: signPose,
      actorId: `actor<"1">`,
      addons: [{ type: "sign", text: unsafeText, color: "#ffeeaa" }]
    })[0]!;
    const signSvg = renderAddonSvg(customSign);
    assertWellFormedXmlFragment(signSvg, "escaped-sign");
    expect(signSvg).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &apos;R3&apos;");
    expect(signSvg).toContain('data-actor-id="actor&lt;&quot;1&quot;&gt;"');
    expect(signSvg).not.toContain("<script");

    // Theme accent color applies to brand-accent props unless overridden by explicit color
    const bannerProgram = compileSingleAction("pull-banner", 2000);
    const bannerPose = sampleAnimation(bannerProgram, 1000);
    const themedBanner = sampleActionAddons({
      action: "pull-banner",
      progress: 0.6,
      pose: bannerPose,
      themeAccentColor: "#0078d4",
      addons: [{ type: "banner", text: "FY27 & Beyond" }]
    })[0]!;
    expect(themedBanner.color).toBe("#0078d4");
    const bannerSvg = renderAddonSvg(themedBanner);
    assertWellFormedXmlFragment(bannerSvg, "themed-banner");
    expect(bannerSvg).toContain("FY27 &amp; Beyond");

    // Escape helper strips XML 1.0 illegal control characters as well
    expect(escapeXml("A\u0000B\u0007C<&>\"'")).toBe("ABC&lt;&amp;&gt;&quot;&apos;");

    // Render every single AddonType and validate well-formed XML + deterministic output
    for (const type of ADDON_TYPES) {
      const def = PROP_DEFINITIONS[type];
      const sample: SampledAddon = {
        id: `test-${type}`,
        type,
        layer: "front",
        x: 120.1234,
        y: 80.5678,
        width: def.defaultSize.w,
        height: def.defaultSize.h,
        rotation: type === "pointer" ? 15 : 0,
        scale: 1,
        opacity: 1,
        color: def.defaultColor,
        ...(type === "board" ? { ink: 0.75 } : {}),
        ...(type === "door" ? { open: 0.65, hinge: "right" as const } : {}),
        ...(type === "hoop" || type === "goal" ? { netBulge: 0.85 } : {}),
        ...(type === "bulb" ? { puff: true } : {}),
        ...(type === "card" || type === "sign" || type === "banner" ? { text: "OK <1>" } : {})
      };

      const svg1 = renderAddonSvg(sample, { strokeWidth: 2.5, themeColor: "#202124" });
      const svg2 = renderAddonSvg(sample, { strokeWidth: 2.5, themeColor: "#202124" });
      expect(svg1, `${type}: deterministic SVG`).toBe(svg2);
      expect(svg1).toContain(`data-addon="${type}"`);
      expect(svg1).toContain(`data-addon-id="test-${type}"`);
      assertWellFormedXmlFragment(svg1, `addon-${type}`);

      if (type === "bulb") {
        expect(svg1.toLowerCase()).toContain("#f59e0b");
        expect(svg1).toContain('data-part="bulb-filament"');
        expect(svg1).toContain('data-part="bulb-ray"');
      }
      if (type === "door") {
        const backDoorSvg = renderAddonSvg({ ...sample, layer: "back" });
        assertWellFormedXmlFragment(backDoorSvg, "addon-door-back");
        expect(backDoorSvg).toContain('data-part="door-leaf"');
        expect(svg1).toContain('data-part="door-frame"');
      }
    }
  });

  it("keeps travel-clip stage props stationary via originX, clamps to narrow canvas bounds, and samples all auto-mapped actions cleanly", () => {
    // Hurdle stays planted at originX while runner travels across it
    const hurdleProgram = compileSingleAction("hurdle", 3000, { actorX: 180, groundY: 380, target: { x: 520, y: 380 } });
    const hEarly = sampleActionAddons({
      action: "hurdle",
      progress: 0.2,
      originX: 180,
      pose: sampleAnimation(hurdleProgram, 600)
    })[0]!;
    const hClearance = sampleActionAddons({
      action: "hurdle",
      progress: 0.56,
      originX: 180,
      pose: sampleAnimation(hurdleProgram, 1680)
    })[0]!;
    expect(hClearance.x).toBe(hEarly.x);
    expect(hClearance.y).toBe(hEarly.y);

    // Narrow canvas clamps hoop inside viewport and basketball still lands on the clamped hoop rim
    const bballProgram = compileSingleAction("basketball-shot", 3600, { actorX: 280, groundY: 380 });
    const narrowCanvas = { width: 380, height: 420 };
    const atSwish = sampleActionAddons({
      action: "basketball-shot",
      progress: 0.629,
      pose: sampleAnimation(bballProgram, 0.629 * 3600),
      poseAtProgress: (p) => sampleAnimation(bballProgram, p * 3600),
      canvas: narrowCanvas
    });
    const clampedHoop = atSwish.find((a) => a.type === "hoop")!;
    const clampedBall = atSwish.find((a) => a.type === "basketball")!;
    expect(clampedHoop.x + clampedHoop.width).toBeLessThanOrEqual(narrowCanvas.width - 4 + 1e-6);
    expect(clampedBall.x + clampedBall.width / 2).toBeCloseTo(clampedHoop.x + clampedHoop.width * 0.7, 2);

    // Every auto-mapped action compiles (when in runtime catalog) and renders valid XML across its timeline
    const pureLocomotion = new Set(["walk", "run", "jog", "walk-backwards", "crawl", "push-walk", "sneak"]);
    for (const action of AUTO_MAPPED_ACTIONS) {
      if (!describeAction(action)) continue;
      const program = compileSingleAction(
        action,
        2600,
        pureLocomotion.has(action) ? { target: { x: 420, y: 360 } } : {}
      );
      for (const p of [0.1, 0.5, 0.8]) {
        const frame = sampleAnimation(program, p * 2600);
        const addons = sampleActionAddons({
          action,
          progress: p,
          originX: 260,
          pose: frame,
          poseAtProgress: (q) => sampleAnimation(program, q * 2600)
        });
        for (const addon of addons) {
          expect(Number.isFinite(addon.x), `${action}@${p}`).toBe(true);
          expect(Number.isFinite(addon.y), `${action}@${p}`).toBe(true);
          const svg = renderAddonSvg(addon);
          assertWellFormedXmlFragment(svg, `${action}-${addon.id}@${p}`);
        }
      }
    }
  });

  it("enforces physical hand/foot/head/pelvis contact proximity (<= 35px, zero phantom floating props) across all 55 prop-bearing runtime clips", () => {
    expect(AUTO_MAPPED_ACTIONS).toHaveLength(55);

    // Every catalog action with a non-push, non-hand-shape prop must be auto-mapped
    const handGestureShapes = new Set(["palm", "thumb"]);
    for (const entry of actionCatalog) {
      if (entry.prop && entry.action !== "push" && !handGestureShapes.has(entry.prop)) {
        expect(
          defaultAddonsForAction(entry.action).length,
          `${entry.action} (prop=${entry.prop}) must map defaultAddonsForAction`
        ).toBeGreaterThan(0);
      }
    }

    const addonDistanceToPoint = (addon: SampledAddon, px: number, py: number): number => {
      let dist = Math.hypot(
        Math.max(addon.x - px, 0, px - (addon.x + addon.width)),
        Math.max(addon.y - py, 0, py - (addon.y + addon.height))
      );
      if (addon.type === "sign") {
        const cx = addon.x + addon.width / 2;
        const y0 = addon.y + addon.height;
        const y1 = y0 + addon.height * 1.02;
        dist = Math.min(dist, Math.hypot(cx - px, Math.max(y0 - py, 0, py - y1)));
      }
      return dist;
    };

    const boxDistance = (a: SampledAddon, b: SampledAddon): number =>
      Math.hypot(
        Math.max(a.x - (b.x + b.width), 0, b.x - (a.x + a.width)),
        Math.max(a.y - (b.y + b.height), 0, b.y - (a.y + a.height))
      );

    const pureLocomotion = new Set(["walk", "run", "jog", "walk-backwards", "crawl", "push-walk", "sneak"]);

    for (const action of AUTO_MAPPED_ACTIONS) {
      const clip = RUNTIME_MOTION_LIBRARY.clips[action];
      expect(clip, `runtime clip for ${action}`).toBeDefined();
      const n = clip!.frames.length;

      for (const facing of ["right", "left"] as const) {
        const startAnchor = facing === "right" ? "center-left" : "center-right";
        const toAnchor = pureLocomotion.has(action)
          ? facing === "right"
            ? "center-right"
            : "center-left"
          : undefined;
        const choreo = choreographAnimation({
          actor: { x: startAnchor, facing },
          actions: [{ action, ...(toAnchor ? { to: toAnchor } : {}) }]
        });
        expect(choreo.valid, `${action} (${facing}) choreograph valid`).toBe(true);
        const program = choreo.program!;
        const durationMs = choreo.spec!.durationMs;

        const minContactByAddon = new Map<string, number>();

        for (let f = 0; f <= n; f++) {
          const p = f / n;
          const frame = sampleAnimation(program, p * durationMs);
          const geom = frameGeometry(frame);
          const seg = (id: string) => frame.segments.find((s) => s.id === id)!;
          const rFore = seg("right-forearm");
          const lFore = seg("left-forearm");
          const rShin = seg("right-shin");
          const lShin = seg("left-shin");
          const torso = seg("torso");

          const bodyContacts = [
            { x: rFore.x2, y: rFore.y2, radius: 0 },
            { x: lFore.x2, y: lFore.y2, radius: 0 },
            { x: rFore.x1 + (rFore.x2 - rFore.x1) * 0.82, y: rFore.y1 + (rFore.y2 - rFore.y1) * 0.82, radius: 0 },
            { x: rShin.x2, y: rShin.y2, radius: 0 },
            { x: lShin.x2, y: lShin.y2, radius: 0 },
            { x: torso.x1, y: torso.y1, radius: 0 },
            { x: torso.x2, y: torso.y2, radius: 0 },
            { x: geom.head.x, y: geom.head.y, radius: geom.headRadius }
          ];

          const addons = frame.addons ?? [];
          for (const addon of addons) {
            if (addon.opacity < 0.25) continue;
            let best = Infinity;
            for (const pt of bodyContacts) {
              const d = Math.max(0, addonDistanceToPoint(addon, pt.x, pt.y) - pt.radius);
              if (d < best) best = d;
            }
            if (addon.type === "hoop" || addon.type === "goal") {
              for (const other of addons) {
                if (other.id !== addon.id && (other.type === "basketball" || other.type === "football" || other.type === "ball")) {
                  best = Math.min(best, boxDistance(addon, other));
                }
              }
            }
            const prev = minContactByAddon.get(addon.id);
            if (prev === undefined || best < prev) {
              minContactByAddon.set(addon.id, best);
            }
          }
        }

        expect(minContactByAddon.size, `${action} (${facing}) must emit visible addons`).toBeGreaterThan(0);
        for (const [addonId, minDist] of minContactByAddon.entries()) {
          expect(minDist, `${action} (${facing}) addon "${addonId}" contact distance`).toBeLessThanOrEqual(35);
        }
      }
    }

    // Verify exact stair step tread support (<= 2px) on stairs-down, stairs-up, and step-up
    for (const stairAction of ["stairs-down", "stairs-up", "step-up"] as const) {
      const clip = RUNTIME_MOTION_LIBRARY.clips[stairAction]!;
      const n = clip.frames.length;
      const choreo = choreographAnimation({
        canvas: { width: 1200, height: 600, fps: 30 },
        groundY: 480,
        actor: { x: 400 },
        actions: [{ action: stairAction }]
      });
      const program = choreo.program!;
      const durationMs = choreo.spec!.durationMs;

      for (let f = 1; f < n - 1; f++) {
        const frame = sampleAnimation(program, (f / (n - 1)) * durationMs);
        const prevFrame = sampleAnimation(program, ((f - 1) / (n - 1)) * durationMs);
        const nextFrame = sampleAnimation(program, ((f + 1) / (n - 1)) * durationMs);
        const stairs = frame.addons?.find((a) => a.type === "stairs");
        if (!stairs) continue;
        const steps = stairs.height / Math.max(1, stairs.width) <= 0.4 ? 1 : 3;
        for (const shinId of ["left-shin", "right-shin"] as const) {
          const sh = frame.segments.find((s) => s.id === shinId)!;
          const shPrev = prevFrame.segments.find((s) => s.id === shinId)!;
          const shNext = nextFrame.segments.find((s) => s.id === shinId)!;
          const planted =
            Math.hypot(sh.x2 - shPrev.x2, sh.y2 - shPrev.y2) < 0.25 &&
            Math.hypot(sh.x2 - shNext.x2, sh.y2 - shNext.y2) < 0.25;
          if (planted && sh.y2 < frame.groundY - 1) {
            expect(sh.x2, `${stairAction}@f${f} ${shinId} within stairs X`).toBeGreaterThanOrEqual(stairs.x - 1);
            expect(sh.x2, `${stairAction}@f${f} ${shinId} within stairs X`).toBeLessThanOrEqual(stairs.x + stairs.width + 1);
            const u = Math.min(0.999999, Math.max(0, (sh.x2 - stairs.x) / stairs.width));
            const stepIdx = Math.floor(u * steps);
            const treadY =
              stairs.hinge === "left"
                ? stairs.y + (stairs.height * stepIdx) / steps
                : stairs.y + stairs.height * (1 - (stepIdx + 1) / steps);
            expect(Math.abs(sh.y2 - treadY), `${stairAction}@f${f} ${shinId} tread Y alignment`).toBeLessThanOrEqual(2);
          }
        }
      }
    }

    // Verify sustained hand grip proximity (<= 12px) on held & carried props
    const sustainedHeldChecks: ReadonlyArray<[string, string, number, number, "rHand" | "lHand" | "bothHands"]> = [
      ["present-card", "card", 0.22, 0.5, "rHand"],
      ["reveal", "card", 0.46, 0.67, "rHand"],
      ["hand-over", "card", 0.1, 0.56, "rHand"],
      ["tablet-tap", "tablet", 0.1, 0.85, "lHand"],
      ["write-notes", "notebook", 0.1, 0.88, "lHand"],
      ["write-notes", "pen", 0.1, 0.88, "rHand"],
      ["hold-sign", "sign", 0.1, 0.88, "rHand"],
      ["inspect-magnifier", "magnifier", 0.1, 0.9, "rHand"],
      ["inspect-magnifier", "notebook", 0.1, 0.9, "lHand"],
      ["phone-call", "phone", 0.08, 0.88, "rHand"],
      ["pick-up", "box", 0.41, 0.9, "bothHands"],
      ["put-down", "box", 0.02, 0.58, "bothHands"],
      ["lift-carry", "box", 0.12, 0.85, "bothHands"],
      ["drag-object", "box", 0.2, 0.74, "bothHands"],
      ["pull", "box", 0.13, 0.82, "bothHands"],
      ["push-walk", "box", 0.13, 0.78, "bothHands"]
    ];
    for (const [actName, addonId, pStart, pEnd, socket] of sustainedHeldChecks) {
      const choreo = choreographAnimation({
        actor: { x: "center-left" },
        actions: [{ action: actName, ...(actName === "push-walk" ? { to: "center-right" } : {}) }]
      });
      const program = choreo.program!;
      const durationMs = choreo.spec!.durationMs;
      for (const tFrac of [pStart, (pStart + pEnd) / 2, pEnd]) {
        const frame = sampleAnimation(program, tFrac * durationMs);
        const addon = frame.addons?.find((a) => a.id === addonId);
        expect(addon, `${actName}@${tFrac} missing ${addonId}`).toBeDefined();
        const rFore = frame.segments.find((s) => s.id === "right-forearm")!;
        const lFore = frame.segments.find((s) => s.id === "left-forearm")!;
        const gripDist =
          socket === "rHand"
            ? addonDistanceToPoint(addon!, rFore.x2, rFore.y2)
            : socket === "lHand"
              ? addonDistanceToPoint(addon!, lFore.x2, lFore.y2)
              : Math.min(
                  addonDistanceToPoint(addon!, rFore.x2, rFore.y2),
                  addonDistanceToPoint(addon!, lFore.x2, lFore.y2)
                );
        expect(gripDist, `${actName}@${tFrac} ${addonId} grip distance`).toBeLessThanOrEqual(12);
      }
    }
  });
});
