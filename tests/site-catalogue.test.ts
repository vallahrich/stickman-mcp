import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

describe("private designer catalogue", () => {
  it("labels rejected presentation treatments as historical experiments without release ratings", async () => {
    const html = await fs.readFile(path.resolve("site", "index.html"), "utf8");
    const comparison = html.split('id="comparison"')[1]?.split("</section>")[0];
    expect(comparison).toContain("Historical comparison experiment");
    expect(comparison).toContain("not as proof of presentation improvement");
    expect(comparison).toContain("https://csrc.nist.gov/presentations/2023/nist-cybersecurity-framework-csf-20");
    expect(comparison).not.toContain("enhanced");
    expect(html).not.toMatch(/\b\d+(?:\.\d+)?\/10\b/);
  });
  it("parses the authoritative ledger and excludes unapproved motions", async () => {
    // @ts-expect-error Repository authoring helpers are intentionally plain JavaScript.
    const { parseCatalogue } = await import("../scripts/site/catalogue.mjs");
    const source = await fs.readFile(path.resolve("docs", "motion-catalog-plan.md"), "utf8");
    const rows = parseCatalogue(source);
    expect(rows).toHaveLength(100);
    expect(rows.filter((r: { status: string }) => r.status === "user-approved")).toHaveLength(98);
    expect(rows.filter((r: { status: string }) => r.status !== "user-approved").map((r: { id: string }) => r.id).sort()).toEqual(["dance", "roll"]);
    expect(() => parseCatalogue(source.replace("| `idle`", "| `walk`"))).toThrow("100 unique");
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
  it("renders a moving actor inside the deck and reveals content only after arrival", async () => {
    // @ts-expect-error Repository presentation authoring helpers are plain JavaScript.
    const { renderDeckScene, deckScenes, sceneDurationMs } = await import("../scripts/site/deck-scenes.mjs");
    const palette = { bg: "#f7f4ef", text: "#242424", "text-muted": "#5c5c5c", surface: "#ffffff", border: "#dedede", accent: "#b11f4b", "accent-soft": "rgba(177,31,75,.08)" };
    expect(sceneDurationMs).toBe(15000);
    expect(deckScenes.map((s: { page: number }) => s.page)).toEqual([1, 2, 4, 5]);
    for (let index = 0; index < deckScenes.length; index++) {
      const start = renderDeckScene(index, 0, palette);
      const arrival = renderDeckScene(index, 4400, palette);
      const end = renderDeckScene(index, 14999, palette);
      expect(start).toContain('data-actor="inside-slide"');
      expect(start).toContain('data-actor-x="140.000"');
      expect(arrival).toContain('data-beat="1"');
      expect(end).toContain('data-actor-x="1140.000"');
      expect(start).not.toMatch(/NaN|Infinity/);
      expect(end).not.toMatch(/NaN|Infinity/);
      expect(renderDeckScene(index, 3000, palette)).toContain('data-beat="0"');
    }
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
