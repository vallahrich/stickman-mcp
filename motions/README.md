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

## Authored key-pose arm spread

Authored `poseKeys` support optional per-arm frontal-plane abduction:

```json
"rArm": { "shoulder": 35, "elbow": 55, "spread": 35, "elbowSpread": 20 }
```

- `spread` is the upper-arm angle out sideways from the body, in degrees.
- `elbowSpread` adds extra sideways angle to the forearm.
- Both values interpolate like `shoulder` and `elbow`.
- The spread is fully visible in front view (`facing: 0`), fades in three-quarter views, and vanishes in pure side view. Omit both fields to preserve the legacy sagittal-plane arm projection exactly.

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

Office and inspection props have distinct silhouettes rather than rectangle placeholders:

| Prop | Default local size | Animated detail |
| --- | --- | --- |
| `laptop` | 48 x 34 | `open` from 0 to 1 hinges the lid above the keyboard/base |
| `tablet` | 22 x 30 | Framed screen with interface marks |
| `magnifier` | 24 x 34 | Transparent lens, rim and handle |
| `notebook` | 30 x 36 | `ink` from 0 to 1 reveals writing on ruled pages |
| `pen` | 4 x 22 | Separate body and nib |

Catalog or authored `w`/`h` values override these defaults. These props support
placement, `color`, `rot`, `scale`, lifecycle/fade and hand attachment. Attached
magnifiers grip at `(0.76 * w, 0.83 * h)` and pens at `(0.5 * w, 0.42 * h)`;
the other new props use their center. Pens follow the holding forearm plus
authored rotation. Animate primary/extra props with `propMotion`, and add-ons
with their `keys`. These capabilities belong to the review renderer and its
standalone stage kit, not automatic runtime MCP prop integration.

Hardware and UI review props use the same transforms, colors, lifecycle and
key-animation paths:

| Prop | Default local size | Attached grip |
| --- | --- | --- |
| `cable` | 64 x 32 | Plug tip at `(0.85 * w, 0.2 * h)` |
| `socket` | 18 x 22 | Center |
| `server-rack` | 64 x 120 | Center |
| `server-module` | 52 x 16 | Center |
| `window` | 80 x 54 | Titlebar at `(0.42 * w, 0.12 * h)` |
| `cursor` | 12 x 18 | Tip at `(0, 0)` |

Cable keys may animate `plugX`, `plugY` and `plugRot` independently of its tail.
These are local endpoint offsets, with positive `plugY` upward and `plugRot`
in degrees. Attaching the plug to a hand preserves the tail rather than moving
the entire cable as a rigid rectangle. Pair it with `socket` for insertion.
Use a separately animated `server-module` with the rack for extraction or
insertion. Pair `window` and `cursor` for titlebar dragging; the window has a
titlebar and distinct content regions, not just an outlined box.

Door props render as a static doorway frame plus a hinged leaf. Add `review.prop.hinge:
"left"|"right"` to choose the hinge edge (default is the far edge from the approaching
figure). Door `propMotion` keys may also include `open` (0 = closed, 1 ≈ 90° open);
`open` interpolates between keys like `x`/`y` while existing sliding `x`/`y` behavior
continues to work for all props. For through-door review shots, door keys may include
`fade` (1 visible, 0 hidden) to fade the stick figure as it enters the doorway.

Hand-owned props can use `review.prop.attach`. In addition to `hand:"r"|"l"|"head"`,
`hand:"both"` centers the prop between both hands; this is intended for small props
such as `binoculars`, drawn as two short barrels and a bridge.
`palm` is another hand-owned prop for stop/wait poses: it draws a short open-hand bar
at the wrist, perpendicular to the forearm, with small finger ticks. Use
`hiddenBefore`/`hiddenAfter` with `from`/`to` to limit it to the hold beats.
`thumb` is a compact thumbs-up hand prop: a small fist circle at the wrist with a
short thumb stroke perpendicular to the forearm, intended for `attach.hand:"r"` or
`"l"` on thumbs-up holds.

Board props support `propMotion` key `ink` (0..1), revealing a handwritten scribble,
underline, and checkmark over time. Author the writing hand targets at the current
ink tip so the visible stroke and hand stay connected.

Desk props support optional `review.prop.monitorW` and `review.prop.monitorH`
values (in authored motion units) to override the monitor screen size while leaving
the tabletop, chair, keyboard, and default monitor proportions unchanged when omitted.
Set `review.prop.screen: "video-call"` for a remote participant silhouette and call
controls instead of the default screen lines. This is opt-in review/stage-kit
decoration, not a shipping MCP runtime prop or a video feed. Desk extra props support
the same field; omitted or unrecognized values preserve the existing screen.
The participant is an arm-free head-and-shoulders bust with a gentle nod sampled
from the review frame, so scrubbing, static shots and standalone stage kits agree.

Opt-in laptop `details: true` adds individual keys, touchpad, webcam and screen
content without changing the lid, base or hinge coordinates.
Notebook `handwriting: true` uses original connected strokes; exported
`notebookStrokePoint(lineIndex, progress)` supplies the exact normalized nib target
for each of the four ink lines.

Review-only `headphones` (42x40), `detective-hat` (46x20) and `thought-cloud`
(52x36) accept the same colored office-prop transforms, lifecycle and animation
tracks as other office props. `anger-mark` (28x28) draws an original four-corner
anger-vein symbol and jagged agitation lines, without a thought bubble or tail.
Its `color` controls both strokes; primary props, extra props and add-ons are supported.
Use actual rendered-head coordinates when tracking
headwear, because the shipping renderer normalizes the sampled neck.
`propMotion.x/y` are offsets added to the prop's base position; set base `x: 0,
y: 0` for absolute per-frame tracks. `front: true` paints headwear in front of
the figure rather than behind it.

Bulb props support `propMotion` key `scale`, useful for an idea pop
(`0 -> 1.1 -> 1`). The bulb is drawn as glass, screw base, filament, and glow rays.