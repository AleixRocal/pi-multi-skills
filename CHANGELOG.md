# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `input` handler that rewrites `/skill:a /skill:b args` into N sibling `<skill …>` blocks, with
  positional argument binding and a six-skill cap.
- Byte-exact emission of pi's native skill block (`dist/core/agent-session.js:1709`), so the
  single-skill case is unchanged.
- Order-independent handling of `@juicesharp/rpiv-args`: residual `/skill:` tokens left behind by
  the sibling expander are still expanded.
- Read-only `skills` tool for mid-turn skill discovery, reporting each skill's canonical SKILL.md
  path.
- Markdown transformer that collapses blocks 2..N of a chained message into one-line references in
  the interactive transcript.
- `package.json` manifest, TypeScript `NodeNext` config, a vitest suite, and `.gitignore` coverage
  for `.npmrc`.

[Unreleased]: https://github.com/AleixRocal/pi-multi-skills/commits/main
