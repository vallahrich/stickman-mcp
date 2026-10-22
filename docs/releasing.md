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
# Choose a NEW immutable version; rc.1 through rc.3 already exist locally:
npm run release:prepare -- 0.1.0-rc.4
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
.release-local/0.1.0-rc.3/
  vallahrich-stickman-mcp-0.1.0-rc.3.tgz
  stickman-source-0.1.0-rc.3.zip
  stickman-site-0.1.0-rc.3.zip
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

## Verified review candidate: 0.1.0-rc.3

The deliverable is **rc.3**, built from committed source
`ca0f9f7753ed11360f840f50a6e9b9655721f3b2`.
Earlier local candidates are not deliverables: rc.1 exposed native presenter
clipping; rc.2 retained checkout installation commands when the input HTML had
Windows line endings. Both issues were corrected without altering approved
motion specifications or the owner's private v10 review artifact.

Artifacts live under `.release-local/0.1.0-rc.3/`. Their SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| `vallahrich-stickman-mcp-0.1.0-rc.3.tgz` | `12b52c5b96eb9275f2f4aa46b796aa9c123ad18d8dc2883f0acc6480231b5899` |
| `stickman-source-0.1.0-rc.3.zip` | `51e7d3e5253d8c08dc8a217c9dda7799a79aa561454f1dc94c40094fbe4147bd` |
| `stickman-site-0.1.0-rc.3.zip` | `0b42caf3b1b42d7cb2836308fae847641b380ae9e801110c031aeb209ab894d5` |

`provenance.json` retains exact inputs, dependency license evidence and the
explicit `publicationApproved: false` / `local-review-required` status.
The curated source ZIP is not a complete repository/history disclosure.

Verification performed:

- Full serial regression suite: **29 files / 491 tests passed**; the separate
  native browser test passed as well. Typecheck and final diff checks passed.
- Final actual rc.3 tarball: **all six release tests passed**, including
  installation in a temporary directory outside the checkout. Library and
  subpath imports, CLI, MCP version/discovery, assets, film composition/render
  preview, joins, authoring, draft/approved preview, installed payload hashes,
  approved-spec immutability and path/provenance/inventory negatives exercised.
  The offline test provisioned a separately installed FFmpeg executable; it
  does not mean an encoder is bundled.
- Independent ZIP validation: source **168 entries**, site **338 entries**;
  CRC, exact membership and every declared per-file hash passed. All three
  archive hashes matched provenance.
- Actual rc.3 gallery: **97 motions / 11 runtime IDs**, exact search identities,
  runtime filtering, keyboard preview, installed-version instructions,
  paused native demo, both film durations and mobile layout passed. No browser
  exceptions, failed HTTP responses or external requests were observed.
- Native presentation: all **1,701 frames** checked for text/actor clipping,
  text collisions and reserved-column containment; continuous **56.7-second**
  browser playback traversed all five scenes and finished without errors.
  Minimum SVG text size 24; normalized presenter height 129.18–134.11.
  Maximum visible step 1.762 and acceleration 1.728 passed the stricter
  native limits of 4 and 2, respectively. Mobile semantic summaries and
  reduced-motion behavior passed. This is not an owner quality rating.
- Original MP4s were untouched; freshly rendered rc.3 films are bit-identical:
  open-source `30dd6521147a7b3243ffe2420e1f7d13ede424ae91e23ee664756dcb469a8969`;
  Julius Caesar `9f63cae1ffed0ccde9ae6c9c4fc1494bfd11b0c0314567adffaf3f57e8b2ea66`.

Local evidence: `.release-local/native-review/` contains continuous playback,
scene/mobile screenshots and frame checks;
`.release-local/candidate-review-0.1.0-rc.3/` contains desktop/mobile gallery
screenshots and `verification.json`. The extracted interface is
`.release-local/0.1.0-rc.3/site/index.html`, with the new native story at
`showcase/on-prem-to-cloud.html`.

These checks used Node 24.13.0, Windows and Chromium. They are self-verification,
not independent QA, cross-platform certification or legal approval.
CMU and conversion permission evidence is resolved and documented; the actual
remaining gates are owner final-file/hash review and explicit destination/
publication authorization. No public publication or deployment occurred.

