# Stickman MCP

An original, deterministic 2D vector stick-figure animation engine for presentation-ready SVG/HTML and optional GIF/MP4 export. The local library, CLI, and stdio MCP server share the same strict contract, compiler, playhead sampler, and renderer. Animation instructions are validated data; the runtime does not execute authored code or call a video-generation service.

## Canonical repository

The canonical private repository is
[`vallahrich/stickman-mcp`](https://github.com/vallahrich/stickman-mcp); all
development happens there, on the default branch `vallahrich-stickman-mcp-engine`.
The former corporate copy `t-vwallerich_microsoft/stickman-mcp` is no longer
maintained and receives no syncs.

Clones use the SSH host alias `github-vallahrich` (authenticated with the
vallahrich account):

```powershell
git clone git@github-vallahrich:vallahrich/stickman-mcp.git
```

Do not force push to shared branches.
## Requirements and setup

- Node.js 20 or newer
- FFmpeg on `PATH` and the optional `@resvg/resvg-js` package for GIF/MP4 export

```powershell
npm install
npm run build
npm test
```

The repository is private and the package is not published. Run from a checkout:

```powershell
node dist/cli.js discover
node dist/cli.js validate --input examples/wave.json
node dist/cli.js preview --input examples/wave.json --format html
node dist/cli.js export --input examples/wave.json --root .\output --output wave.svg --format svg
```

Exports are written only to a relative path under the explicit `--root`; existing output files, absolute paths, path traversal, and symlink directories are refused. Preview writes the artifact to stdout.

## Films via MCP

Use `stickman_list_film_assets`, `stickman_check_join`, `stickman_compose_film` and
`stickman_render_film` to turn strict JSON recipes into continuous, gated silent
films (MP4, poster, captions and optional QA sheet). Automatic pose-space bridges
are on by default for MCP recipes; each is reported with its join, frame range and
before/after continuity cost. Scene/actor timelines and continuity are checked
before writing to a new relative directory under `--root`.
The private source checkout and optional `ffmpeg-static` / `@resvg/resvg-js`
packages are required. Preview mode samples at 640x360 / 15 fps.
See [film recipes](docs/film-recipes.md) and the runnable
[`team-handoff` example](examples/films/team-handoff.json) and the
[`bridge-demo` walk-to-look-around transition](examples/films/bridge-demo.json):

```powershell
npm run build
node examples\films\render.mjs .\output
```

## IT and digital-services motion gallery

The primary presentation audience is cloud, infrastructure, cybersecurity and
digital-service teams. The actor works inside slide content, travelling along
timelines and revealing ideas, not in a separate presenter panel.
**Combined stories are the main experience:** motions are building blocks, not
the final deliverable. Three executable examples follow an application-to-cloud
journey, an incident response, and a release rollout. Each keeps one actor on
one continuous animation timeline, with synchronized content cues.
Build a private designer preview with category/search
filters, lazy 1x hover and keyboard previews, reduced-motion support and
copyable agent setup:

```powershell
npm run site:build
npm run site:serve
```

Open `http://127.0.0.1:4173/`. The default, release-style gallery has **no ratings
or review notes**, including its JSON, downloaded specs and embedded previews.
It currently contains 97 motion entries; the historically approved `sneak`
is excluded pending mechanical requalification. Ratings remain in the
development ledger and the separate `npm run site:dev` build (`dist\site-dev`);
serve that with `npm run site:serve -- --dev --port 4175`.
Both builds remain private/noindex. The gallery explicitly distinguishes
preview availability from runtime integration. It does not publish a site,
promote motions, or change agent
settings. See [showcase creation](docs/designer-showcase.md) for the
on-premises-to-cloud slide and two original 56-second silent animated shorts—an
open-source contribution journey and the life and legacy of Julius Caesar.
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

## Contract and catalog

Documents use the strict, versioned `stickman.animation/v1` JSON Schema, available from `src/contract-schema.ts` or `stickman schema`. Unknown fields and unsupported actions produce path-specific diagnostics with closest valid motion IDs. See [the wave](examples/wave.json), [walk-and-wave sequence](examples/walk-and-wave.json), and [bound prop push](examples/push-crate.json) examples.

| Action ID | Meaning | Binding |
|---|---|---|
| `walk@1.0.0` | Continuous grounded travel | Named canvas target |
| `run@1.0.0` | Continuous run cadence and airborne phase | Named canvas target |
| `wave@1.0.0` | Arm raise, oscillation, and settle | None |
| `point@1.0.0` | Directional extension toward a named point | Named canvas target |
| `jump@1.0.0` | Anticipation arc and landing | None |
| `push@1.0.0` | Actor and visible prop translate rightward together in two-hand handle contact | Bound prop ID and local handle |

The action enum and `stickman_discover` catalog are now derived from the runtime
motion library. In addition to the six legacy IDs above, any generated clip ID
(for example `idle`, `stop`, `turn-around`, `hold-pose`, and future factory
motions) can be used as an action. Clip metadata declares whether an action is a
travel loop, in-place loop, one-shot, or hold; travel clips require a named
target and are root-motion warped to hit it exactly, aim clips use their target
for hand/head IK, and one-shots may specify `speed` from `0.5` to `2`.

Actions are ordered and non-overlapping and use one deterministic playhead. Walk, run, and point infer left/right facing from their existing target coordinates; no facing field is required. The quality rebuild uses fixed-length skeletal poses and explicit world-space foot contacts, not a facing scale that flattens the rig during turns.

Push remains rightward. Validation resolves reach from the actual preceding actor endpoint and rejects infeasible timing, grips, canvas fit, or body/prop overlap. Approach, supported drive and release are derived from feasible poses rather than guaranteed fixed 15/70/15 percentages. Reduced and static modes preserve the meaningful final state. Sampling the same program and time produces the same geometry. Locomotion uses one flat world floor: travel target Y must match that floor, and pushed crates must rest on it.

## Library, CLI, MCP

The public library entry exports contract types, `validateAnimation`, `compileAnimation`, `sampleAnimation`, `PlaybackSession`, preview renderers, catalog, and safe export helpers. The CLI exposes `discover`, `describe`, `schema`, `validate`, `compile`, `preview`, and `export`.

Start the stdio server with an output root selected at launch:

```powershell
node dist/mcp.js --root C:\Projects\MyPresentation\stickman-output
```

The MCP tools are `stickman_discover`, `stickman_describe`, `stickman_schema`, `stickman_validate`, `stickman_compile`, `stickman_preview`, `stickman_export`, `stickman_story`, `stickman_list_film_assets`,
`stickman_check_join`, `stickman_compose_film`, and `stickman_render_film`. Their advertised input schemas are enforced without type coercion. Results retain the existing JSON text and add schema-described structured output; unknown tools are protocol errors, while argument and execution failures are actionable tool errors. The server does not edit client configuration or accept an output-root override from a tool request.

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

- SVG frame/animation and self-contained HTML preview need no renderer service or external assets.
- GIF and MP4 render deterministic SVG frames with optional `@resvg/resvg-js`, then encode with FFmpeg. If either is unavailable, export fails with an actionable error. SVG/HTML remain available.
- The first release has six actions, one geometric actor, and one rightward push interaction with a rectangular prop. It does not claim arbitrary motion understanding, general physics, imported assets, speech, production qualification, or perceptual naturalness. Inspect exported visuals in the intended presentation and validate accessibility/brand requirements separately.
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

The source and geometric actor are original to this repository and released under [MIT](LICENSE). No source, assets, or derivatives from the separate TemplatePresentation project are included. `@resvg/resvg-js` (optional), FFmpeg (external), and the compact CMU-derived motion clips retain their own notices; see [NOTICE](NOTICE). No third-party character or reference artwork is bundled.
