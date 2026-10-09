# Connected product: private preparation, reviewed public releases

## Scope and authorization (2026-10-09)

The owner explicitly selected **the MCP, library and connected demo interface**,
not a core-only package. Local preparation is authorized; public upload,
repository creation/visibility change, npm publishing and Pages deployment are
**not**. Keep development private under `vallahrich/stickman-mcp`. Do not push
to the retired corporate `origin`.

The previous core-only gate is replaced, not retained as a separate product.
CMU permits copying, modification and redistribution; the documented BVH
conversion adds no additional restriction. CMU's current no-standalone-dataset-
resale restriction and acknowledgment remain. See [rights.md](rights.md).
These evidence-backed terms are separate from MIT for our original code/work.
No blanket legal certification is claimed.

## Local candidate commands

```powershell
npm run build
npm run typecheck
npm test -- --maxWorkers=1 --no-file-parallelism
npm run release:check
npm run release:prepare
# A later candidate must use a NEW immutable version:
npm run release:prepare -- 0.1.0-rc.2
```

`release:check` prints exact input SHA-256, provenance/license inventory,
scope and remaining review requirements. `ready: true` means **private
preparation can run**, never permission to publish. `publicationApproved`
remains false. Unknown motion origins, missing license metadata, suspicious
private-content signatures, traversal, symlinks and changed input hashes fail.
The bounded scan is not a complete secrets or history audit.

`release:prepare` compiles a fresh full-product workspace from explicit file
names, never copies an existing `dist`, review deck or screenshot, and writes:

```text
.release-local/0.1.0-rc.1/
  vallahrich-stickman-mcp-0.1.0-rc.1.tgz
  stickman-source-0.1.0-rc.1.zip
  stickman-site-0.1.0-rc.1.zip
  provenance.json
  site/                         # extracted site for local inspection
```

Existing version directories are refused. Failure removes only that attempt's
new output directory and temporary workspace; it never overwrites a candidate.
No command uploads anything. Root `npm pack` is guarded; use the isolated
builder, not a private-checkout pack. Main package and candidate stay
`private: true` until a separate, explicitly authorized publication change.

### Package

One package, **@vallahrich/stickman-mcp**, contains:

- compiled engine/library and declarations; `/browser`, `/room`, `/keyboard`;
- `stickman` CLI and `stickman-mcp` stdio server;
- shared film composer, renderer, join checker and authoring modules;
- motion specs, minimal approval metadata, pose library, props and join matrix;
- example animation/film recipes, candidate README, LICENSE, NOTICE and rights;
- exact payload manifest and upstream dependency license inventory.

The SDK and optional renderers are npm dependencies, not vendored copies.
Film/PNG rendering needs @resvg/resvg-js and an installed FFmpeg binary from
ffmpeg-static. Ordinary npm installation runs that dependency's installer;
an offline smoke test uses `--ignore-scripts` and separately provisions a
known local encoder. That exception does not claim FFmpeg is in our tarball.

MCP runs outside the checkout. Authoring writes JSON drafts and previews into
the requested new outputDir under --root, never into installed approved specs.
Preview a saved draft with `draftDir` equal to the author's outputDir.
Packaged non-draft IDs, path escapes and draft symlinks are protected.

### Demo interface

The existing gallery remains the single interface: demos, motion library,
local installation/stdio connection and rights links. Production catalogue
shows actual approval and runtime availability without ratings or private
review notes. Mechanically failing entries are excluded, not falsely approved.

The public-safe cloud story uses an original native shell, aligned diagrams,
a fixed workload identity and a quiet, slower qualified presenter derivative.
No moving W1 glyph, decorative flow dot, four cramped miniature cards, console
taps or deck replant hops. Native-specific timing does not modify or newly
approve any library spec. Mobile uses readable semantic scene summaries rather
than shrinking diagram microtext. Playback defaults to paused; reduced motion,
keyboard seeking, text summaries and visibility pause are supported.

The two original silent films are rebuilt from the repository's reviewed
recipes and motion assets. Existing private review media is untouched.
The external dynamic presentation renderer, its JS/output, private templates
and screenshots are not distributed. Its private review presentation is
not evidence of publication readiness; the owner's 7/10 feedback motivated
the native replacement, not a claim that sampled v10 tests proved polish.

Only the explicitly isolated candidate site has indexable robots configuration;
ordinary private builds retain noindex. A local static server is for inspection,
not a public MCP endpoint. Serve the extracted site directory and open index.html.

### Source and manifests

The curated source ZIP reconstructs this package and native demos, not the
entire private repository. It includes the exact selected source/scripts,
sanitized specs, minimal approval data, CSS/templates and installation docs.
Excluded: private review ledger/ratings, history, scratch output, screenshots,
raw BVH, external renderer and dependency binaries.

ZIP files use deterministic stored entries and reject symlinks/ZIP64 sizes.
Payload manifests hash every file except themselves. Whole-archive SHA-256
in provenance covers the manifests too. Hashes identify bytes, not ownership.
The private source commit and exact input hashes are recorded; if prepared
before committing, hashes are authoritative and the commit is marked as
possibly preceding release-preparation edits.

## Verification and final approval

Before handing a particular candidate to the owner:

- check exact dry-run and real tarball membership;
- install away from the checkout; exercise library imports, CLI and MCP stdio
  discovery, film assets/compose/preview, joins, authoring and draft preview;
- verify installed payload hashes and approved-library immutability;
- check native layout on **every frame**, stricter visible displacement and
  acceleration, actual continuous browser playback, mobile/reduced motion;
- inspect candidate gallery, demo playback, installed connection commands,
  notices and no private/absolute links; validate all archive hashes;
- inspect the final diff; run the full serial regression suite and typecheck.

Browser evidence is local under `.release-local/native-review/`, including
continuous playback recording, screenshots and checks. This is self-verification,
not independent QA, an owner rating, legal approval or a guarantee of arbitrary
contact-safe choreography.

The remaining real decisions are owner final-file content/ownership/hash
sign-off and the publication destination/upload. Recommend a separately
approved public release repository/snapshot under vallahrich with sanitized
release notes and immutable versions, not a wholesale mirror of private history.
Do not create it, publish npm, upload assets, change visibility or deploy until
explicitly authorized. Continued development remains private.
