# Stickman MCP

An original, deterministic 2D vector stick-figure animation engine for presentation-ready SVG/HTML and optional GIF/MP4 export. The local library, CLI, and stdio MCP server share the same strict contract, compiler, playhead sampler, and renderer. Animation instructions are validated data; the runtime does not execute authored code or call a video-generation service.

## Canonical repository and mirror

The canonical private repository is
[`t-vwallerich_microsoft/stickman-mcp`](https://github.com/t-vwallerich_microsoft/stickman-mcp)
(the linked corporate GitHub login is `t-vwallerich_microsoft`). Every branch
and tag push triggers a GitHub Actions workflow that pushes those refs to the
private [`vallahrich/stickman-mcp`](https://github.com/vallahrich/stickman-mcp)
mirror. The mirror is a downstream copy, not a second source of truth.

The workflow uses the corporate repository secret `VALLAHRICH_MIRROR_KEY`,
which must be a write-enabled deploy key registered only on the vallahrich
mirror. GitHub's Ed25519 host key is pinned in the workflow. Pushes are
non-forcing: a divergent mirror ref causes the sync job to fail visibly rather
than rewriting history. To check sync, inspect the `Mirror to vallahrich`
Actions run and compare the matching branch/tag commit SHAs in both private
repositories.

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

## Contract and catalog

Documents use the strict, versioned `stickman.animation/v1` JSON Schema, available from `src/contract-schema.ts` or `stickman schema`. Unknown fields and unsupported actions produce path-specific diagnostics. See [the wave](examples/wave.json), [walk-and-wave sequence](examples/walk-and-wave.json), and [bound prop push](examples/push-crate.json) examples.

| Action ID | Meaning | Binding |
|---|---|---|
| `walk@1.0.0` | Continuous grounded travel | Named canvas target |
| `run@1.0.0` | Continuous run cadence and airborne phase | Named canvas target |
| `wave@1.0.0` | Arm raise, oscillation, and settle | None |
| `point@1.0.0` | Directional extension toward a named point | Named canvas target |
| `jump@1.0.0` | Anticipation arc and landing | None |
| `push@1.0.0` | Actor and visible prop translate rightward together in two-hand handle contact | Bound prop ID and local handle |

Actions are ordered and non-overlapping, use one deterministic playhead, and return to a stable endpoint. Reduced and static modes sample the meaningful final state without travel or oscillation. Sampling the same program and time produces the same geometry.

## Library, CLI, MCP

The public library entry exports contract types, `validateAnimation`, `compileAnimation`, `sampleAnimation`, `PlaybackSession`, preview renderers, catalog, and safe export helpers. The CLI exposes `discover`, `describe`, `schema`, `validate`, `compile`, `preview`, and `export`.

Start the stdio server with an output root selected at launch:

```powershell
node dist/mcp.js --root C:\Projects\MyPresentation\stickman-output
```

The MCP tools are `stickman_discover`, `stickman_describe`, `stickman_schema`, `stickman_validate`, `stickman_compile`, `stickman_preview`, and `stickman_export`. The server does not edit client configuration or accept an output-root override from a tool request. Register it in an MCP client only after reviewing that client's configuration.

## Export and limitations

- SVG frame/animation and self-contained HTML preview need no renderer service or external assets.
- GIF and MP4 render deterministic SVG frames with optional `@resvg/resvg-js`, then encode with FFmpeg. If either is unavailable, export fails with an actionable error. SVG/HTML remain available.
- The first release has six actions, one geometric actor, and one rightward push interaction with a rectangular prop. It does not claim arbitrary motion understanding, general physics, imported assets, speech, production qualification, or perceptual naturalness. Inspect exported visuals in the intended presentation and validate accessibility/brand requirements separately.
- `PlaybackSession.advance(ms)` is caller-driven and has a single clock; the library starts no hidden ticker or background process.

## Roadmap

Future work should first broaden tested locomotion/facing and prop-contact profiles, then add additional interactions only when their target geometry and contact mechanics are modeled explicitly. Browser-level visual review and encoder compatibility checks are still required before describing output as presentation-qualified; build and unit tests alone are not visual certification.

## Rights and notices

The source and geometric actor are original to this repository and released under [MIT](LICENSE). No source, assets, or derivatives from the separate TemplatePresentation project are included. `@resvg/resvg-js` (optional) and FFmpeg (external) retain their own licenses; see [NOTICE](NOTICE). No third-party character or reference artwork is bundled.
