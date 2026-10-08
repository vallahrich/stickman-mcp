# Faster motion authoring

Phase 3 adds an engine-native key-pose workflow for getting a new motion to a mechanically checked draft quickly. It is a pose authoring aid, not text-to-motion generation or approval automation.

## Reusable pose library

`motions/poses/poses.json` contains named poses in the same shape used by a motion spec's `poseKeys[].pose`. Each item records its source spec id, source status, key frame, and SHA-256 of the exact source spec. Regenerate it deterministically after changing sources with `npm run motions:poses`. The current names are `stand`, `stand-arms-down`, `crouch`, `step-forward`, `kneel-lowering`, `kneel-contact`, `kneel`, `sit`, `lie-face-down`, `reach-forward`, `reach-up`, `point`, `strike`, `carry`, `hands-on-hips`, `arms-crossed`, `wave-up`, `think`, and `bow`.

At present the five `user-approved` baseline specs contain no authored `poseKeys`; therefore the library uses pose keys from authored candidate specs as building blocks and records their `candidate` provenance. This does not change those specs' statuses or qualify them for films. Keep the approval boundary explicit: only user-approved motions are film assets.

## MCP tools

`stickman_author_motion` takes `id`, `label`, `kind`, `view`, `travel`, `keys`, and a new relative `outputDir` under the server `--root`. Each key specifies a `frame`, library pose name, and optional per-joint overrides (for example `{"rArm.shoulder": 25, "lean": 4}`). Keys must be strictly ordered, begin at frame 0, and end at the final one-shot frame. Optional `frames`, `hold`, `easing`, `props`, `tags`, and `notes` control duration and metadata. The tool writes a `status: "draft"` spec in `motions/specs/<id>.json` and a sampled PNG strip in the requested output directory. It refuses to replace any existing candidate, approved, or user-approved spec; only an existing draft may be revised.

The result includes the existing `keyPoseGates` anatomy/contact/joint-step report and a second maximum joint step sampled at film scale 2.4, compared with the continuity limit of 14. A failed report does not promote the motion. `stickman_preview_motion` reads a draft, candidate, or approved motion and renders a sampled PNG strip into a new confined output directory without changing its spec. The tool accepts a sample count from 2 to 24.

New drafts remain unavailable to film recipes: composition still accepts only explicitly user-approved motions. Previewing a draft is the sole exception and does not grant approval. The reusable core is in `scripts/motions/authoring.mjs`; `src/motion-authoring.ts` applies the MCP output-root confinement.

## Fast start

```json
{
  "id": "my-new-motion",
  "label": "A respectful bow",
  "kind": "oneshot",
  "view": "side",
  "travel": "in-place",
  "frames": 60,
  "keys": [
    { "frame": 0, "pose": "stand", "easing": "out" },
    { "frame": 20, "pose": "bow", "overrides": { "lean": 28 }, "easing": "inOut" },
    { "frame": 59, "pose": "bow", "easing": "hold" }
  ],
  "outputDir": "motion-previews/my-new-motion"
}
```

Inspect the strip, iterate on the key timing/overrides, and rerun the authoring tool. The result is still a draft; use the established motion review and explicit approval process before using it in a film.
