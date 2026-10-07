# Local, source-faithful HTML presentations

This is a **local presentation-building path**, not an automatic PowerPoint
redesign tool or a new MCP capability. It inventories a PPTX, then uses an
explicit, source-specific storyboard to build one offline HTML file. The
catalogue, runtime verbs and motion-review baselines are unchanged.

Keep private decks, extracted screenshots/videos, notes, storyboards, HTML and
QA screenshots **outside this repository and its mirror**. Both commands refuse
source-derived output under this worktree. Neither fetches external resources.
Only these reusable scripts and source-free tests belong in Git.

```powershell
npm run -s build
python .\scripts\presentations\extract-pptx.py --source "C:\private\source.pptx" --output "C:\private\inventory"
node .\scripts\presentations\build.mjs --source "C:\private\inventory\source.json" --design "C:\private\storyboard.json" --output "C:\private\presentation.html"
```

The inventory retains ordered source slides, original text, body speaker notes,
media relationships, hashes, crops, placeholder-inherited geometry and grouped
coordinates. It sanitizes SVG active/remote content and rejects macros,
unsupported media, external media and packages exceeding 1 GiB uncompressed.
Original screenshots and video bytes are not recolored or transcoded.

The storyboard has a `title` and ordered `slides`. Each slide specifies its
`source` number, `section`, `title`, `subtitle`, optional diagram `nodes`/`edges`,
optional source `video`, and `beats`. A beat contains a `caption`, `active`
diagram IDs, and optionally an `actor` cue with an approved catalogue `motion`,
world-space `x`/`groundY`/`scale`, clip-frame `from`/`to`, and `durationMs`.
Selected authored clips must pass their existing mechanical checks. Clip
geometry is sampled by the shipping renderer, not replaced by CSS figures or
hundreds of complete SVG frames.

Optional `video.focus` defines a poster-detail beat and normalized `left`, `top`,
`width`, `height` crop. The detail uses the actual source image without inventing
code or UI; the full image remains available under Original slide, and playback
always switches back to the unaltered recording. Foreground diagram edges can
reach an inner layer without disappearing behind its enclosing foundation;
`activeOnly` routes and `label.onlyActive` expose the specific engine path.

Open the generated file directly in a current browser. There are no remote
fonts, scripts, images or runtime fetches. Videos are embedded and activated
only for their slide, played explicitly, and released on slide changes. Expect
roughly 33% base64 overhead for embedded media: a single file is convenient,
not necessarily small. Browser codec support still matters.

**Presenter controls:** Next/Space advances a beat and holds; pressing Next
during a beat finishes it. Back reconstructs a stable prior state. Replay is
explicit. Selecting a slide stops outgoing media. Next does not advance during
video playback, and the figure is suspended. Keyboard shortcuts ignore media
controls, inputs and dialogs. Reduced motion or Animation off preserves every
explanation without an actor. Notes separates original notes from added beats.
The original-demo Play button is visible on the poster and in presenter controls.
Original slide reconstructs source positions and also shows uncropped images;
this is not a pixel-perfect Office rendering.

Start with representative source slides and obtain visual feedback before
expanding a deck. Automated checks establish fidelity and behavior, **not**
presentation quality or user approval. Preserve historical terminology, repeated
headings, blank slides and explicit preview labels; do not silently update claims.

## Verification

```powershell
python -m unittest discover -s .\tests\presentations -p "test_*.py"
npx vitest run tests\presentation.test.ts --pool=vmThreads --maxWorkers=1
npx playwright test --config playwright.presentation.config.mjs
```

The browser suite normally builds a source-free temporary fixture. To verify
an actual private output, set **both** paths outside the repository:

```powershell
$env:STICKMAN_PRESENTATION_HTML = "C:\private\presentation.html"
$env:STICKMAN_PRESENTATION_QA = "C:\private\qa"
npx playwright test --config playwright.presentation.config.mjs
```

This opens `file://` with networking offline, checks presenter state, source
notes/images, video playback/disposal, deterministic back/replay and reduced
motion, and captures each stable beat locally. Also inspect moving frames,
labels, crossings, actor contact/aim and source coverage visually. Keep private
QA outputs out of published sites, commits and CI artifacts.
