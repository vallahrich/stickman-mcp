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

Open `http://127.0.0.1:4173/`. Output is ignored `dist/site`.
The builder parses the 100-entry approval ledger, includes only `user-approved`
records, joins aliased review IDs and writes SVG posters, standalone previews,
authored specs and `catalogue.json`. The five non-keyed baselines are the
existing runtime clips, not unreviewed replacement motions.
The logical `throw` and `pull-banner` entries retain the reviewed basketball
and four-direction banner variants in their controlled preview selector;
variants do not inflate the logical approval count.

Current regeneration also detects a pre-existing `sneak` loop-wrap joint-pop
failure. Its historical user approval is retained, but its machine-readable
record and card explicitly require mechanical requalification. This is a
release blocker, not an excuse to weaken the gate or silently repair an
already-rated version.

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
copyable configuration, source comparison and mobile overflow.

Client commands in [MCP setup](mcp-setup.md) are verified against official
documentation, not executed by the gallery. `llms.txt`, catalogue and capability
JSON are ordinary documentation maps; neither they nor a private repository
guarantee automatic agent discovery. The public MCP Registry requires a
publicly available installation method or accessible remote server, so this
private checkout is not submitted.
