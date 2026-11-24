import { describe, expect, it } from "vitest";
import { checkFilmJoin, composeFilmRecipe, listFilmAssets } from "../src/film.js";
import { RUNTIME_ACTION_NAMES } from "../src/motion-library.js";
import { ADDON_TYPES } from "../src/props.js";

describe("legacy film split-brain healing & auto-bridge fixes", () => {
  it("unlocks all 106 runtime motions including mocap baselines and canonical aliases", async () => {
    const assets = await listFilmAssets();
    const motionIds = new Set((assets.motions as Array<{ id: string }>).map((m) => m.id));
    for (const id of RUNTIME_ACTION_NAMES) {
      expect(motionIds.has(id), `Expected runtime motion "${id}" to be unlocked in listFilmAssets`).toBe(true);
    }

    const recipe = {
      id: "runtime-unlocked-demo",
      title: "Unlocked runtime baselines",
      bridge: "auto",
      performance: [
        { motion: "idle", root: 320, cycles: 1, hold: 20, beat: "intro" },
        { motion: "walk", beat: "move" },
        { motion: "point", hold: 40, beat: "point-beat" },
        { motion: "jump", hold: 15, beat: "jump-beat" },
        { motion: "kick-ball", hold: 20, beat: "kick-beat" }
      ],
      scenes: [
        { id: "intro", title: "Idle", place: "office", cues: [{ frame: 0, text: "Standing idle baseline." }] },
        { id: "move", title: "Walk", place: "office", cues: [{ frame: 0, text: "Walking forward baseline." }] },
        { id: "point-beat", title: "Point", place: "office", cues: [{ frame: 0, text: "Pointing at target." }] },
        { id: "jump-beat", title: "Jump", place: "office", cues: [{ frame: 0, text: "Jumping cleanly." }] },
        { id: "kick-beat", title: "Kick", place: "office", cues: [{ frame: 0, text: "Kicking the ball." }] }
      ]
    };
    const composed = await composeFilmRecipe(recipe);
    expect(composed.valid).toBe(true);
    expect((composed.continuity as { lead: { passed: boolean; maxJointStep: number } }).lead.passed).toBe(true);
    expect((composed.continuity as { lead: { maxJointStep: number } }).lead.maxJointStep).toBeLessThanOrEqual(14);

    // checkFilmJoin works even for newly unlocked runtime pairs
    const join = await checkFilmJoin("idle", "point");
    expect(join).toMatchObject({ from: "idle", to: "point", limit: 14 });
  }, 60_000);

  it("unlocks all 54+ src/props.ts add-ons as film overlays and renders them via renderAddonSvg", async () => {
    const assets = await listFilmAssets();
    const overlaySet = new Set(assets.overlays as string[]);
    const setTypeSet = new Set(assets.setTypes as string[]);
    for (const addon of ADDON_TYPES) {
      expect(overlaySet.has(addon), `Expected addon "${addon}" in film overlays`).toBe(true);
      expect(setTypeSet.has(addon), `Expected addon "${addon}" in film setTypes`).toBe(true);
    }

    const recipe = {
      id: "props-unlocked-demo",
      title: "Unlocked props overlays",
      performance: [{ motion: "nod", root: 400, hold: 60, beat: "s1" }],
      scenes: [
        {
          id: "s1",
          title: "Props stage",
          place: "office",
          cues: [{ frame: 0, text: "Showing unlocked props overlays." }],
          overlays: [
            { type: "laptop", x: 520, y: 260, from: 0, to: 85, scale: 1.4 },
            { type: "hoop", x: 960, y: 140, from: 5, to: 85 },
            { type: "goal", x: 120, y: 320, from: 5, to: 85 },
            { type: "coffee-mug", x: 640, y: 310, from: 10, to: 85 },
            { type: "anger-mark", x: 430, y: 120, from: 10, to: 85 }
          ]
        }
      ]
    };

    const composed = await composeFilmRecipe(recipe);
    expect(composed.valid).toBe(true);

    const { renderOverlays } = await import("../scripts/film/overlays.mjs");
    const { loadShowcaseResources } = await import("../scripts/film/runtime.mjs");
    const { colors } = await loadShowcaseResources();
    const markup = renderOverlays(recipe.scenes[0]!.overlays, 40, colors);
    expect(markup).toContain('data-addon="laptop"');
    expect(markup).toContain('data-addon="hoop"');
    expect(markup).toContain('data-addon="goal"');
    expect(markup).toContain('data-addon="coffee-mug"');
    expect(markup).toContain('data-addon="anger-mark"');
    expect(markup).not.toContain("<script");
  });

  it("bridges truncated look-around -> walk cleanly without continuity > 14 crashes", async () => {
    const recipe = {
      id: "truncated-look-around-to-walk",
      title: "Truncated look around to walk",
      bridge: "auto",
      performance: [
        { motion: "nod", root: 360, hold: 18, beat: "arrive" },
        { walk: { to: 620 } },
        { motion: "look-around", until: 24, hold: 50, beat: "scan" },
        { walk: { to: 920 } },
        { motion: "nod", hold: 60, beat: "settle" }
      ],
      scenes: [
        { id: "arrive", title: "Arrive", place: "city", cues: [{ frame: 0, text: "Arriving on stage." }] },
        { id: "scan", title: "Scan", place: "city", cues: [{ frame: 0, text: "Truncated look-around scan." }] },
        { id: "settle", title: "Settle", place: "city", cues: [{ frame: 0, text: "Walk smoothly onward." }] }
      ]
    };

    const composed = await composeFilmRecipe(recipe);
    expect(composed.valid).toBe(true);
    const lead = (composed.continuity as { lead: { passed: boolean; maxJointStep: number; limit: number } }).lead;
    expect(lead.passed).toBe(true);
    expect(lead.maxJointStep).toBeLessThanOrEqual(14);
    const bridges = composed.bridges as Array<{ from: string; to: string; frames: number; costAfter: number }>;
    const lookToWalk = bridges.find((b) => b.from === "look-around" && b.to === "walk-right");
    expect(lookToWalk).toBeDefined();
    expect(lookToWalk!.frames).toBeGreaterThanOrEqual(8);
    expect(lookToWalk!.costAfter).toBeLessThanOrEqual(14);

    // Also verify when truncated look-around is the very first motion before a walk
    const firstClipRecipe = {
      id: "truncated-first-look-around",
      title: "First truncated look around",
      bridge: "auto",
      performance: [
        { motion: "look-around", root: 380, until: 24, beat: "scan" },
        { walk: { to: 720 } },
        { motion: "nod", hold: 60, beat: "done" }
      ],
      scenes: [
        { id: "scan", title: "Scan", place: "office", cues: [{ frame: 0, text: "Quick look around." }] },
        { id: "done", title: "Done", place: "office", cues: [{ frame: 0, text: "Walk smoothly to finish." }] }
      ]
    };
    const firstComposed = await composeFilmRecipe(firstClipRecipe);
    expect(firstComposed.valid).toBe(true);
    expect((firstComposed.continuity as { lead: { passed: boolean; maxJointStep: number } }).lead.passed).toBe(true);
    expect((firstComposed.continuity as { lead: { maxJointStep: number } }).lead.maxJointStep).toBeLessThanOrEqual(14);
  }, 60_000);
});
