# Faster motion authoring

Phase 3 adds an engine-native key-pose workflow for getting a new motion to a mechanically checked draft quickly. It is a pose authoring aid, not text-to-motion generation or approval automation.

## Reusable pose library

`motions/poses/poses.json` contains named poses in the same shape used by a motion spec's `poseKeys[].pose`. Each item records its source spec id, source status, key frame, and SHA-256 of the exact source spec. Regenerate it deterministically after changing sources with `npm run motions:poses`. The current names are `stand`, `stand-arms-down`, `crouch`, `step-forward`, `kneel-lowering`, `kneel-contact`, `kneel`, `sit`, `lie-face-down`, `reach-forward`, `reach-up`, `point`, `strike`, `carry`, `hands-on-hips`, `arms-crossed`, `wave-up`, `think`, and `bow`.

Each extracted pose records its source status and fingerprint. Reusing a pose
does not change its source spec's status or qualify a new sequence for films.
Keep the approval boundary explicit: only user-approved, mechanically qualified
motions are film assets.

## MCP tools

`stickman_author_motion` takes `id`, `label`, `kind`, `view`, `travel`, `keys`, and a new relative `outputDir` under the server `--root`. Each key specifies a `frame`, library pose name, and optional per-joint overrides (for example `{"rArm.shoulder": 25, "lean": 4}`). Keys must be strictly ordered, begin at frame 0, and end at the final one-shot frame. Optional `frames`, `hold`, `easing`, `props`, `tags`, and `notes` control duration and metadata. The tool writes a `status: "draft"` spec as `<outputDir>/<id>.json` alongside its PNG strip. The installed library is never modified; packaged candidate, approved and user-approved IDs remain protected. Iteration uses a different new outputDir.

The result includes the existing `keyPoseGates` anatomy/contact/joint-step report and a second maximum joint step sampled at film scale 2.4, compared with the continuity limit of 14. A failed report does not promote the motion. `stickman_preview_motion` reads a draft, candidate, or approved motion and renders a sampled PNG strip into a new confined output directory without changing its spec. The tool accepts a sample count from 2 to 24.

To read a draft, set `draftDir` to the author's outputDir under --root. Omit it
to read the packaged library. Draft directory traversal and symlinks are refused.

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
