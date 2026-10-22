# Stickman MCP and animation library

Local deterministic stick-figure animation for presentations, explainers,
websites and silent films. Node.js 20+.

This connected release candidate includes the library, CLI, stdio MCP server,
film composer/renderer, motion authoring, approved motion assets and pose library.
The matching offline gallery is a separate site archive. It demonstrates
motion previews, two original silent films and a native Stickman cloud story.
No external presentation renderer, private history or dependency binaries ship.

## Install the reviewed local candidate

```sh
npm install ./vallahrich-stickman-mcp-0.1.0-rc.1.tgz
npx stickman discover
npx stickman schema
```

Install dependencies normally for rendering: the optional SVG rasterizer and
ffmpeg-static are needed for film/video and PNG strips. Their separate licenses
apply; see NOTICE. SVG/HTML engine exports do not need those renderers.
No package is currently published on npm. The tarball retains `private: true`.

## Library

```js
import { compileAnimation } from "@vallahrich/stickman-mcp";
// Also available: /browser, /room and /keyboard.
```

Node-only `/film` and `/motion-authoring` entries expose the same packaged
composer/render and draft/preview APIs used by the MCP server.

Use the CLI schema or `stickman_discover` and `stickman_schema` to learn the
actual animation contract. Gallery previews and runtime actions are distinct:
the release catalogue includes 97 mechanically qualified film/preview motions
(from the 100-entry ledger; `sneak`, `roll` and `dance` are excluded from
release), whereas `stickman.animation/v1` exposes 11 canonical runtime action IDs.

## Connect the local MCP

Launch `node /path/to/node_modules/@vallahrich/stickman-mcp/dist/mcp.js
--root /path/to/output` from your client's stdio MCP configuration, or use the
installed `stickman-mcp --root /path/to/output` executable.

```json
{
  "mcpServers": {
    "stickman": {
      "command": "node",
      "args": ["./node_modules/@vallahrich/stickman-mcp/dist/mcp.js", "--root", "./stickman-output"]
    }
  }
}
```

Resolve relative paths against the client's launch directory; absolute paths
are more reliable. There is no public HTTP endpoint or required credential.
File-writing tools stay under the launch-time `--root`; review destinations.

Discover → validate → compile → preview → export. Film tools:
`stickman_list_film_assets`, `stickman_compose_film`, `stickman_render_film`,
`stickman_check_join`. Examples ship in `examples/films`.
Author with `stickman_author_motion`: the JSON draft and PNG strip go into a
**new** outputDir under --root, never the installed library.
Preview that draft using `stickman_preview_motion` with `draftDir` equal to
the author's outputDir and a different new outputDir. Without draftDir, preview
reads packaged motions. Drafts do not become approved film assets automatically.
Continuity/anatomy checks are not a promise of arbitrary contact-safe actions.

## Offline site and rights

Extract the matching site zip and serve its directory using a local static
server; no build is required. It contains no analytics, remote renderer or
tracking. Playback is optional and honors reduced-motion defaults.
The separate curated source ZIP can rebuild the package and demos:

```sh
npm install
npm run build
npm run site:showcase -- ./local-site
```

Then set `STICKMAN_SITE_OUTPUT` to that fresh `local-site` directory and run
`npm run site:build -- --release-candidate`. This builds locally only.
For example in PowerShell: `$env:STICKMAN_SITE_OUTPUT = "$PWD/local-site"`.
Do not run npm pack on the private development checkout or assume the source
ZIP is the complete private repository.

LICENSE covers original code and authored vector/key-pose work. CMU-derived
motion data retains its own permission/restriction and attribution in NOTICE
and docs/rights.md; it is not MIT and must not be resold as a standalone dataset.

This is local preparation, **not approval for publication**. Final content,
conversion notices, immutable checksums and destination need owner sign-off.
