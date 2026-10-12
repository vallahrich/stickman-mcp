import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
import fs from "node:fs/promises";
import { brief, storyboard } from "../scripts/site/presentation-020-inputs.mjs";

describe("MCP 0.2.0 isolated presentation test", () => {
  it("keeps a new three-layout proposal with no invented facts or real consent", () => {
    expect(brief.facts).toEqual([]);
    expect(storyboard.slides.map(s => s.id)).toEqual(brief.outline.map(s => s.slideId));
    expect(new Set(storyboard.slides.map(s => s.layout)).size).toBe(3);
    expect(storyboard.pilotIds).toEqual(storyboard.slides.map(s => s.id));
    expect(storyboard.slides.every(s => s.headlineKind === "proposal")).toBe(true);
    expect(storyboard.slides[1].scene.flow.choreography).toBe("handoff");
    expect(storyboard.slides[1].scene.staticDescription).toContain("not real consent");
  });
  it("has a syntax-valid offline provider with cancellation and finite playback", async () => {
    const client = await fs.readFile("scripts\\site\\presentation-020-client.js", "utf8");
    expect(() => new Script(client)).not.toThrow();
    expect(client).toContain("cancelAnimationFrame");
    expect(client).toContain('adapterVersion: "1.0"');
    expect(client).toContain("frame < film.frames.length - 1");
    expect(client).not.toMatch(/fetch\(|XMLHttpRequest/);
  });
});
