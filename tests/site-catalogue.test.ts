import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

describe("private designer catalogue", () => {
  it("keeps only the cloud slide and two videos in the active showcase", async () => {
    const html = await fs.readFile(path.resolve("site", "index.html"), "utf8");
    expect(html).toContain("__SHOWCASE_SECTION__");
    expect(html).not.toMatch(/\b(?:nist|nasa)\b|id="comparison"|id="stories"/i);
    expect(html).not.toMatch(/\b\d+(?:\.\d+)?\/10\b/);
  });
  it("removes only named retired artifacts when rebuilding an existing preview", async () => {
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { removeRetiredPresentationAssets, retiredPresentationAssets } = await import("../scripts/site/retired-presentations.mjs");
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "stickman-retired-"));
    try {
      await fs.mkdir(path.join(output, "demo"));
      for (const asset of retiredPresentationAssets) await fs.writeFile(path.join(output, asset), "retired");
      await fs.writeFile(path.join(output, "demo", "keep.txt"), "unrelated");
      await removeRetiredPresentationAssets(output);
      await removeRetiredPresentationAssets(output);
      for (const asset of retiredPresentationAssets) await expect(fs.access(path.join(output, asset))).rejects.toThrow();
      expect(await fs.readFile(path.join(output, "demo", "keep.txt"), "utf8")).toBe("unrelated");
    } finally {
      await fs.rm(output, { recursive: true });
    }
  });
  it("enforces one cloud slide and two short videos with complete assets", async () => {
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { showcaseSection } = await import("../scripts/site/showcase-section.mjs");
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "stickman-showcase-"));
    try {
      expect(await showcaseSection(output)).toContain("have not been generated");
      const folder = path.join(output, "showcase");
      await fs.mkdir(folder);
      const manifest = { slide: { src: "on-prem-to-cloud.html", seconds: 58.6 }, videos: ["open-source", "julius-caesar"].map((id, index) => ({
        id, src: `${id}.mp4`, poster: `${id}.png`, captions: `${id}.vtt`,
        seconds: index === 0 ? 58.43 : 59.17, frames: index === 0 ? 1753 : 1775
      })) };
      for (const asset of [manifest.slide.src, ...manifest.videos.flatMap(video => [video.src, video.poster, video.captions])]) await fs.writeFile(path.join(folder, asset), "fixture");
      const write = () => fs.writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest));
      await write();
      const html = await showcaseSection(output);
      expect(html.match(/<iframe/g)).toHaveLength(1);
      expect(html.match(/<video /g)).toHaveLength(2);
      expect(html).toContain("Open source: a small fix, shared");
      expect(html).toContain("Julius Caesar: ambition changes Rome");
      expect(html).not.toMatch(/<track[^>]*\bdefault\b/);
      expect(html).not.toMatch(/\b(?:nist|nasa)\b|\b\d+\/10\b/i);
      manifest.videos[0]!.seconds = 61;
      await write();
      await expect(showcaseSection(output)).rejects.toThrow("60 seconds");
      manifest.videos[0]!.seconds = 56;
      manifest.videos[0]!.src = "../../outside.mp4";
      await write();
      await expect(showcaseSection(output)).rejects.toThrow("known videos");
    } finally {
      await fs.rm(output, { recursive: true });
    }
  });
  it("rejects overlong or unrelated slide inputs and needs a composed performance for every film", async () => {
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { inspectSlide, videoRecipes, storyMotionSample } = await import("../scripts/site/build-showcase.mjs");
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { storyTimeline } = await import("../scripts/site/story-films.mjs");
    const html = (totalFrames: number) => `<section aria-label="Workload migration comparison"></section><script id="data" type="application/json">${JSON.stringify({ totalFrames })}</script>`;
    expect(inspectSlide(html(1758))).toBe(58.6);
    expect(() => inspectSlide(html(1801))).toThrow("60 seconds");
    expect(() => inspectSlide(html(0))).toThrow("longer than zero");
    expect(() => inspectSlide(html(100).replace("Workload migration comparison", "Other deck"))).toThrow("not the reviewed");
    expect(videoRecipes).toHaveLength(2);
    for (const recipe of videoRecipes) expect(() => storyTimeline(recipe, null)).toThrow("composed performance");
    const fake = (frames: number) => ({ frames, segments: [{ beat: "a", gapStart: 0 }] });
    const short = { id: "x", scenes: [{ id: "a", state: "s", cues: [{ frame: 0, text: "Hi" }] }] };
    expect(storyTimeline(short, fake(1830)).frames).toBe(1830);
    expect(() => storyTimeline(short, fake(1830), { showcase: true })).toThrow("one-minute");
    expect(() => storyTimeline({ ...short, scenes: [{ ...short.scenes[0], cues: [{ frame: 0, text: "Hi" }, { frame: 40, text: "Too soon" }] }] }, fake(300))).toThrow("2.5 seconds");
    expect(storyMotionSample({ loop: false, frames: Array(210) }, 220)).toBe(209);
    expect(storyMotionSample({ loop: true, frames: Array(48) }, 50)).toBe(2);
  });
  it("composes each film as one continuous, locked-camera performance that changes the story world", async () => {
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { composeFilm, loadShowcaseResources, videoRecipes } = await import("../scripts/site/build-showcase.mjs");
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { renderStoryFrame } = await import("../scripts/site/story-films.mjs");
    const resources = await loadShowcaseResources();
    const [open, caesar] = videoRecipes;
    const films = new Map();
    for (const recipe of videoRecipes) {
      const film = await composeFilm(recipe, resources);
      films.set(recipe.id, film);
      expect(film.performance.frames).toBeLessThanOrEqual(1800);
      expect(film.continuity.maxJointStep).toBeLessThanOrEqual(14);
      expect(film.performance.segments.some((seg: { kind: string }) => seg.kind === "walk")).toBe(true);
      const { timeline } = film;
      expect(timeline.scenes.map((scene: { id: string }) => scene.id)).toEqual(recipe.scenes.map((scene: { id: string }) => scene.id));
      for (const scene of timeline.scenes) for (const cue of scene.cues) {
        expect(cue.endFrame - cue.frame).toBeGreaterThanOrEqual(75);
        const svg = renderStoryFrame(recipe, timeline, scene.startFrame + cue.frame + 15, {}, resources.colors);
        expect(svg).toContain(`data-state="${scene.state}"`);
        expect(svg).toContain('data-camera="locked"');
        expect(svg).toContain('data-style="silent-short-film"');
        expect(svg).toContain(cue.text.split(" ")[0]);
        expect(svg).not.toMatch(/NaN|Infinity|data-stage|Open Source Initiative|<audio/);
      }
    }
    const at = (recipe: { id: string }, id: string, local: number) => {
      const { timeline } = films.get(recipe.id);
      const scene = timeline.scenes.find((item: { id: string }) => item.id === id);
      return renderStoryFrame(recipe, timeline, scene.startFrame + Math.min(local, scene.frames - 1), {}, resources.colors);
    };
    expect(at(open, "need", 120)).toContain("NOT AVAILABLE");
    expect(at(open, "rights", 300)).toContain("USE  ·  STUDY  ·  MODIFY  ·  SHARE");
    expect(at(open, "change", 60)).toContain("MY COPY");
    expect(at(open, "change", 300)).toContain("test_export()  passed");
    expect(at(open, "reuse", 220)).toContain("Shared by many.");
    expect(at(open, "review", 120)).toContain("Show me the test.");
    expect(at(open, "release", 150)).toContain("EXPORT INCLUDED");
    expect(at(caesar, "rubicon", 250)).toContain("CIVIL WAR");
    expect(at(caesar, "power", 150)).toContain("NOT AN EMPEROR");
    expect(at(caesar, "legacy", 200)).toContain("AUGUSTUS");
    expect(at(open, "need", 120)).not.toContain("CIVIL WAR");
  });
  it("qualifies every film motion and refuses unapproved or legacy clips", async () => {
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { createStoryRenderer, composeFilm, loadShowcaseResources, videoRecipes } = await import("../scripts/site/build-showcase.mjs");
    const resources = await loadShowcaseResources();
    for (const recipe of videoRecipes) {
      const renderer = await createStoryRenderer(recipe, resources);
      const authored = renderer.provenance.filter((entry: { kind: string }) => entry.kind === "authored-key-pose");
      expect(authored.length).toBeGreaterThan(5);
      for (const motion of authored) {
        expect(["idle", "walk", "point", "stop", "jump"]).not.toContain(motion.id);
        expect(motion.specSha256).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(renderer.provenance.at(-1)).toMatchObject({ kind: "continuous-composite", camera: "locked" });
      await expect(renderer.render(-1)).rejects.toThrow("outside its timeline");
      await expect(renderer.render(renderer.performance.frames)).rejects.toThrow("outside its timeline");
    }
    const base = videoRecipes[0];
    const using = (motion: string) => ({ ...base, set: [], extras: [], performance: [{ motion, root: 400, beat: base.scenes[0].id }], scenes: [base.scenes[0]] });
    await expect(composeFilm(using("dance"), resources)).rejects.toThrow("not user-approved");
    await expect(composeFilm(using("point"), resources)).rejects.toThrow("legacy fixture");
  });  it("parses the authoritative ledger and excludes unapproved motions", async () => {
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { ledgerMetadata, parseCatalogue } = await import("../scripts/site/catalogue.mjs");
    const source = await fs.readFile(path.resolve("docs", "motion-catalog-plan.md"), "utf8");
    const rows = parseCatalogue(source);
    expect(rows).toHaveLength(100);
    expect(new Set(rows.map((row: { id: string }) => row.id)).size).toBe(100);
    expect(Object.fromEntries([...new Set(rows.map((row: { status: string }) => row.status))].sort()
      .map(status => [status, rows.filter((row: { status: string }) => row.status === status).length])))
      .toEqual({ candidate: 1, rework: 1, "user-approved": 98 });
    const canonical = rows.map((row: { id: string; status: string; family: string }) =>
      `${row.id}\t${row.status}\t${row.family}`).sort().join("\n") + "\n";
    expect(createHash("sha256").update(canonical).digest("hex"))
      .toBe("53362dc2d0e27d4b4468c35a45a30dd487e0e7181311146e6d10b243370484e9");
    expect(ledgerMetadata(rows)).toEqual({
      ledgerCount: 100, ledgerSha256: "53362dc2d0e27d4b4468c35a45a30dd487e0e7181311146e6d10b243370484e9"
    });
    expect(rows.filter((r: { status: string }) => r.status === "user-approved")).toHaveLength(98);
    expect(rows.filter((r: { status: string }) => r.status !== "user-approved").map((r: { id: string }) => r.id).sort()).toEqual(["dance", "roll"]);
    expect(() => parseCatalogue(source.replace("| `idle`", "| `walk`"))).toThrow("100 unique");
  });
  it("keeps pilot approval provenance distinct from engineering authorization", async () => {
    const approval = JSON.parse(await fs.readFile(path.resolve("examples/cloud-deck/approval.json"), "utf8"));
    const renderer = await fs.readFile(path.resolve("scripts/site/render-cloud-deck.mjs"), "utf8");
    expect(approval.approvedBy).toContain("autonomous");
    expect(approval.statement).toContain("not user review");
    expect(approval.statement).toContain("subject to verification and user review");
    expect(renderer).toContain('status:"unapproved-engineering-preview"');
    expect(renderer).toContain("approvalRecorded:false");
  });
  it("reuses runtime baselines and builds keyed previews without mutating specs", async () => {
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { readMotion } = await import("../scripts/site/catalogue.mjs");
    const { RUNTIME_MOTION_LIBRARY } = await import("../src/motion-library");
    for (const id of ["idle", "walk", "stop", "point", "jump"]) {
      const motion = await readMotion(id);
      expect(motion.clip.frames).toEqual(RUNTIME_MOTION_LIBRARY.clips[id]?.frames);
    }
    for (const [id, sourceId] of [["kick", "kick-ball"], ["throw", "throw-ball"], ["pull-banner", "pull-banner-top"]]) {
      const source = await fs.readFile(path.resolve("motions", "specs", `${sourceId}.json`), "utf8");
      const motion = await readMotion(id);
      expect(motion.sourceId).toBe(sourceId);
      expect(motion.clip.poseKeys.length).toBeGreaterThan(0);
      expect(await fs.readFile(path.resolve("motions", "specs", `${sourceId}.json`), "utf8")).toBe(source);
    }
  });
  it("removes development feedback without removing executable prop geometry or provenance", async () => {
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { releaseMotionSpec, readMotion } = await import("../scripts/site/catalogue.mjs");
    const { spec } = await readMotion("video-call");
    const source = structuredClone(spec);
    const release = releaseMotionSpec(spec);
    expect(release).not.toHaveProperty("notes");
    expect(release).not.toHaveProperty("status");
    expect(release).not.toHaveProperty("approvedBaseline");
    expect(release.review).toEqual(spec.review);
    expect(release.source).toEqual(spec.source);
    expect(release.poseKeys).toEqual(spec.poseKeys);
    expect(spec).toEqual(source);
  });
  it("tells a substantive architecture story through actual diagram state changes", async () => {
    // @ts-expect-error Repository presentation authoring helpers are plain JavaScript.
    const { renderStoryFrame } = await import("../scripts/site/stories.mjs");
    const { getStory } = await import("../src/stories.js");
    const palette = { bg: "#f7f4ef", text: "#242424", "text-muted": "#5c5c5c", surface: "#fff", border: "#dedede", accent: "#b11f4b", "accent-soft": "rgba(177,31,75,.08)", "accent-fg": "#fff" };
    for (const [id, start, end] of [
      ["cloud-journey", "application", "confirmed"],
      ["incident-resolution", "primary-failed", "serving-replica"],
      ["deployment-rollout", "traffic-closed", "traffic-open"]
    ]) {
      const story = getStory(id);
      const first = renderStoryFrame(story, 0, palette);
      const final = renderStoryFrame(story, story.animation.durationMs, palette);
      expect(first).toContain(`data-stage="${start}"`);
      expect(final).toContain(`data-stage="${end}"`);
      expect(final).not.toMatch(/one shared timeline|actor moves|Follow the connection|height="390"/);
      expect(final).not.toMatch(/NaN|Infinity/);
      expect(final).toContain(story.title);
    }
    const rollout = getStory("deployment-rollout");
    expect(renderStoryFrame(rollout, 8000, palette)).toContain("GATE CLOSED");
    expect(renderStoryFrame(rollout, 10000, palette)).not.toContain("GATE CLOSED");
    expect(renderStoryFrame(rollout, 0, palette)).toContain("Still on v1");
    expect(renderStoryFrame(rollout, 10000, palette)).toContain("v2 is live");
  });
});
