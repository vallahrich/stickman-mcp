import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKDROP_PRESETS,
  CONTRACT_VERSION_MOVIE,
  SCENE_TRANSITION_KINDS,
  composeMovie,
  exportAnimation,
  isCompiledMovie,
  movieSchema,
  planAnimationExport,
  renderArtifact,
  renderBackdropSvg,
  renderMovieAnimatedSvg,
  renderMovieHtml,
  renderMovieStoryboardSvg,
  renderMovieSvgFrame,
  sampleMovie,
  selectMovieStoryboardBeats,
  type MovieSpecInput
} from "../src/index.js";

function buildIncidentMovie(overrides: Partial<MovieSpecInput> = {}): MovieSpecInput {
  return {
    version: CONTRACT_VERSION_MOVIE,
    title: "Production Incident Response",
    canvas: { width: 1280, height: 720, fps: 30 },
    theme: { accentColor: "#b11f4b" },
    trimIdleTails: true,
    scenes: [
      {
        id: "war-room-triage",
        title: "War Room Triage",
        caption: "P1 alert detected in EU-West telemetry",
        backdrop: "war-room",
        transition: { kind: "fade", durationMs: 400 },
        camera: "auto-director",
        spotlight: "auto",
        durationMs: 6200, // Includes >3s dead idle tail after actions end
        actors: [
          {
            id: "lead",
            x: "center-left",
            color: "#111827",
            accessory: "glasses",
            depth: 0,
            actions: [
              { action: "surprised", durationMs: 900, say: "Error spike on EU-West!" },
              { action: "point", durationMs: 900, emitCue: "triage-assigned", badge: "P1 INCIDENT" },
              { action: "idle", durationMs: 3200 }
            ]
          },
          {
            id: "analyst",
            x: "right",
            color: "#334155",
            depth: 0.4,
            actions: [
              { action: "think", durationMs: 1200, think: "Checking rack 4B logs" }
            ]
          }
        ]
      },
      {
        id: "datacenter-fix",
        title: "Datacenter Remediation",
        caption: "Swapping failed fiber uplink in Aisle 4",
        backdrop: "datacenter",
        transition: { kind: "wipe", durationMs: 450 },
        camera: "auto-director",
        spotlight: true,
        actors: [
          {
            id: "sre",
            x: "left",
            color: "#1e293b",
            accessory: "badge",
            actions: [
              { action: "walk", to: "center", durationMs: 1000 },
              { action: "plug-cable", durationMs: 1200, emitCue: "link-restored", say: "Failover uplink active" }
            ]
          }
        ],
        callouts: [
          { kind: "status", text: "UPLINK VERIFIED", atCue: "link-restored", tone: "success", icon: "check" }
        ]
      },
      {
        id: "office-postmortem",
        title: "Office Recovery",
        caption: "All services healthy — postmortem published",
        backdrop: "office",
        transition: "cut",
        camera: "auto-director",
        actors: [
          {
            id: "lead",
            x: "center",
            color: "#111827",
            accessory: "tie",
            actions: [
              { action: "thumbs-up", durationMs: 900, say: "Zero data loss, great work!" },
              { action: "cheer", durationMs: 1000, emitCue: "incident-closed" }
            ]
          }
        ]
      }
    ],
    ...overrides
  };
}

