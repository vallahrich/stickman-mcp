# Private designer showcase

The audience is IT and digital services: cloud/infrastructure explanation,
cybersecurity briefings, digital workflows, collaboration and service operations.
The original reviewed rig and renderer are reused; the gallery is not a parallel
CSS approximation of the character. Presentation demos put the actor inside
the slide content, travelling along timelines and revealing cards—not in a
sidebar or co-presenter panel.

## Gallery

```powershell
npm ci
npm run site:build
npm run site:serve
```

Open `http://127.0.0.1:4173/`. Output is ignored `dist/site`, a release-style
catalogue without ratings or review notes in cards, dialogs, catalogue JSON,
downloaded specs or embedded motion-preview metadata.
The builder parses the 100-entry approval ledger, includes only `user-approved`
records, joins aliased review IDs and writes SVG posters, standalone previews,
authored specs and `catalogue.json`. The five non-keyed baselines are the
existing runtime clips, not unreviewed replacement motions.
The logical `throw` and `pull-banner` entries retain the reviewed basketball
and four-direction banner variants in their controlled preview selector;
variants do not inflate the logical approval count.

Current regeneration detects a pre-existing `sneak` loop-wrap joint-pop failure.
The release-style build excludes it, leaving 97 logical entries. Its historical
approval and mechanical diagnostics remain in development. Unapproved dance
and withheld roll remain excluded; the gate is not weakened.

Development ratings and feedback remain in `docs/motion-catalog-plan.md` and
the separate development build:

```powershell
npm run site:dev
npm run site:serve -- --dev --port 4175
```

This serves `dist\site-dev`, with 98 historically approved entries, review
scores/notes, pending entries in JSON and a visible requalification flag on
`sneak`. Neither build deploys publicly or changes repository visibility.

## Combined stories

The first combined-story layout was rejected by the user at **2/10**:
"no one would present it like that." Mechanical checks were not visual approval.
The revised candidate uses substantive architecture messages, visible request
flow, failover routing, and a deployment traffic gate instead of tall placeholder
cards, a runway, action-name captions or narration about the actor.
The preview's **Next beat** control lets a presenter stop at an explanation
point rather than race the autoplay. This revision is awaiting user review;
it has no invented replacement score or presentation-quality approval.

The first gallery section presents stories before individual motions:
`cloud-journey`, `incident-resolution`, and `deployment-rollout`. Each recipe
uses supported runtime actions on a single continuous actor timeline. Travel,
gestures and a bound release package remain in the same world; timed cues
explain the story beats in the slide content rather than in a separate panel.

`stickman_story` lists recipes with `{}` and returns one with `{"id":"cloud-journey"}`.
The recipe has an `animation` compatible with normal validation, compilation,
preview and export, and `cues` for the host's content. Do not put cue fields in
the strict animation document. Downloads include both forms and standalone
motion HTML; the themed diagram preview is generated through the same sampler.
Seeking backward recomputes cue state, and Replay returns to the beginning.
Reduced-motion opens the scene paused.

For custom stories, the library's `composeStory` accepts ordered `steps`,
targets, optional actor/prop and per-step cues. It computes cumulative timing
and rejects infeasible animations through the existing compiler.
`storyState(recipe, playheadMs)` returns revealed/active cues without retaining
playback history. This is deterministic authoring, not new motion generation.
The three examples do not qualify arbitrary blends, simultaneous actors/actions,
all catalogue props or cross-slide continuity.
Their 1000-by-720 animation canvas deliberately uses the existing fixed-length
procedural rig path; the 1280-by-720 diagram preview adds host layout space,
not actor scaling. Wide-canvas clip endpoint blending remains unqualified for
limb-length preservation and is not used by these recipes.

Only one hover/focus preview is active at once; leaving removes its player.
Touch selects the controlled preview. Reduced-motion disables hover playback
and opens paused previews. Search includes accurate IT use cases as well as IDs,
categories and tags. Matching runtime IDs are explicitly distinguished from
promotion of the reviewed version/props.

The build embeds its UI code and styles in one HTML file. Assets remain relative,
so it can later be hosted under a repository subpath. It currently emits noindex
metadata and a disallow-all robots file; the loopback server also sends noindex.
There is no deployment or registry submission. Public release needs a separate
readiness review, including outstanding motions, dependencies and runtime assembly.

## NIST before / after and 60-second video

Install `scripts/site/requirements.txt` in a chosen Python environment if
PyMuPDF is not already available. `PYTHON` can point at that environment's
interpreter. Download the exact official PDF linked in
[source notices](showcase-sources.md), then run:

```powershell
npm run site:demo -- --source C:\Downloads\NIST-CSF-Pascoe.pdf
npm run site:video
npm run site:build
npm run site:serve
```

The demo checks the reviewed source's SHA-256. The original excerpt retains
pages 1, 2, 4 and 5 whole as raster images. The enhanced deck summarizes and
re-layouts those ideas, adding an actor that walks and reveals content inside
the slide. A shared scene builder samples actual runtime walk/point actions
and synchronizes content beats. This is explicit authored choreography,
not qualification of arbitrary novel combinations.
The source PDF, visual-source excerpt and enhanced PPTX are downloadable in the
private site. Animated GIFs play in PowerPoint Slide Show; preview renderers can
show only the first frame. Complete-slide GIFs are a portable playback package,
not individually editable PowerPoint elements. Reproducible SVG/scene sources
remain editable. The source is a **historical February 2023 pre-release
briefing**, not current cybersecurity advice.

`site:video` samples real approved motions into 1,800 frames at 30 fps and uses
the optional local `ffmpeg-static` encoder for a 60-second, silent H.264 MP4.
It includes an actual source-slide comparison, visible explanatory text, a VTT
caption track and a storyboard manifest. No unapproved motion is advertised,
no remote video-generation API is called, and discrete scene cuts are not
presented as general contact-safe choreography.

## Checks and client integration

```powershell
npm run site:test
node .\node_modules\vitest\vitest.mjs run tests\site-catalogue.test.ts tests\review-renderer-geometry.test.ts --pool=vmThreads --maxWorkers=1
```

Browser checks use locally installed Edge on Windows; otherwise Playwright's
Chromium is required. Set `STICKMAN_SITE_BROWSER` to choose a supported browser
channel. Checks cover catalogue/asset availability, hover lifecycle, actual
playhead progression, search/filtering, keyboard/reduced-motion behavior,
copyable configuration, source comparison, story actions/cues/seek/replay,
rating-free release assets, retained development feedback and mobile overflow.
Build both `site:build` and `site:dev` before running `site:test`.

Client commands in [MCP setup](mcp-setup.md) are verified against official
documentation, not executed by the gallery. `llms.txt`, catalogue and capability
JSON are ordinary documentation maps; neither they nor a private repository
guarantee automatic agent discovery. The public MCP Registry requires a
publicly available installation method or accessible remote server, so this
private checkout is not submitted.
