# Stickman MCP

An original, deterministic 2D vector stick-figure animation engine for presentation-ready SVG/HTML and optional GIF/MP4 export. The local library, CLI, and stdio MCP server share the same strict contract, compiler, playhead sampler, and renderer. Animation instructions are validated data; the runtime does not execute authored code or call a video-generation service.

## Overview and quick start

- **Repository:** [`vallahrich/stickman-mcp`](https://github.com/vallahrich/stickman-mcp) (default branch: `vallahrich-stickman-mcp-engine`)
- **Live visualization & motion gallery:** [`https://vallahrich.github.io/stickman-mcp/`](https://vallahrich.github.io/stickman-mcp/)
- **Releases (`v0.3.0`):** [`https://github.com/vallahrich/stickman-mcp/releases/tag/v0.3.0`](https://github.com/vallahrich/stickman-mcp/releases/tag/v0.3.0)

### What's in `v0.3.0`

- **Multi-Scene Movie Composer (`stickman.movie/v1` & `stickman_movie`):** Compose 1–16 sequential scenes with contextual vector backdrops (`war-room`, `datacenter`, `office`, `stage`), `fade`/`wipe`/`cut` transitions, automatic `trimIdleTails` pacing, and chapter-aware HTML/MP4/WebM export.
- **Virtual Director Camera, 2.5D Depth Planes, Spotlight & Editorial Callouts:** `camera: "auto-director"` / explicit keyframes, per-actor `depth` (`0..1`) foreshortening and ground-shadow grounding, `spotlight: "auto"` dimming inactive actors, and collision-free `say` / `think` / `badge` callouts.
- **Expressive Vector Rig & Shared Multi-Actor World State:** Curved Bezier spines, directional gaze dots, contextual hand glyphs (`thumbs-up`, `point`, `open`, `grip`), sub-linear stroke scaling (`0.4x`–`1.6x`), left-facing asymmetric prop mirroring, stairs elevation persistence (`0px` drop), seated chain continuity, shared single-prop `handoffTo`, and inline `customMotions` (including `coffee-mug` / `mug`).
- **6-Axis Perceptual Critique (`stickman_critique`) & MCP App Interactive Player (`ui://stickman/player`):** Automated scoring across `Prop Integrity`, `Spatial Continuity`, `Staging & Eye-Trace`, `Pacing & Readability`, `Kinematic Appeal`, and `Cinematography` plus annotated SVG/PNG contact sheets and an interactive zero-dependency MCP App player.
- **Compact Vector HTML Runtime, Parallel MP4 & Transparent VP9 WebM:** Compact `COMPACT_CLIENT_RENDERER_JS` HTML players (`< 220 KB` even for 6-actor scenes), worker-pool parallel rasterization for MP4, and `format: "webm"` with `transparent: true` (`yuva420p`) alpha overlays.
- **Full local MCP & browser surface:** **18 MCP tools**, **14 MCP resources** (including `ui://stickman/player`, `stickman://schema/movie-v1`, `stickman://rubric/human-critique`, and flagship `v3` templates), **3 MCP prompts** (`choreograph-slide`, `two-actor-dialogue`, `create-and-critique-movie`), **106 runtime actions**, **55 geometric runtime props/add-ons**, `<stickman-player controls scroll-scrub blueprint>`, and `bindScrollTimeline`.

### Option 1: Install from the `v0.3.0` GitHub Release

Download `vallahrich-stickman-mcp-0.3.0.tgz` (and optionally `stickman-site-0.3.0.zip` for the pre-rendered offline showcase gallery) from the [v0.3.0 release](https://github.com/vallahrich/stickman-mcp/releases/tag/v0.3.0):

```powershell
npm install ./vallahrich-stickman-mcp-0.3.0.tgz
npx stickman discover
npx stickman-mcp --root .\stickman-output
```

### Option 2: Clone and run from source

- Node.js 20 or newer
- FFmpeg on `PATH` (or the optional `ffmpeg-static` and `@resvg/resvg-js` packages) for GIF/MP4 and film export

```powershell
git clone https://github.com/vallahrich/stickman-mcp.git
cd stickman-mcp
npm install
npm run build
npm test
```

Run the CLI from a built checkout:

```powershell
node dist/cli.js discover --category presentation
node dist/cli.js validate --input examples/v2-presentation-story.json
node dist/cli.js choreograph --input examples/v2-two-actors-collab.json
node dist/cli.js storyboard --input examples/v2-presentation-story.json --lint-only
node dist/cli.js storyboard --input examples/v2-two-actors-collab.json --blueprint > collab-blueprint.svg
node dist/cli.js preview --input examples/v2-two-actors-collab.json --blueprint --format svg > collab-stage-blueprint.svg
node dist/cli.js preview --input examples/wave.json --format html
node dist/cli.js export --input examples/wave.json --root .\output --output wave.svg --format svg
```

Exports are written only to a relative path under the explicit `--root`; existing output files, absolute paths, path traversal, and symlink directories are refused. Preview writes the artifact to stdout.

For release-candidate preparation and verification commands, see [releasing](docs/releasing.md).

## Films via MCP

Use `stickman_list_film_assets`, `stickman_check_join`, `stickman_compose_film` and
`stickman_render_film` to turn strict JSON recipes into continuous, gated silent
films (MP4, poster, captions and optional QA sheet). Automatic pose-space bridges
are on by default for MCP recipes; each is reported with its join, frame range and
before/after continuity cost. Scene/actor timelines and continuity are checked
before writing to a new relative directory under `--root`.
The reviewed release candidate ships the composer and assets; a private source
checkout is no longer required. Optional `ffmpeg-static` / `@resvg/resvg-js`
packages are required for film/PNG features. Preview mode samples at 640x360 / 15 fps.
See [film recipes](docs/film-recipes.md) and the runnable
[`team-handoff` example](examples/films/team-handoff.json) and the
[`bridge-demo` walk-to-look-around transition](examples/films/bridge-demo.json):

```powershell
npm run build
node examples\films\render.mjs .\output
```

## Faster motion authoring

Build a new mechanically checked motion draft from reusable key poses with
`stickman_author_motion`, then inspect it using `stickman_preview_motion`.
Draft JSON and PNG go into the new outputDir under --root, never the installed
library. Preview that draft with `draftDir` equal to its authoring outputDir.
Drafts stay out of films until explicitly user-approved. See the [motion
authoring guide](docs/motion-authoring.md) and regenerate the pose library with
`npm run motions:poses`.

## IT and digital-services motion gallery

The primary presentation audience is cloud, infrastructure, cybersecurity and
digital-service teams. The actor works inside slide content, travelling along
timelines and revealing ideas, not in a separate presenter panel.
**Combined stories are the main experience:** motions are building blocks, not
the final deliverable. Three executable examples follow an application-to-cloud
journey, an incident response, and a release rollout. Each keeps one actor on
one continuous animation timeline, with synchronized content cues.
Build and serve the interactive showcase and 97-motion gallery locally (or browse it live at [`https://vallahrich.github.io/stickman-mcp/`](https://vallahrich.github.io/stickman-mcp/)):

```powershell
npm run site:showcase
npm run site:build
npm run site:serve
```

Open `http://127.0.0.1:4173/`. `npm run site:showcase` builds the self-contained native workload comparison slide and renders both silent short films into `dist/site/showcase/` (or extract `stickman-site-0.3.0.zip` from the [v0.3.0 release](https://github.com/vallahrich/stickman-mcp/releases/tag/v0.3.0) to serve the pre-rendered site immediately). The default, release-style gallery has **no ratings
or review notes**, including its JSON, downloaded specs and embedded previews.
It currently contains 97 motion entries; the historically approved `sneak`
is excluded pending mechanical requalification. Ratings remain in the
development ledger and the separate `npm run site:dev` build (`dist\site-dev`);
serve that with `npm run site:serve -- --dev --port 4175`.
Local `site:build` and `site:dev` outputs retain `noindex` by default, while `--release-candidate` emits the indexable release site. The gallery explicitly distinguishes
preview availability from runtime integration. It does not promote motions or change agent
settings. See [showcase creation](docs/designer-showcase.md) for the
58.6-second five-scene, twelve-beat on-premises-to-cloud presentation (and the 56.7-second native Stickman presentation) plus two
original silent animated shorts—a 58.43-second (1,753-frame) open-source
contribution journey and a 59.17-second (1,775-frame) Julius Caesar historical
short.
The shorts use newer approved keyed motions, full-frame scenery and readable
text cues rather than presentation layouts. See
[MCP setup](docs/mcp-setup.md) for Copilot, Claude Code and Codex.
The presentation treatments remain unqualified visual experiments, not approved
examples of improving a source deck.

For real source decks, a separate [local HTML presentation workflow](docs/offline-presentations.md)
retains original slides, notes, screenshots and embedded demos while an explicit
storyboard adds presenter-controlled diagram beats. It uses the shipping rig,
works offline as one HTML file, and pauses the actor during videos. Source
screenshots enlarge uncropped, resource links remain explicit, and complete
conversion retains every slide and recording, including an empty ending.
Start with a small visual pilot unless the user directs full autonomous
conversion. This is not automatic redesign
or an additional MCP tool; private source decks and their outputs stay outside Git.

## Contracts, choreography, and catalog

Documents use the strict, versioned `stickman.animation/v1` (single-actor explicit timeline) or `stickman.animation/v2` (multi-actor choreography, stage anchors, accessories, and add-on lifecycles) JSON Schemas, available from `src/contract-schema.ts`, `stickman schema --version v1|v2`, or MCP resources `stickman://schema/v1` and `stickman://schema/v2`. Unknown fields and unsupported actions produce path-specific diagnostics with closest valid motion IDs. See [the wave](examples/wave.json), [walk-and-wave sequence](examples/walk-and-wave.json), [bound prop push](examples/push-crate.json), [v2 presentation story](examples/v2-presentation-story.json), [v2 two-actor collaboration](examples/v2-two-actors-collab.json), and [v2 sports add-ons](examples/v2-sports-addons.json).

| Action ID | Meaning | Binding |
|---|---|---|
| `walk@1.0.0` | Continuous grounded travel | Named canvas target |
| `run@1.0.0` | Continuous run cadence and airborne phase | Named canvas target |
| `wave@1.0.0` | Arm raise, oscillation, and settle | None |
| `point@1.0.0` | Directional extension toward a named point | Named canvas target |
| `jump@1.0.0` | Anticipation arc and landing | None |
| `push@1.0.0` | Actor and visible prop translate left or right together in two-hand handle contact | Bound prop ID and local handle (v1) or crate add-on (v2) |

The action enum and `stickman_discover` catalog are derived from the self-contained
runtime motion library (`106` runtime action IDs across `104` assembled clips:
`98` user-approved key-pose motions + `6` mocap baselines, plus `turn-around`
and `hold-pose`). Filtering supports `category`, `tag`, `prop`, `kind`,
`travel`, and `search`. Separately, the 100-entry motion ledger ships 97
mechanically qualified key-pose motions in the rating-free showcase gallery and
continuous film composer (`sneak` is excluded from the gallery pending loop-wrap
requalification, `roll` is in rework, and `dance` remains a candidate). Clip
metadata declares whether an action is a travel loop, in-place loop, one-shot,
or hold; travel clips warp root motion to hit targets cleanly, aim clips use
their target for hand/head IK, and transitions use C1 Hermite blending.

In `stickman.animation/v2` and `stickman_choreograph`, authors can stage `1+` or
`2+` actors with `tie`, `hat`, `glasses`, or `badge` accessories, place actors on
named semantic anchors (`offstage-left`, `left`, `center-left`, `center`,
`center-right`, `right`, `board`, `desk`, `door`, `offstage-right`, etc.), sync
beats across actors via `emitCue`/`emitCueAt` and `afterCue` without manual
timestamp math, and attach or auto-map 55 geometric vector add-ons (`bulb`,
`card`, `board`, `laptop`, `desk`, `chair`, `door`, `banner`, `hurdle`,
`basketball`, `hoop`, `football`, `goal`, `server-rack`, `coffee-mug`, etc.) with appear,
socket, ballistic flight, and exit lifecycles.

Push supports both rightward and leftward movement. Validation resolves reach from the actual preceding actor endpoint and rejects infeasible timing, grips, canvas fit, or body/prop overlap. Reduced and static modes preserve a meaningful onstage summary state (keeping actors visible onstage even when a normal timeline ends with `walk-off`). Sampling the same program and time produces identical geometry.

## Library, CLI, MCP

The public library entry exports `v1` and `v2` contract types and JSON schemas, `validateAnimation`, `compileAnimation`, `choreographAnimation`, `resolveStageAnchors`, `sampleAnimation`, `PlaybackSession`, `renderStoryboardSvg`, `analyzeStoryboard`, `rasterizeStoryboardPng`, preview renderers, `queryActionCatalog`, and safe export helpers. Subpath exports provide `/browser` (including `mountBrowserAnimation`, `bindScrollTimeline`, and `registerStickmanPlayerElement` for `<stickman-player controls scroll-scrub blueprint>`), `/film`, `/motion-authoring`, `/room` (including `renderRoomBlueprintSvg`), and `/keyboard`. The CLI exposes `discover`, `describe`, `schema`, `validate`, `compile`, `choreograph`, `storyboard`, `preview`, and `export` (with `--blueprint` / `--style blueprint` full-stage CAD rendering). Validate UI tokens, WCAG AA contrast, `140–180ms` `cubic-bezier(0.22, 1, 0.36, 1)` transitions, `tabular-nums`, and anti-slop rules with `npm run design:check`.

Start the stdio server with an output root selected at launch:

```powershell
node dist/mcp.js --root C:\Projects\MyPresentation\stickman-output
```

The server exposes **18 MCP tools**, **14 MCP resources (`stickman://*` + `ui://stickman/player`)**, and **3 MCP prompts**:

- **18 MCP tools:** `stickman_discover`, `stickman_describe`, `stickman_schema`, `stickman_validate`, `stickman_compile`, `stickman_choreograph`, `stickman_storyboard`, `stickman_preview`, `stickman_export`, `stickman_story`, `stickman_movie`, `stickman_critique`, `stickman_list_film_assets`, `stickman_check_join`, `stickman_compose_film`, `stickman_render_film`, `stickman_author_motion`, and `stickman_preview_motion`.
- **14 MCP resources:** `stickman://catalog`, `stickman://schema/v1`, `stickman://schema/v2`, `stickman://schema/movie-v1`, `stickman://anchors`, `stickman://props`, `stickman://rubric/human-critique`, `ui://stickman/player`, `stickman://templates/presentation-pitch`, `stickman://templates/two-actor-dialogue`, `stickman://templates/idea-reveal`, `stickman://templates/sports-action`, `stickman://templates/incident-warroom-movie`, and `stickman://templates/two-actor-handoff`.
- **3 MCP prompts:** `choreograph-slide`, `two-actor-dialogue`, and `create-and-critique-movie`.

Tool input schemas are enforced without type coercion. Results retain pretty-printed JSON text, add schema-described `structuredContent`, and include PNG `ImageContent` from `stickman_storyboard` when `@resvg/resvg-js` is installed; unknown tools are protocol errors, while argument and execution failures are actionable tool errors. The server does not edit client configuration or accept an output-root override from a tool request.

Call `stickman_story` with `{}` to discover the combined stories, or
`{"id":"cloud-journey"}` to get an executable `animation` plus host `cues`.
Pass only `animation` to the existing compile/preview/export tools. The library
exports `composeStory`, `getStory`, `storyCatalog` and `storyState`: compose
ordered steps with cumulative timing and compiler validation, then derive cue
state from the same playhead during playback or seeking. The website includes
controlled story previews and both animation-only and full-recipe downloads.
These are reusable authored sequences of supported actions, not a claim that
all catalogue motions or simultaneous actions can already be combined safely.

See [local MCP setup and verification](docs/mcp-setup.md) for reviewed Copilot CLI/VS Code connection examples, result/error contracts, safe export checks, and remaining compatibility limits. Register it in a client only after reviewing that client's configuration; the guide does not install or change settings automatically.

For a small stickman inside a website/animation deck, see the
[browser overlay and deck-clock integration](docs/browser-integration.md).
`npm run preview:deck` opens a localhost development bridge that compiles a
run-to-DOM-anchor, jump, then point sequence through the actual stdio MCP server.
The transparent overlay does not block deck controls. This is not a public HTTP
MCP service; the scripted quality result below does not qualify its interactive
room/controller diagnostics.

The preview now defaults to a smaller 48px figure and includes an original
2.5D room staging diagnostic. The [2.5D research notes](docs/2.5d-research.md)
separate verified engine patterns from unverified game internals. Presentation/
video choreography remains primary; room/keyboard diagnostics are not a claim
of seamless game control or completed room-scene MCP/video authoring.

## Export and limitations

- SVG frame/animation, multi-panel `storyboard-svg`, and self-contained HTML preview need no renderer service or external assets.
- GIF, MP4, and `stickman_storyboard` PNG `ImageContent` rasterize deterministic SVG frames with optional `@resvg/resvg-js` (and encode video with FFmpeg). If optional packages are unavailable, video export fails with an actionable error while SVG, `storyboard-svg`, and HTML remain available.
- `v0.3.0` ships 106 deterministic runtime actions, 55 geometric vector props/add-ons, multi-scene `stickman.movie/v1` composition with contextual backdrops and transitions, virtual auto-director camera, 2.5D depth planes, spotlight focus, editorial callouts, curved Bezier spines, gaze cues, hand glyphs, shared multi-actor prop handoffs, inline `customMotions`, 6-axis `stickman_critique`, `ui://stickman/player`, compact HTML players, parallel H.264 MP4, and transparent VP9 WebM overlays. It does not claim arbitrary motion understanding, general physics, imported 3D/bitmap assets, speech, production qualification, or universal contact-safe novel combinations. Inspect exported visuals (and `stickman_critique` / `stickman_storyboard` contact sheets) in the intended presentation and validate accessibility/brand requirements separately.
- `PlaybackSession.advance(ms)` is caller-driven and has a single clock; the library starts no hidden ticker or background process.

## Motion authoring and feedback

New motions are currently authored offline as timed pose keys, foot/hand contact
targets and prop events. The factory builds them through the shared sampler and
renderer, checks mechanical gates, and produces a review preview. A user score
of at least 8/10 approves the catalog entry, not automatic runtime availability:
the reviewed clip still needs explicit assembly and MCP integration. Use
`stickman_discover` to see the actions actually exposed by the running server.

The compiler supports ordered sequences, target-based travel and some transition
blending. Arbitrary contact-safe combinations and cross-slide continuity are
separate qualification work, not consequences of approving individual clips.

There is no model training or automatic preference learning today. Scores and
critiques guide AI-assisted authoring, but do not change model weights. The
[planned authoring layer](docs/roadmap.md#ai-motion-authoring-current-limits-and-intended-direction)
starts with versioned feedback and retrieval of approved examples; learned
ranking or fine-tuning must demonstrate improvements on held-out requests while
preserving deterministic playback and unchanged anatomy/contact gates.

## Roadmap

The previous motion result was rejected on visual quality. Development now
follows the [motion-quality rebuild plan](docs/motion-quality-plan.md): replace
coordinate-based limb motion with a fixed-length, contact-aware skeleton, score
each version and action, continue below 8/10, and re-evaluate the engine/framework
below 5/10. Protocol tests and successful encoding are not visual approval.

The scripted V7 candidate subsequently received independent provisional
scores of **8.27/10 normal and 8.155/10 at 48px**, with every reviewed
action/chain at least 8.0. The requested run -> jump -> point sequence scored
8.4/8.3. See the plan for evidence, uncertainty and the important distinction
between this scored scripted scope and the experimental 2.5D room/controller.

The repository now also includes a generated compact CMU-mocap-derived 2D clip
library (`src/motion-clips.ts`) and importer (`scripts/import-clips.mjs`) for the
next motion-player path. The current v1 MCP contract and schemas remain
unchanged while clip sampling, stride-warp planning, floor checks and point IK
are covered by unit tests.

Future work should first broaden tested locomotion/facing and prop-contact profiles, then add additional interactions only when their target geometry and contact mechanics are modeled explicitly. The bounded scripted review and decoded movie checks are not cross-browser or universal encoder certification; build and unit tests alone are not visual approval.

## Rights and notices

The source and geometric actor are original to this repository and released under [MIT](LICENSE). No source, assets, or derivatives from the separate TemplatePresentation project are included. `@resvg/resvg-js`, the optional `ffmpeg-static` dependency and its separately installed executable, and compact CMU-derived motion clips retain their own terms; see [NOTICE](NOTICE) and [rights](docs/rights.md). Package metadata points to NOTICE because CMU data is not MIT. No third-party character or reference artwork is bundled.
