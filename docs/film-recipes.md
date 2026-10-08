# Films via MCP (Phase 1)

Describe a scene as **validated data**, then compose before rendering. The new
film tools expose the same locked-camera continuous-performance implementation
as the two showcase films; they do not synthesize new motions or execute code in
recipes. Complete scenes still need visual review, not just mechanical passes.

## Tools and execution

Run `npm run build`, then configure the stdio server as
`node dist\mcp.js --root C:\approved-output`. Its three film tools are:

- `stickman_list_film_assets({})`: qualified, user-approved authored motion IDs,
  frame counts and `oneshot`/`loop`/`travel` kinds; kits, headwear, places, set prop
  types and overlay types. Also returns `recipeSchema`, the strict JSON Schema.
  Film assets are distinct from the older runtime action vocabulary.
- `stickman_compose_film({recipe})`: validates and composes lead and supporting
  actors, returning `frames`, `seconds`, `fps: 30`, scene start/frame ranges,
  per-recipe-item ranges (inclusive ends; zero-duration relocates are marked
  `instantaneous`) and `continuity.lead` / `continuity.actors`. Each report gives
  max joint step, limit **14**, worst frame and surrounding motion/item join.
  Scene starts include the blend leading into their first performance item.
- `stickman_render_film({recipe, outputDir, preview?, qaFrames?})`: same validation
  and continuity gates, silent H.264 MP4, poster PNG, WebVTT and optional QA sheet
  PNG. `outputDir` is required, **relative to `--root`**, and must not already
  exist. Absolute paths, traversal, existing files/directories and symlink
  parents are refused using the existing export path resolver. A fresh directory
  is reserved exclusively and removed on failure. No recipe-supplied filenames,
  SVG, paths, callbacks or shell arguments are accepted. Results include files,
  encoded-media SHA256 and source/continuity provenance.

Normal output is 1280x720 at 30 fps. `preview: true` samples every second source
frame at 640x360 and encodes at 15 fps; its duration is preserved to within one
preview frame, not sped up. `qaFrames` is 1–24 evenly sampled frames including
endpoints (one sample uses frame 0). Preview still performs full composition and
continuity QA. Rendering a full minute can take several minutes; configure your
MCP client request timeout accordingly. Captions and QA images use the original 30-fps timeline.
The renderer needs the optional `ffmpeg-static` and `@resvg/resvg-js` dependencies;
it does not require a browser or external service.

All tools follow the existing `{result: ...}` / `{error: {code,message}}` MCP
structured-content convention. Invalid JSON types/unknown keys are
`invalid_arguments`; semantic errors (unknown motion, missing scene beat,
unsupported item options, invalid authored `until`, duration or continuity)
return `execution_error` with the offending path/frame/join in the message.
No rendering occurs when composition fails. Every cue must start at local frame
0 or the next ordered cue and have at least **75 frames** of reading time; total
lead and individual actor performances must not exceed **1800 frames**.

## Recipe contract

The authoritative schema is `src\film-schema.ts`, also discoverable in the assets
result. Every object rejects unknown keys, including nested walks, overlays and
tweens. Optional arrays default empty. Required top-level fields:

| Field | Meaning |
| --- | --- |
| `id`, `title` | Safe lowercase-hyphenated ID (up to 64 chars), human title |
| `performance` | Nonempty ordered lead performance items |
| `scenes` | Ordered, unique `{id,title,place,cues}` scene definitions |
| `summary`, `poster` | Optional summary and original-timeline poster frame |
| `set` | Optional `{motion,root,types,hideDuring?}` fixed prop set pieces |
| `extras` | Optional independent motion/continuous supporting actor entries |

### Performances

An item has exactly one of `motion`, `walk`, `relocate`:

- `{motion:"wave", root:400, beat:"welcome", hold:90}`: an approved authored
  clip. The first motion requires `root` unless preceded by `relocate`. Later
  roots are rejected; the pelvis is pinned automatically. `hold` adds frames at
  the end. `cycles` (1–20) is for loop clips only. `until` trims a one-shot on an
  **authored key frame**, not any arbitrary frame. `keep` lists known prop types.
- `{walk:{to:700, pace:18}, beat:"arrival"}`: generated, mechanically gated
  walk toward the next motion's start pose. Needs an established starting root
  and a later motion. `to` is in film pixels; pace is frames per half-step
  (8–60). The current gait requires at least 48 units of travel; very short
  walks should be restaged, not replaced with teleportation.
