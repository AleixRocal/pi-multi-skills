# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Comments and test titles no longer cite a design document that lives outside the repository
  (`Decision 1…8`, `plan.md §1`). Each rule states what it prevents where it is enforced: the
  6-skill cap degrading into readable text, an unresolvable token staying verbatim, the renderer's
  substring gate on the user-message hot path. The code comments are proof-carrying only when the
  reader can follow them, and a private document cannot be followed.

## [0.2.1] - 2026-10-15

### Changed

- README: the Star History section is the chart alone; the sentence that explained what the
  embed does sat between the reader and the thing it described.
- `release.yml`: publishing is now two ordered attempts. The first runs with no token in scope —
  it deletes the `_authToken` line `setup-node` writes — so npm can only authenticate with the
  GitHub OIDC token, which makes "trusted publishing works" a fact in the log instead of an
  assumption. The second keeps the `NPM_TOKEN` secret as a fallback, and the run says which one
  published.
## [0.2.0] - 2026-10-15

### Changed

- `package.json` `homepage` points at the repository, so the npm page links back to GitHub; the
  repository's Website field points at the npm page and its topics mirror the package keywords.
  npm only re-reads a package's manifest when a new version is published, which is what this
  release is for.
- README: the star history chart is star-history.com's current `<picture>` embed (light and dark),
  and a Links table collects the npm page, the pi gallery, the releases and the issue tracker.
- First release published by the `Release` workflow through npm trusted publishing (OIDC) rather
  than a repository secret, so the tag, the tarball and the GitHub Release all come from CI.

## [0.1.0] - 2026-10-15

### Added

- First public release: published to npm as `@aleixrocal/pi-multi-skills`, and eligible for the
  [pi package gallery](https://pi.dev/packages) through the `pi-package` keyword.
- `LICENSE` (MIT, extensionless — the name GitHub, npm and SPDX tooling detect), shipped in the
  publish tarball and asserted by `npm run check:pack`.
- `scripts/release-notes.mjs` (`npm run release:notes`): the GitHub Release body is the
  `CHANGELOG.md` section for the released version. A tag whose version has no dated entry now
  fails the release job before the publish, instead of shipping generated PR titles.
- Star history chart in the README, rendered live from star-history.com (light and dark variants),
  with a stars badge in the header.
- `input` handler that rewrites `/skill:a /skill:b args` into N sibling `<skill …>` blocks, with
  positional argument binding and a six-skill cap.
- Byte-exact emission of pi's native skill block (`dist/core/agent-session.js:1709`), so the
  single-skill case is unchanged.
- Order-independent handling of `@juicesharp/rpiv-args`: residual `/skill:` tokens left behind by
  the sibling expander are still expanded.
- Read-only `skills` tool for mid-turn skill discovery, reporting each skill's canonical SKILL.md
  path.
- Markdown transformer that renders a chain in the transcript as the chain that was typed —
  `/skill:research refactor auth /skill:design write tests` — instead of a skill card plus raw XML.
  A chain carries one leading zero-width space so the host takes its plain-text path, which is the
  only path that runs markdown transformers; a single `/skill:name` message keeps pi's own card.
- `/skill:` autocomplete at every chain position: the host's menu is line-start only, so a second
  token showed none. The provider is now wrapped to complete skill names after the first token —
  bare (`/pl`), marker-prefixed (`/skill:pl`) or half-typed (`/skill`, `/s`) — naming each entry
  `/skill:<name>`, and leaving every other completion surface to pi.
- `package.json` manifest, TypeScript `NodeNext` config, a vitest suite, and `.gitignore` coverage
  for `.npmrc`.
- Continuous integration: `.github/workflows/ci.yml` runs `npm ci`, `typecheck` and the suite on
  Node 22 and 24 for every pull request and push to `main`, plus a job that asserts the publish
  tarball carries the entry point and its imports and never the tests. No secrets, so fork PRs
  are covered.
- Release automation: `.github/workflows/release.yml` is tag-driven — a `v*` tag that matches
  `package.json` re-runs the gate, refuses an already-published version, publishes with npm
  provenance (trusted publishing, or an `NPM_TOKEN` secret), and opens the GitHub Release.
- Dependabot configuration and an auto-merge workflow: grouped weekly bumps, with dev-dependency
  patch/minor PRs squash-merged once CI is green and everything else labelled `needs-review`.
- Contributor surface: `AGENTS.md` (module map, the ten quiet-failure invariants, recipes),
  `CONTRIBUTING.md` (commands, PR flow, release checklist), a pull-request template and issue
  templates that ask for the exact message typed.
- System diagrams in `docs/images/` (light and dark SVG plus PNG renders) generated by
  `scripts/diagrams.mjs`, which refuses to emit a diagram whose text would overflow its box:
  architecture, message flow, the input-hook decision flow, and the autocomplete positions.
- `npm run check:pack` (`scripts/check-pack.mjs`) and `npm run verify`, the local equivalent of
  the CI gate.

### Changed

- README restructured around the diagrams and the documents above: badges, install, syntax,
  behaviour, cost, and pointer sections for contributors and agents.

[Unreleased]: https://github.com/AleixRocal/pi-multi-skills/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/AleixRocal/pi-multi-skills/releases/tag/v0.2.1
[0.2.0]: https://github.com/AleixRocal/pi-multi-skills/releases/tag/v0.2.0
[0.1.0]: https://www.npmjs.com/package/@aleixrocal/pi-multi-skills/v/0.1.0