describe("unified multi-scene movie composer", () => {
  it("exports movie contract version, schema, backdrop presets, and transition kinds", () => {
    expect(CONTRACT_VERSION_MOVIE).toBe("stickman.movie/v1");
    expect(BACKDROP_PRESETS).toEqual([
      "none",
      "office",
      "datacenter",
      "war-room",
      "classroom",
      "court",
      "outdoor"
    ]);
    expect(SCENE_TRANSITION_KINDS).toEqual(["cut", "fade", "wipe"]);
    expect(movieSchema.properties.version.const).toBe(CONTRACT_VERSION_MOVIE);
    expect(movieSchema.properties.scenes.minItems).toBe(1);
    expect(movieSchema.properties.scenes.maxItems).toBe(16);
  });

  it("renders quiet editorial vector backdrops for every preset without scripts", () => {
    expect(renderBackdropSvg("none", 1280, 720, 580)).toBe("");
    for (const preset of BACKDROP_PRESETS) {
      if (preset === "none") continue;
      const svg = renderBackdropSvg(preset, 1280, 720, 580);
      expect(svg).toContain(`data-backdrop="${preset}"`);
      expect(svg).not.toContain("<script");
      expect(svg).toMatch(/#(cbd5e1|e2e8f0)/i);
    }
  });

  it("composes a 3-scene IT incident movie with auto-director, depth, spotlight, transitions, and dead-air trimming", () => {
    const trimmedResult = composeMovie(buildIncidentMovie({ trimIdleTails: true }));
    expect(trimmedResult.valid, JSON.stringify(trimmedResult.diagnostics)).toBe(true);
    expect(trimmedResult.movie).toBeDefined();

    const movie = trimmedResult.movie!;
    expect(isCompiledMovie(movie)).toBe(true);
    expect(movie.contractVersion).toBe(CONTRACT_VERSION_MOVIE);
    expect(movie.scenes).toHaveLength(3);
    expect(movie.scenes.map((s) => s.backdrop)).toEqual(["war-room", "datacenter", "office"]);
    expect(movie.scenes.map((s) => s.transition.kind)).toEqual(["fade", "wipe", "cut"]);

    // Verify 3s trailing idle gap in scene 0 was trimmed cleanly while preserving >= 350ms settle tail
    const s0 = movie.scenes[0]!;
    expect(s0.trimmedIdleMs).toBeGreaterThan(2500);
    expect(s0.durationMs).toBeGreaterThanOrEqual(2150);
    expect(s0.durationMs).toBeLessThan(3500);

    // Compare against trimIdleTails: false
    const untrimmedResult = composeMovie(buildIncidentMovie({ trimIdleTails: false }));
    expect(untrimmedResult.valid).toBe(true);
    expect(untrimmedResult.movie!.scenes[0]!.durationMs).toBe(6200);
    expect(untrimmedResult.movie!.scenes[0]!.trimmedIdleMs).toBe(0);

    // Contiguous global timeline offsets
    expect(movie.scenes[0]!.startMs).toBe(0);
    expect(movie.scenes[1]!.startMs).toBe(movie.scenes[0]!.endMs);
    expect(movie.scenes[2]!.startMs).toBe(movie.scenes[1]!.endMs);
    expect(movie.durationMs).toBe(movie.scenes[2]!.endMs);

    // Global events carry sceneId and shifted global timeMs
    const sceneIdsInEvents = new Set(movie.events.map((e) => e.sceneId));
    expect(sceneIdsInEvents.has("war-room-triage")).toBe(true);
    expect(sceneIdsInEvents.has("datacenter-fix")).toBe(true);
    expect(sceneIdsInEvents.has("office-postmortem")).toBe(true);
    const linkEvent = movie.events.find((e) => e.marker === "link-restored");
    expect(linkEvent).toBeDefined();
    expect(linkEvent!.sceneId).toBe("datacenter-fix");
    expect(linkEvent!.timeMs).toBeGreaterThanOrEqual(movie.scenes[1]!.startMs);
  });

  it("samples deterministically across scenes, captions, and fade/wipe transition windows", () => {
    const { movie } = composeMovie(buildIncidentMovie());
    expect(movie).toBeDefined();
    const compiled = movie!;

    // Scene 0 opening + scene caption merged into callouts
    const f0A = sampleMovie(compiled, 200);
    const f0B = sampleMovie(compiled, 200);
    expect(f0A).toEqual(f0B);
    expect(f0A.sceneId).toBe("war-room-triage");
    expect(f0A.sceneIndex).toBe(0);
    expect(f0A.backdrop).toBe("war-room");
    expect(f0A.callouts?.some((c) => c.kind === "caption" && c.text.includes("P1 alert"))).toBe(true);
    expect(f0A.transitionOverlay).toBeUndefined();

    // Fade transition window near end of scene 0
    const s0 = compiled.scenes[0]!;
    const fadeSample = sampleMovie(compiled, s0.endMs - s0.transition.durationMs / 2);
    expect(fadeSample.sceneId).toBe("war-room-triage");
    expect(fadeSample.transitionOverlay).toBeDefined();
    expect(fadeSample.transitionOverlay!.kind).toBe("fade");
    expect(fadeSample.transitionOverlay!.nextSceneId).toBe("datacenter-fix");
    expect(fadeSample.transitionOverlay!.progress).toBeGreaterThan(0.1);
    expect(fadeSample.transitionOverlay!.progress).toBeLessThan(0.9);

    // Wipe transition window near end of scene 1
    const s1 = compiled.scenes[1]!;
    const wipeSample = sampleMovie(compiled, s1.endMs - s1.transition.durationMs / 2);
    expect(wipeSample.sceneId).toBe("datacenter-fix");
    expect(wipeSample.transitionOverlay).toBeDefined();
    expect(wipeSample.transitionOverlay!.kind).toBe("wipe");
    expect(wipeSample.transitionOverlay!.nextSceneId).toBe("office-postmortem");
    expect(wipeSample.transitionOverlay!.progress).toBeGreaterThan(0.1);
    expect(wipeSample.transitionOverlay!.progress).toBeLessThan(0.9);

    // Final scene at exact durationMs
    const finalFrame = sampleMovie(compiled, compiled.durationMs);
    expect(finalFrame.sceneId).toBe("office-postmortem");
    expect(finalFrame.sceneIndex).toBe(2);
    expect(finalFrame.transitionOverlay).toBeUndefined();
  });

  it("validates duplicate scene ids, empty scenes, bad backdrops/transitions, and nested choreography errors", () => {
    const empty = composeMovie({ scenes: [] });
    expect(empty.valid).toBe(false);
    expect(empty.diagnostics.some((d) => d.code === "empty_scenes")).toBe(true);

    const dup = composeMovie({
      scenes: [
        { id: "dup", actions: [{ action: "wave", durationMs: 800 }] },
        { id: "dup", actions: [{ action: "nod", durationMs: 800 }] }
      ]
    });
    expect(dup.valid).toBe(false);
    expect(dup.diagnostics.some((d) => d.path === "scenes[1].id" && d.code === "duplicate_scene_id")).toBe(true);

    const invalid = composeMovie({
      scenes: [
        {
          id: "bad-scene",
          backdrop: "volcano" as never,
          transition: "dissolve" as never,
          actions: [{ action: "nonexistent-action-xyz", durationMs: 800 }]
        }
      ]
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.diagnostics.some((d) => d.path === "scenes[0].backdrop")).toBe(true);
    expect(invalid.diagnostics.some((d) => d.path === "scenes[0].transition")).toBe(true);
    expect(invalid.diagnostics.some((d) => d.path.startsWith("scenes[0]."))).toBe(true);
  });

  it("renders deterministic SVG frames, animated SVG, multi-scene storyboard, and valid HTML player", () => {
    const { movie } = composeMovie(buildIncidentMovie());
    const compiled = movie!;
    const s0 = compiled.scenes[0]!;
    const s1 = compiled.scenes[1]!;

    // SVG frames (static + transition frames) have zero <script> tags
    const frame0 = renderMovieSvgFrame(compiled, 300);
    const frame0Again = renderMovieSvgFrame(compiled, 300);
    expect(frame0).toBe(frame0Again);
    expect(frame0).toContain('data-movie-scene="war-room-triage"');
    expect(frame0).toContain('data-backdrop="war-room"');
    expect(frame0).not.toContain("<script");

    const fadeFrame = renderMovieSvgFrame(compiled, s0.endMs - 200);
    expect(fadeFrame).toContain('data-transition="fade"');
    expect(fadeFrame).not.toContain("<script");

    const wipeFrame = renderMovieSvgFrame(compiled, s1.endMs - 200);
    expect(wipeFrame).toContain('data-transition="wipe"');
    expect(wipeFrame).not.toContain("<script");

    // Animated SVG has zero <script> tags and includes all scenes
    const animatedSvg = renderMovieAnimatedSvg(compiled);
    expect(animatedSvg).toContain("<svg");
    expect(animatedSvg).toContain('data-scene="war-room-triage"');
    expect(animatedSvg).toContain('data-scene="datacenter-fix"');
    expect(animatedSvg).toContain('data-scene="office-postmortem"');
    expect(animatedSvg).not.toContain("<script");

    // Storyboard covers all 3 scenes proportionally with S1/S2/S3 scene badges
    const beats = selectMovieStoryboardBeats(compiled, 9);
    expect(new Set(beats.map((b) => b.sceneIndex))).toEqual(new Set([0, 1, 2]));
    const storyboard = renderMovieStoryboardSvg(compiled, { maxPanels: 9, columns: 3 });
    expect(storyboard).not.toContain("<script");
    expect(storyboard).toContain("S1 · 0.00s");
    expect(storyboard).toMatch(/S2 · \d+\.\d{2}s/);
    expect(storyboard).toMatch(/S3 · \d+\.\d{2}s/);

    // HTML player contains valid parseable JS (verified via new Function) and scene chapter buttons
    const html = renderMovieHtml(compiled);
    expect(html).toContain('id="stickman-movie-player"');
    expect(html).toContain('data-scene-id="war-room-triage"');
    expect(html).toContain('data-scene-id="datacenter-fix"');
    expect(html).toContain('data-scene-id="office-postmortem"');
    const scriptMatch = /<script id="stickman-movie-player">([\s\S]*?)<\/script>/.exec(html);
    expect(scriptMatch).not.toBeNull();
    expect(() => new Function(scriptMatch![1]!)).not.toThrow();
  });

  it("exports CompiledMovie seamlessly via renderArtifact and exportAnimation", async () => {
    const { movie } = composeMovie(buildIncidentMovie());
    const compiled = movie!;

    expect(planAnimationExport(compiled, "mp4").estimatedWork.frameCount).toBeGreaterThan(30);
    expect(renderArtifact(compiled, "svg-frame", { timeMs: 100 })).toContain('data-movie-scene="war-room-triage"');
    expect(renderArtifact(compiled, "svg")).toContain("sm-slice");
    expect(renderArtifact(compiled, "storyboard-svg", { maxPanels: 6 })).toContain("S1 · 0.00s");
    expect(renderArtifact(compiled, "html")).toContain("stickman-movie-player");

    const root = await mkdtemp(resolve(".movie-export-test-"));
    try {
      const sb = await exportAnimation(compiled, root, "incident-storyboard.svg", "storyboard-svg", { maxPanels: 6 });
      expect(sb.bytes).toBeGreaterThan(500);
      expect(await readFile(join(root, sb.path), "utf8")).toContain("S1 · 0.00s");

      const htmlRes = await exportAnimation(compiled, root, "incident-player.html", "html");
      expect(htmlRes.bytes).toBeGreaterThan(1000);

      // Verify raster/video export path invokes renderMovieSvgFrame and encoder cleanly
      let rasterizedFrames = 0;
      const mp4Res = await exportAnimation(compiled, root, "incident.mp4", "mp4", {
        loadResvg: async () => ({
          Resvg: class FakeResvg {
            constructor(private readonly svg: string) {
              expect(svg).toContain("data-movie-scene=");
            }
            render() {
              rasterizedFrames++;
              return { asPng: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
            }
          }
        }),
        runEncoder: async (args) => {
          const outFile = args[args.length - 1]!;
          const { writeFile } = await import("node:fs/promises");
          await writeFile(outFile, Buffer.from("fake-mp4-bytes"));
        }
      });
      expect(rasterizedFrames).toBeGreaterThan(30);
      expect(mp4Res.format).toBe("mp4");
      expect(mp4Res.bytes).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