- `{relocate:-80}`: instant staging relocation for the following item, normally
  off-screen. Only `beat` is additionally allowed. This is an **intentional cut**,
  excluded from joint-step comparisons at its frame, not an automatic transition.
  A terminal relocate is rejected.

Motion/walk items can carry `beat` (lead only), `gap` (1–180 blend frames), `hold`,
`fadeOut`, `keep`, `laurel`, or `headwear:"laurel"|"none"` (not both laurel and
headwear). Walks do not accept `cycles`, `until` or `root`. Each scene must have
one lead beat in scene order; scene 1 begins at frame 0. Frame fields are integers
0–1800, roots/tween positions are finite bounded film-pixel coordinates.

### Scenes, cues and extras

`place` is `office`, `city`, `senate`, `gaul` or `rubicon`. Different places dissolve
at scene boundaries, with no moving camera. `state` defaults to scene ID. Cues
are ordered `{frame,text}` values in **local scene frames**, starting at zero;
text is burned in and exported to captions. Keep text short and readable (at
most two caption lines). Scenes may include an `overlays` array.

Extras require `from` and `until` scene IDs (inclusive scene window):

- Motion extra: `{motion:"nod", root:850, scale:0.55, from:"welcome", until:"ready", delay:12}`.
  Loops repeat; one-shots hold their last frame.
- Actor extra: `{actor:[{motion:"nod",root:850,hold:200}],scale:0.55,...}`.
  Each actor uses the same composition/continuity gates as the lead. Optional
  `kit:"legionary"|"standard"|"dagger"`, `mirror:true` and `lift:30` apply only
  to actors. `mirror` reflects around the full 1280px stage; `lift` raises the
  figure in film pixels. Actor items cannot define scene beats.

Scale defaults to 1, delay to 0. Delay is relative to the starting scene and
must fit the window; extras do not appear before it. Their whole window has an
18-frame entrance/exit fade. Actor playback uses its local timeline, holding the
last frame when needed. Returned actor item ranges/continuity are actor-local,
not lead/global frame indices. Motion extras also receive a continuity report
(including the loop wrap where applicable), tagged `kind: "motion"`; composed
actors are tagged `kind: "actor"`. Formations are authored as separate extras in
Phase 1; there is no automatic crowd/contact solver.

### Declarative overlays

Each overlay requires `{type,x,y,from,to}`; `from` is inclusive, `to` exclusive,
in local scene frames. `fade` defaults to 12 frames at each end (zero means no
fade), and both fades must fit within the window. Optional `scale` defaults 1;
`tween:{x?,y?,scale?}` eases to an endpoint across the visibility window.

Types: `text`, `label` (`text`, optional font `size`); `bubble` (`text`, optional
`second`, `width`); `scroll`/`card` (`text`, optional `width`); `tick`;
`package-box` (optional `text`); `rect-plate` (`width`, `height`). All use the
existing showcase palette and primitives, with escaped text. No raw markup or
custom colors/functions. Overlays may not extend beyond their scene.

## Runnable example

`examples\films\team-handoff.json` is a 309-frame / 10.3-second two-scene demo
with a wave/nod lead, two smaller supporting actors, bubble, scroll and tick.
It composes at max joint step 13.45 (lead) / 5.04 (each actor).

```powershell
npm run build
node examples\films\render.mjs .\output
```

The SDK client calls all three tools over stdio, writes a fast preview and an
eight-frame QA sheet into `output\team-handoff`. Use another approved root or
remove the old output before rerunning; the tool never overwrites existing work.

## Shared implementation and limits

`scripts\film\runtime.mjs` is extracted from `build-showcase.mjs`: motion loading,
key-pose gates, actor composition, kit rendering, text outlining, rasterization,
encoding and provenance are the **same code path** for showcase and MCP.
`scripts\film\api.mjs` adds JSON-only normalization, semantic validation, reports
and artifact export. `src\film.ts` dynamically imports it using a module-relative
file URL, which works from arbitrary client working directories on Windows.

This is the least-risk option: retaining the reviewed `.mjs` rendering code
avoids a TS port changing clip samples, rounding, font outlining or video bytes.
The private server runs **from a built source checkout**, not a dist-only/npm
installation: retain `scripts`, `motions`, `docs` and `site`, and run the build
after schema changes. Original showcase recipes remain trusted JS and keep their
existing bespoke overlays; public JSON recipes always use declarative overlays,
even if their ID matches a showcase ID. No approved motion specifications were
changed. Automated transition selection, pose authoring, actor formations/contact
and richer QA are later phases, not implied by passing this composer gate.