The private showcase is a separate review surface, not release approval. Its
historical gallery slide (`0f490b0584cb10515618632d115ff86e20366942d3302408c0dd5cf227e440ea`)
and the later v15 engineering preview
(`083ffe6915a0f3e59c26c630fe6ecb93e0d7d610a18f1bfa9b6528b8479e40d0`) are
distinct 58.6-second assets with five scenes and twelve beats. The v15 asset is
`integration-preview-unapproved`; it does not inherit an earlier revision's
7/10 rating. The rejected replacement hash begins `4499b85c`.
The accompanying silent films are 58.43 seconds/1,753 frames (open source)
and 59.17 seconds/1,775 frames (Julius Caesar). These durations describe the
existing assets and are not publication authorization.

## Verified review candidate: 0.1.0-rc.4 (2026-10-22)

Built on top of `f8be19c8ddaffec585e23e93f90c9e4bc2980d38` with Phases 0–5
implemented (provenance metadata, reduced-motion Play guard and mode overrides,
contact-safe film joins with `footSlides: []`, deterministic npm/offline package
qualification, uncapped generic exports with warnings/progress/cancellation,
versioned deck-provider capability negotiation, and upgraded native diagram
connectors). Artifacts under `.release-local/0.1.0-rc.4/`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `vallahrich-stickman-mcp-0.1.0-rc.4.tgz` | 368,863 | `ce887cf0c6c5a616203d46e3f92909bfcde648dc55662fad955f3cb76a705316` |
| `stickman-source-0.1.0-rc.4.zip` | 3,360,775 | `d015ff674def1bfae6d9ea1104ed56cd4c1e89f79bf8fa808d53d3956ca7a5a0` |
| `stickman-site-0.1.0-rc.4.zip` | 39,375,130 | `d7ee10d8a6f315f2057853492e76d33914c308596f1fe4d3075e60c78cb02cb9` |
| `showcase/open-source.mp4` (contact-safe rc.4 render) | — | `c674dbbb010bcb3dff1f921e2c8522f234a55b80683f025d341fae56483a2232` |
| `showcase/julius-caesar.mp4` (contact-safe rc.4 render) | — | `7fc43b35e6ae9f44baf5a743e64fff7440f55ee0e82b16dc86f0b07fe2fa2cc4` |

Both `verify-candidate.mjs .release-local/0.1.0-rc.4` (`archiveChecksums: "passed"`,
`siteFiles: 337`, `motions: 97`, `runtimeIds: 11`, `errors: []`, `failed: []`)
and `STICKMAN_CANDIDATE_TARBALL=.release-local/0.1.0-rc.4/vallahrich-stickman-mcp-0.1.0-rc.4.tgz`
across all 6 release tests passed.

## Verified release: 0.1.0 (2026-10-22)

Prepared and verified in `.release-local/0.1.0/` alongside `RELEASE-NOTES-0.1.0.md`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `vallahrich-stickman-mcp-0.1.0.tgz` | 368,860 | `b026f0fe44f353ca0b39a255e105cb82d53dfc497b9f8581bd6da2a6f1fb028f` |
| `stickman-source-0.1.0.zip` | 3,360,750 | `39a4db6d44f6b49314c5e65ab3d82cbcef20cafc5b116d10d3624c3154eb5ec9` |
| `stickman-site-0.1.0.zip` | 39,375,110 | `c46dd32e5ee70b555b30be2b6a0146fc44433daeeb9eee12f43bb927a48b4d43` |
| `showcase/open-source.mp4` | — | `c674dbbb010bcb3dff1f921e2c8522f234a55b80683f025d341fae56483a2232` |
| `showcase/julius-caesar.mp4` | — | `7fc43b35e6ae9f44baf5a743e64fff7440f55ee0e82b16dc86f0b07fe2fa2cc4` |

Verified with `node scripts/release/verify-candidate.mjs .release-local/0.1.0`
(`archiveChecksums: "passed"`, `siteFiles: 337`, `motions: 97`, `runtimeIds: 11`,
`noExternalRequests: true`, `errors: []`, `failed: []`) and all 6 outside-checkout
install/MCP/CLI tests in `tests/release.test.ts`. Local tag `v0.1.0` created;
no remote push or public upload performed without explicit owner destination sign-off.
