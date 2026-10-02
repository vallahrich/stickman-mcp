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
repositories. **This corporate repository currently has GitHub-hosted Actions
runners disabled by its Enterprise policy.** The workflow is committed but
cannot execute until an administrator enables a runner. The canonical
development checkout is configured with two `origin` push URLs, so normal
branch/tag pushes from its linked worktrees push to both private repositories.
That Git configuration is local and is not inherited by a fresh clone. Until
an administrator enables Actions, configure dual push URLs for a fresh clone
and authenticate its corporate HTTPS and `github-vallahrich` SSH remotes, or
push each branch/tag to both remotes explicitly:

```powershell
git push origin HEAD:refs/heads/<branch>
git push https://github.com/vallahrich/stickman-mcp.git HEAD:refs/heads/<branch>
git push origin --tags
git push https://github.com/vallahrich/stickman-mcp.git --tags
```

Authenticate each remote with its corresponding GitHub account. Do not force
push; if the mirror rejects a ref as non-fast-forward, inspect and reconcile
the divergence before retrying.

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

Actions are ordered and non-overlapping and use one deterministic playhead. Walk, run, and point infer left/right facing from their existing target coordinates; no facing field is required. The quality rebuild uses fixed-length skeletal poses and explicit world-space foot contacts, not a facing scale that flattens the rig during turns.

Push remains rightward. Validation resolves reach from the actual preceding actor endpoint and rejects infeasible timing, grips, canvas fit, or body/prop overlap. Approach, supported drive and release are derived from feasible poses rather than guaranteed fixed 15/70/15 percentages. Reduced and static modes preserve the meaningful final state. Sampling the same program and time produces the same geometry. Locomotion uses one flat world floor: travel target Y must match that floor, and pushed crates must rest on it.

## Library, CLI, MCP

The public library entry exports contract types, `validateAnimation`, `compileAnimation`, `sampleAnimation`, `PlaybackSession`, preview renderers, catalog, and safe export helpers. The CLI exposes `discover`, `describe`, `schema`, `validate`, `compile`, `preview`, and `export`.

Start the stdio server with an output root selected at launch:

```powershell
node dist/mcp.js --root C:\Projects\MyPresentation\stickman-output
```

The MCP tools are `stickman_discover`, `stickman_describe`, `stickman_schema`, `stickman_validate`, `stickman_compile`, `stickman_preview`, and `stickman_export`. Their advertised input schemas are enforced without type coercion. Results retain the existing JSON text and add schema-described structured output; unknown tools are protocol errors, while argument and execution failures are actionable tool errors. The server does not edit client configuration or accept an output-root override from a tool request.

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

Future work should first broaden tested locomotion/facing and prop-contact profiles, then add additional interactions only when their target geometry and contact mechanics are modeled explicitly. The bounded scripted review and decoded movie checks are not cross-browser or universal encoder certification; build and unit tests alone are not visual approval.

## Rights and notices

The source and geometric actor are original to this repository and released under [MIT](LICENSE). No source, assets, or derivatives from the separate TemplatePresentation project are included. `@resvg/resvg-js` (optional) and FFmpeg (external) retain their own licenses; see [NOTICE](NOTICE). No third-party character or reference artwork is bundled.
