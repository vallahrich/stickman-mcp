import { readFile, mkdtemp, mkdir, rm, readdir, stat, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { composeFilmRecipe, listFilmAssets, renderFilmRecipe } from "../src/film.js";
import { buildJoinMatrix } from "../scripts/film/joins.mjs";
import { storyTimeline, videoRecipes } from "../scripts/site/story-films.mjs";

const example = JSON.parse(await readFile(new URL("../examples/films/team-handoff.json", import.meta.url), "utf8"));
const bridgeDemo = JSON.parse(await readFile(new URL("../examples/films/bridge-demo.json", import.meta.url), "utf8"));
const small = () => ({ id: "short-test", title: "Small test", performance: [{ motion: "nod", root: 400, hold: 39, beat: "first" }],
  scenes: [{ id: "first", title: "First", place: "office", cues: [{ frame: 0, text: "A small test." }], overlays: [{ type: "tick", x: 650, y: 160, from: 0, to: 75 }] }] });

describe("film recipes", () => {
  it("composes the example with scene/item ranges and continuity for every actor", async () => {
    const result = await composeFilmRecipe(example);
    expect(result).toMatchObject({ valid: true, frames: 309, seconds: 10.3, fps: 30,
      scenes: [{ startFrame: 0, frames: 150 }, { startFrame: 150, frames: 159 }],
      items: [{ startFrame: 0, endFrame: 149 }, { startFrame: 159, endFrame: 308 }],
      continuity: { lead: { maxJointStep: 13.45, limit: 14, passed: true }, actors: [
        { extraIndex: 0, continuity: { passed: true } }, { extraIndex: 1, continuity: { passed: true } }
      ] }
    });
  });
  it("bridges the walk-to-look-around join deterministically and leaves smooth joins alone", async () => {
    const first = await composeFilmRecipe(bridgeDemo), second = await composeFilmRecipe(bridgeDemo);
    expect(first).toMatchObject({ bridges: [{ from: "walk-right", to: "look-around", kind: "generated-bridge", feetLocked: true, costBefore: 19.94, costAfter: 13.21 }] });
    expect(first.bridges).toEqual(second.bridges);
    expect(first.continuity.lead).toMatchObject({ passed: true, limit: 14 });
    const smooth = { ...small(), performance: [
      { motion: "nod", root: 400, hold: 39, beat: "first" }, { motion: "nod", hold: 39, beat: "second" }
    ], scenes: [
      { id: "first", title: "First", place: "city", cues: [{ frame: 0, text: "First cue." }] },
      { id: "second", title: "Second", place: "city", cues: [{ frame: 0, text: "Second cue." }] }
    ] };
    expect((await composeFilmRecipe(smooth)).bridges).toEqual([]);
  });
  it("reports explicit support releases and keeps both showcase films contact-safe", async () => {
    const results = await Promise.all(videoRecipes.map(recipe => {
      const input = structuredClone(recipe);
      delete input.sources;
      input.summary = "Support transitions release and replant feet at qualified joins.";
      return composeFilmRecipe(input);
    }));
    expect(results.map(result => result.id)).toEqual(["open-source", "julius-caesar"]);
    for (const result of results) {
      const lead = result.continuity.lead;
      expect(lead.maxJointStep).toBeLessThanOrEqual(14);
      expect(lead.footSlides).toEqual([]);
      expect(lead.maxFootSlide).toBeLessThanOrEqual(1.2);
      expect(lead.supportTransitions.length).toBeGreaterThan(0);
      expect(lead.supportTransitions.every(transition => transition.lift === 1.25 && transition.rampFrames === 4)).toBe(true);
    }
    expect(results.map(result => result.continuity.lead.supportTransitions.length)).toEqual([6, 7]);
  }, 180_000);
  it("uses the same per-join support lift in continuity and rendered actor layers", async () => {
    const { composeFilm, loadShowcaseResources } = await import("../scripts/film/runtime.mjs");
    const { createPerformanceRenderer, performanceSupportLift } = await import("../scripts/site/performance.mjs");
    const resources = await loadShowcaseResources();
    const composed = await composeFilm(videoRecipes[0], resources);
    const transition = composed.continuity.supportTransitions[0];
    const segment = composed.performance.segments.find(item => item.itemIndex === transition.itemIndex);
    const frame = segment.gapStart;
    expect(performanceSupportLift(composed.performance, frame)).toBe(1.25);
    const renderActor = createPerformanceRenderer(composed.performance, {
      sampleClipMotion: resources.sampleClipMotion, frameGeometry: resources.frameGeometry,
      propsCatalog: resources.propsCatalog, motions: composed.motions
    });
    const rendered = await renderActor(frame);
    expect(rendered.actor).toContain('transform="translate(0 -3)"');
  }, 120_000);
  it("keeps the approved-pair join matrix deterministic and analytically bridgeable", async () => {
    const saved = JSON.parse(await readFile(new URL("../motions/join-matrix.json", import.meta.url), "utf8"));
    expect(await buildJoinMatrix()).toEqual(saved);
    expect(saved.motions).toEqual([...saved.motions].sort());
    const keys = saved.joins.map(join => `${join.from}->${join.to}`);
    expect(keys).toEqual([...keys].sort());
    for (const join of saved.joins) {
      const frames = Math.max(6, Math.min(24, Math.ceil(join.cost / 14 * 6)));
      expect(join.cost * 1.5 / frames).toBeLessThanOrEqual(14);
    }
    expect(saved.joins.find(join => join.from === "walk" && join.to === "look-around")?.cost).toBeGreaterThan(14);
  }, 180_000);
  it("rejects unknown keys and invalid recipe fields before composition", async () => {
    for (const recipe of [
      { ...small(), unexpected: true },
      { ...small(), performance: [{ ...small().performance[0], unexpected: true }] },
      { ...small(), extras: [{ actor: small().performance, from: "first", until: "first", kit: "unknown" }] },
      { ...small(), scenes: [{ ...small().scenes[0], place: "unknown" }] },
      { ...small(), performance: [{ ...small().performance[0], motion: "nod", walk: { to: 100 } }] },
      { ...small(), performance: [{ ...small().performance[0], hold: -1 }] }
    ]) await expect(composeFilmRecipe(recipe)).rejects.toThrow(/Invalid film recipe/);
  });
  it("rejects unknown motions, scene refs, authored-key errors, excessive duration and invalid windows", async () => {
    await expect(composeFilmRecipe({ ...small(), performance: [{ ...small().performance[0], motion: "missing-motion" }] })).rejects.toThrow("not user-approved");
    await expect(composeFilmRecipe({ ...small(), performance: [{ ...small().performance[0], beat: "missing-scene" }] })).rejects.toThrow("unknown scene reference");
    await expect(composeFilmRecipe({ ...small(), extras: [{ motion: "nod", root: 700, from: "missing", until: "first" }] })).rejects.toThrow("known scenes");
    await expect(composeFilmRecipe({ ...small(), performance: [{ ...small().performance[0], until: 1 }] })).rejects.toThrow("authored key frame");
    const progress = [];
    const long = await composeFilmRecipe({ ...small(), performance: [{ ...small().performance[0], hold: 1800 }] }, {
      onProgress: event => progress.push(event.phase)
    });
    expect(long).toMatchObject({ frames: 1836, warnings: expect.arrayContaining([expect.stringContaining("curated showcase assets only")]) });
    expect(progress).toEqual(["compose", "compose"]);
    expect(() => storyTimeline({ ...small(), scenes: [{ id: "first", title: "First", state: "first", place: "office", cues: [{ frame: 0, text: "A small test." }] }] },
      { segments: [{ beat: "first", gapStart: 0 }], frames: 1801 }, { showcase: true })).toThrow("one-minute story limit");
    await expect(composeFilmRecipe({ ...small(), scenes: [{ ...small().scenes[0], overlays: [{ ...small().scenes[0].overlays[0], to: 100 }] }] })).rejects.toThrow("visibility/fade window");
    await expect(composeFilmRecipe({ ...small(), scenes: [{ ...small().scenes[0], overlays: [{ ...small().scenes[0].overlays[0], text: "ignored" }] }] })).rejects.toThrow("text is not supported on tick");
    await expect(composeFilmRecipe({ ...small(), scenes: [{ ...small().scenes[0], overlays: [{ ...small().scenes[0].overlays[0], type: "text" }] }] })).rejects.toThrow("text requires text");
    await expect(composeFilmRecipe({ ...small(), performance: [{ ...small().performance[0], root: undefined }] })).rejects.toThrow("root position");
  });
  it("includes motion extras in continuity reports and rejects ignored/unknown options", async () => {
    const result = await composeFilmRecipe({ ...small(), extras: [{ motion: "nod", root: 850, scale: 0.55, from: "first", until: "first" }] });
    expect(result).toMatchObject({ continuity: { actors: [{ extraIndex: 0, kind: "motion", continuity: { passed: true } }] } });
    await expect(composeFilmRecipe({ ...small(), performance: [{ ...small().performance[0], cycles: 2 }] })).rejects.toThrow("cycles requires a loop");
    await expect(composeFilmRecipe({ ...small(), performance: [{ ...small().performance[0], keep: ["unknown-prop"] }] })).rejects.toThrow("unknown keep prop type");
    await expect(composeFilmRecipe({ ...small(), performance: [{ relocate: -80 }, small().performance[0]] })).rejects.toThrow("root only positions");
    await expect(composeFilmRecipe({ ...small(), performance: [small().performance[0], small().performance[0]] })).rejects.toThrow("duplicate scene beat");
  });
  it("propagates composition cancellation and progress callback failures", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(composeFilmRecipe(small(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(composeFilmRecipe(small(), { onProgress: () => { throw new Error("progress consumer failed"); } })).rejects.toThrow("progress consumer failed");
  });
  it("reports the offending continuity join for lead and supporting actors", async () => {
    const performance = [{ motion: "wave", root: 400, hold: 39, beat: "first" }, { motion: "nod", gap: 1, hold: 39 }];
    await expect(composeFilmRecipe({ ...small(), bridge: "off", performance })).rejects.toThrow(/lead: continuity 33.46 exceeds limit 14.*from.*wave.*to.*nod/);
    const actor = performance.map(({ beat, ...item }) => item);
    await expect(composeFilmRecipe({ ...small(), bridge: "off", extras: [{ actor, from: "first", until: "first" }] })).rejects.toThrow(/extras\/0: continuity 33.46 exceeds limit 14/);
  });
  it("fades delayed extras from their actual entrance and uses only declarative overlays", async () => {
    const { filmExtras, renderStoryFrame } = await import("../scripts/site/story-films.mjs");
    const { normalizeRecipe } = await import("../scripts/film/api.mjs");
    const { loadShowcaseResources } = await import("../scripts/film/runtime.mjs");
    const recipe = normalizeRecipe({ ...small(), id: "julius-caesar", extras: [{ motion: "nod", root: 850, from: "first", until: "first", delay: 20 }] });
    const timeline = await composeFilmRecipe({ ...small(), id: "julius-caesar", extras: [{ motion: "nod", root: 850, from: "first", until: "first", delay: 20 }] });
    expect(filmExtras(recipe, timeline, 19)).toHaveLength(0);
    expect(filmExtras(recipe, timeline, 20)[0].opacity).toBe(0);
    expect(filmExtras(recipe, timeline, 29)[0].opacity).toBeCloseTo(0.5);
    const resources = await loadShowcaseResources();
    expect(renderStoryFrame(recipe, timeline, 30, {}, resources.colors)).toContain("<circle");
  });
  it("returns mechanically qualified assets and the strict schema", async () => {
    const assets = await listFilmAssets();
    expect(assets).toMatchObject({ kits: ["legionary", "standard", "dagger"], fps: 30, continuityLimit: 14, joinCount: 9409,
      recipeSchema: { additionalProperties: false } });
    expect(assets.motions).toEqual(expect.arrayContaining([{ id: "nod", frames: 36, kind: "oneshot" }]));
    expect(assets.places).toContain("office");
    expect(assets.overlays).toContain("bubble");
    expect(assets.setTypes).toContain("box");
  });
  it("renders a confined fast preview, poster, captions and QA; refuses traversal/overwrites", async () => {
    const root = await mkdtemp(resolve(".film-test-"));
    try {
      await expect(renderFilmRecipe(small(), root, "..\\escape")).rejects.toThrow("inside");
      await expect(renderFilmRecipe(small(), root, resolve(root, "absolute"))).rejects.toThrow("relative");
      await mkdir(join(root, "actual"));
      await symlink(join(root, "actual"), join(root, "link"), "junction");
      await expect(renderFilmRecipe(small(), root, "link\\escape")).rejects.toThrow("symlinks");
      expect(await readdir(join(root, "actual"))).toEqual([]);
      const output = await renderFilmRecipe(small(), root, "preview", { preview: true, qaFrames: 3 });
      expect(output).toMatchObject({ frames: 75, encodedFrames: 38, encodedFps: 15, width: 640, height: 360 });
      expect((await readdir(join(root, "preview"))).sort()).toEqual(["short-test-qa.png", "short-test.mp4", "short-test.png", "short-test.vtt"]);
      expect((await stat(join(root, "preview", "short-test.mp4"))).size).toBeGreaterThan(1000);
      expect((await readFile(join(root, "preview", "short-test.png"))).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(await readFile(join(root, "preview", "short-test.vtt"), "utf8")).toContain("00:00:00.000 --> 00:00:02.500");
      await expect(renderFilmRecipe(small(), root, "preview")).rejects.toThrow("already exists");
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120_000);
  it("calls every new tool through SDK stdio including validation and preview", async () => {
    const root = await mkdtemp(resolve(".film-mcp-test-"));
    const client = new Client({ name: "film-tests", version: "1.0.0" });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve("dist", "mcp.js"), "--root", root], stderr: "pipe" }));
      const assets = await client.callTool({ name: "stickman_list_film_assets", arguments: {} });
      expect(assets.isError, JSON.stringify(assets)).not.toBe(true);
      const join = await client.callTool({ name: "stickman_check_join", arguments: { motionA: "walk", motionB: "look-around" } });
      expect(join.structuredContent).toMatchObject({ result: { from: "walk", to: "look-around", limit: 14, needsBridge: true, bridgeFrames: 21 } });
      const composed = await client.callTool({ name: "stickman_compose_film", arguments: { recipe: example } });
      expect(composed.structuredContent).toMatchObject({ result: { frames: 309, continuity: { lead: { passed: true } } } });
      const invalid = await client.callTool({ name: "stickman_compose_film", arguments: { recipe: { ...example, typo: true } } });
      expect(invalid.isError).toBe(true);
      const output = await client.callTool({ name: "stickman_render_film", arguments: { recipe: small(), outputDir: "preview", preview: true, qaFrames: 2 } });
      expect(output.isError, JSON.stringify(output)).not.toBe(true);
      expect(output.structuredContent).toMatchObject({ result: { encodedFrames: 38, encodedFps: 15 } });
    } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
  }, 120_000);
});
