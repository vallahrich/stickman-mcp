# Motion factory

The factory is intentionally per-motion now: each motion gets tuned and reviewed in its own dev cycle before it ships.

## Layout

- `motions/specs/<id>.json` is the source of truth for one motion: CMU source/range, kind, travel/view, semantic expectations, contacts/prop, notes, and review `status`.
- `motions/catalog.json` is a generated-style index of the spec files for discovery.
- `src/generated/motion-library.ts` is generated data consumed by the engine.
- Session review outputs are written to `S\motion-factory\clips\<id>\`:
  - `clip.json`
  - `report.json`
  - `review.html`

Raw BVH files remain cache inputs only (`MOTION_SOURCE_DIR`, defaulting to the session mocap cache) and must not be committed.

## Status flow

- `draft`: candidate can be built/reviewed, but is not shipped.
- `ai-reviewed`: candidate is ready for preview assembly with `--include-candidates`.
- `user-approved`: shipped by default.
- `rejected`: excluded until a new source/range is chosen.

The approved baselines `walk`, `run`, `jump`, `stop`, `point`, and `idle` are immutable and are copied verbatim from the approved session clip cache.

## Commands

Build one motion review package:

```powershell
npm run motions:build -- --only <id>
```

This emits the standard `review.html` using the shipping Pivot renderer (`dist/render.js` geometry plus the `dist/motion-clips.js` clip-frame sampler). The page includes the candidate, prop overlay, run reference at the same scale, play/pause, speed `0.1x/0.25x/0.5x/1x`, onion skin, frame slider, and frame number. Deterministic review URLs support:

```text
review.html?frame=N&onion=0&bare=1
```

Generate standard screenshots instead of hand-rolling Playwright:

```powershell
npm run motions:shots -- --only <id> --frames 0,20,40
npm run motions:shots -- --only <id> --frames 0,20,40 --strip
```

JPEGs are written to `S\motion-factory\clips\<id>\shots\` at about `1000x700`, quality 70. `--strip` also writes one horizontal filmstrip JPEG for the requested frames. Set `STICKMAN_SESSION_FILES` (or `MOTION_SESSION_FILES`) to override `S`; otherwise the local session-state path is used.

Assemble the shipped library (baselines + `user-approved` specs only):

```powershell
npm run motions:assemble
```

Assemble a preview library including `ai-reviewed` candidates:

```powershell
npm run motions:assemble -- --include-candidates
```

Validate the generated library:

```powershell
npm run motions:check
```

Per-motion builds write only to that motion's output directory, so separate agents can work on different motion ids in parallel.

## How to perfect one motion

1. Pick one `motions/specs/<id>.json`; do not edit shared pipeline code.
2. Adjust `source.range120`, `view`, `expect`, and `processing`.
3. If that is not enough, add `scripts/motions/hooks/<id>.mjs` for motion-specific fixes.
4. Run `npm run motions:build -- --only <id>`.
5. Open `S\motion-factory\clips\<id>\review.html`; inspect normal speed, `0.25x`, scrub, onion skin, prop alignment, filmstrip, and the run reference.
6. Add/adjust `extraGates` until the motion-specific promise is measurable.
7. Move `status` from `draft` to `ai-reviewed`, then to `user-approved` only after user approval.
8. Run `npm run motions:assemble` and `npm run motions:check`.

## Spec `processing` options

```json
{
  "processing": {
    "smoothingCutoff": 1,
    "lockEaseFrames": 3,
    "easeInFrames": 4,
    "easeOutFrames": 4,
    "timeScale": 1,
    "mirror": false,
    "view": "side",
    "axis": "auto",
    "trim": [0, 89]
  }
}
```

- `smoothingCutoff`: integer smoothing passes; use the smallest value that removes mocap twitch.
- `lockEaseFrames`: contact-lock ease window documented for hook implementations.
- `easeInFrames` / `easeOutFrames`: blend cut ends toward the approved idle stance.
- `timeScale`: must be `<= 1`; slow down rather than speeding mocap up.
- `mirror`: swap left/right limbs and contacts.
- `view`: per-motion projection hint (`side` or `front`).
- `axis`: optional projection-axis override when `auto` chooses poorly.
- `trim`: frame range within the current candidate clip after projection/retarget.

## Per-motion hooks

Optional hooks live at `scripts/motions/hooks/<id>.mjs` and may export:

```js
export function afterProject(frames, ctx) { return frames; }
export function afterRetarget(frames, ctx) { return frames; }
export function afterContacts(frames, ctx) { return frames; }
export function beforeSmooth(frames, ctx) { return frames; }
export function afterSmooth(frames, ctx) { return frames; }
export function finalize(clip, ctx) { return clip; }
export function extraGates(clip, ctx) {
  return [{ name: "readable-pose", value: 1, threshold: 1, pass: true }];
}
```

`ctx` includes `spec`, `processing`, per-motion paths, approved `idle`, and `helpers`: FK notes, wrap-aware angle math, smoothing, contact-lock placeholder, idle ease-in/out, two-bone IK, resampling, and cloning utilities.

## Review props

If a spec declares `prop`, the standard review page draws the matching entry from `S\design\props.json` in the same Pivot stroke style. Optional review placement:

```json
{
  "review": {
    "prop": { "x": 145, "y": 64, "w": 82, "h": 62 },
    "propMotion": [
      { "frame": 0, "x": 0, "y": 0 },
      { "frame": 30, "x": 24, "y": 0 }
    ]
  }
}
```

When omitted, the page uses the prop's default size and a deterministic default position.