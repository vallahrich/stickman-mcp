# Stickman core release candidate

This candidate contains the core animation library, browser/room/keyboard
entries and the `stickman` CLI. It does **not** include the MCP server, film
composition, motion authoring, gallery, presentation workflows, decks, videos,
examples, private checkout history or dependencies.

This file is the candidate README, not the private repository README.
Only publish after the owner-approved scope, redistribution permissions and
file-by-file content review are documented and the release gate is cleared.

Requires Node.js 20+. Install a reviewed local tarball with
`npm install ./vallahrich-stickman-core-<version>.tgz`, then use
`npx stickman discover` or `npx stickman schema`.
The library is available as `@vallahrich/stickman-core`; browser integration
entry points are `/browser`, `/room` and `/keyboard`.

SVG and HTML previews work without optional video packages. For GIF/MP4,
install `@resvg/resvg-js` separately and provide your own licensed FFmpeg
executable on PATH. No dependencies or executables are bundled.

The distribution retains `private: true`: local installation is supported,
but npm registry publication is deliberately disabled. A local tarball is not
an approval to publish it.
