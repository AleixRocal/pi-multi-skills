# Pull request

## What and why

<!--
One paragraph. What changes, and which host behaviour or bug makes it necessary.
Title this PR as a Conventional Commit, e.g. `fix(parser): bind args after a
mid-message token` — the title becomes the squash commit and the changelog groups
on it.
-->

## How it was verified

<!-- `npm run verify` output, plus any manual check inside pi. Say what you typed. -->

- [ ] `npm run verify` passes locally (typecheck + tests + tarball check)
- [ ] Tests added or updated, and they fail without the source change
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]`

## Invariants

<!-- Tick what you preserved. Untick only with an explanation — these fail quietly. -->

- [ ] A single `/skill:<name>` message is still byte-identical to native pi
- [ ] Block emission is unchanged (the `\n\n` separator, no trailing newline)
- [ ] An unknown skill still expands nothing and leaves its span verbatim
- [ ] No host package moved into `dependencies`
- [ ] Docs touched where behaviour changed (README / AGENTS.md module map)

## Host version checked

<!-- The host lines this change depends on were read against these versions. -->

pi version:
node version:
