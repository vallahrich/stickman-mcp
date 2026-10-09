# Private development, reviewed public releases

## Status and decisions

On 2026-10-09, read-only GitHub metadata showed `vallahrich/stickman-mcp`
is **private**, default branch `vallahrich-stickman-mcp-engine`, no releases,
and `has_pages: false`. The Pages endpoint returned 404. No visibility,
release, account, deployment or registry settings have been changed.

The owner was unavailable to choose public repository + demo, repository
visibility change, or demo only. This implementation is **local preparation,
not public launch**. Keep the canonical repository private. Do not push to
the retired corporate `origin`; use `vallahrich`.

## Plan

1. **Keep private development.** Work in feature branches, test, review and
   fast-forward/merge under the repository's contribution policy.
2. **Resolve ownership and provenance.** The engine imports embedded
   CMU-derived data from `src/motion-clips.ts` and
   `src/generated/motion-library.ts`. `src/motion-library.ts` explicitly says
   to keep clips private until legal review. `user-approved` motion status is
   a visual/mechanical review, not redistribution permission. Obtain and
   document permission/attribution or replace the data, including derivatives.
   Do not strip attribution or assume MIT covers third-party motion data.
3. **Agree public scope.** Recommended first scope: versioned core library/CLI
   artifacts in a **separate, owner-approved public release repository** under
   vallahrich, with a sanitized README and no private Git history. This remains
   a recommendation, not authorization to create that repository. Full MCP,
   film tooling and a public demo need separate scope/provenance reviews.
4. **Audit and prepare locally.** Exact inputs, clean isolated compilation,
   content hashes, license inventory and exact npm tarball membership;
   no reuse of `dist` and no dependencies bundled.
5. **Review an immutable version.** Use SemVer, e.g. `0.1.0-rc.1` for a
   prerelease. Record private source commit, candidate hash, permission
   evidence, verification and an owner sign-off in a private release log.
   Add sanitized public CHANGELOG/release notes describing the actual scope.
6. **Publish only after explicit approval.** In the approved destination,
   upload only the reviewed artifact, checksum and sanitized release notes
   under a version tag. Never mirror branches/history or use checkout-root
   `npm pack`. Tags/assets should remain stable; fixes get a new version.
7. **Continue improving privately.** Public users retain the stable release
   while private feature branches move forward. Repeat the same review and
   versioned release process for each update. Public feedback may be triaged
   in the eventual public repository without exposing private context.

## Implemented local commands

```powershell
npm run release:check
npm run release:prepare
```

`release:check` prints a JSON audit to stdout: version, exact source/docs
paths and SHA-256, scope, exclusions, license inventory and blockers.
It exits **1 while blocked**. It writes no artifact and is **not a secret scan,
legal review or certification**; do not upload the audit without reviewing it.

`release:prepare` performs the same audit and currently exits **1 before
staging**. No production candidate can currently be built or published.
After owner scope approval and documented content/provenance review, update
the reviewed `scripts/release/policy.mjs` in a normal tested change, recording
every reviewed input hash in `approvedInputs`. Missing, extra or changed hash
entries keep the gate blocked. There is
no `--force`, approval environment variable, publisher or upload workflow.
Do not clear blockers merely to make a command green. Any included file
change requires renewed review and an updated approved hash; hashes identify
content, not permission.

When the gate is legitimately cleared, preparation:

- copies only the exact core TypeScript allowlist, LICENSE, NOTICE and the
  dedicated candidate README into a fresh temporary directory;
- compiles there using installed TypeScript/types (run setup first), checks
  emitted files against the allowlist and removes source/build configuration;
- generates a separate `@vallahrich/stickman-core` package, retaining
  `private: true`, and a SHA-256 manifest of every payload file (the manifest
  does not hash itself); the returned tarball checksum covers the whole archive;
- runs `npm pack --dry-run --ignore-scripts --offline`, verifies membership,
  and then packs locally without install scripts, uploads or network access;
- writes only `.release-local/vallahrich-stickman-core-<version>.tgz`,
  refusing existing artifacts or a symlink output directory, and removes
  temporary staging on success or failure.

The public candidate is **not the existing full package**. It excludes the
MCP server and its source-checkout-dependent film/motion-authoring tools,
SDK, gallery, specs/ratings, presentations, examples, videos, existing
`dist`, browser captures, credentials and repository history. Core SVG/HTML
library and CLI remain usable; optional video dependencies must be installed
separately. LICENSE/NOTICE must be corrected where necessary during legal
review; the current notices are not proof that redistribution is permitted.

Tests exercise the future staging/packing path with a test-only ready audit;
that does **not** clear the production blockers or approve the tested data.

## Public demo / full MCP follow-up

The external dynamic presentation MCP is private/UNLICENSED; do not copy,
package or publish it or its private source deck/output. Full MCP films also
need reviewed script/data dependencies; the core artifact must not advertise
those tools. A demo must be built from independently reviewed public-safe
assets and content, with no private deck screenshots, URLs or end-user data.

GitHub Pages is a hosting option, not implemented here. GitHub Free requires
a public repository for Pages; private-repository eligibility depends on
the plan or organization. Verify the account's current plan and the intended
site's visibility before enabling it:
https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
Do not assume a private source repository makes a Pages site private.

## Release review checklist

- [ ] Owner approves exact public scope/destination and any repository creation.
- [ ] Ownership and third-party redistribution evidence covers all derivatives.
- [ ] Every allowlisted file, candidate README and notice reviewed for private
      content/secrets; no claim that excluded history has been audited.
- [ ] Correct license inventory/attribution; dependencies audited if added.
- [ ] `npm test` and `npm run typecheck` pass.
- [ ] Local preparation, exact tar membership, installed CLI/library smoke
      checks and hashes reviewed for the actual version.
- [ ] Sanitized CHANGELOG/release notes, immutable tag and checksum agreed.
- [ ] Explicit owner authorization for publication; no npm publishing assumed.

Nothing in this document authorizes a visibility change or publication.

## Preparation verification (2026-10-09)

- Full regression suite: 29 test files, 488 tests passed; build and typecheck
  passed. There is no lint command configured in this repository.
- Test-only staging produced the exact 41-file core package: 18 JavaScript
  modules, 18 declarations, package metadata, candidate README, LICENSE,
  NOTICE and hash manifest. Dry-run and actual tarball membership matched.
- The tarball installed offline into a temporary directory outside the
  checkout. CLI discovery, SVG preview, library import and manifest hashes
  passed. The test artifact and installation were removed.
- Both production release commands returned the expected blocked exit code;
  no `.release-local` artifact directory was created.

These checks verify preparation mechanics, not public content approval or
third-party redistribution permission. No public repository, release, Pages
site or npm package was created.
