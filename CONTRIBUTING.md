# Contributing

Thanks for wanting to improve `pi-multi-skills`. This document is the short version of how to
get a change merged without a round trip: how to build, what CI enforces, what the repo
deliberately does *not* do, and how a release is cut.

Agent-driven contributions are first-class here — see [AGENTS.md](AGENTS.md) for the module map,
the invariants you must not break, and the recipes for the usual changes.

## Quick start

```bash
git clone https://github.com/AleixRocal/pi-multi-skills
cd pi-multi-skills
npm ci                # lockfile-exact install; Node >= 22.19.0
npm run verify        # typecheck + tests + tarball check — what CI runs
```

To try your working copy inside pi, without publishing anything:

```bash
pi -e ./pi-multi-skills        # load for one invocation
pi install ./pi-multi-skills   # or install the local checkout
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run verify` | `typecheck` + `test` + `check:pack`. The full local gate. |
| `npm test` | Vitest, 172 specs. `npm run test:watch` while iterating. |
| `npm run typecheck` | `tsc --noEmit`, `NodeNext`, no emit. |
| `npm run check:pack` | Asserts what `npm publish` would ship (entry point + its imports in, tests out). |
| `npm run diagrams` | Regenerates `docs/images/*` from `scripts/diagrams.mjs`. |

## Pull request flow

1. **Branch from `main`.** Fork for external contributions; `fix/…`, `feat/…`, `docs/…` names.
2. **Keep the diff to one concern.** A behaviour change plus its tests; a docs change on its own.
3. **Run `npm run verify` before pushing.** CI runs exactly this, on Node 22 and 24, plus the
   tarball job.
4. **Open the PR** and fill in the template. CI needs no secrets, so it runs on fork PRs.
5. **Merge is a squash**, so the PR title becomes the commit subject — write it as a Conventional
   Commit (below). Maintainers merge once CI is green.

Nothing merges with a red check. If a check looks wrong rather than your change being wrong, say
so in the PR — the byte-parity and packaging checks exist because their failures are silent in
production, not because the rule is sacred.

### Commit / PR title convention

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`,
`refactor:`, `test:`, `ci:`. Scopes are optional and match a module: `fix(parser):`,
`feat(autocomplete):`, `chore(deps):`, `chore(ci):`. `feat:` and `fix:` entries are what the
changelog groups on.

### Changelog

Add your entry to the `## [Unreleased]` section of [CHANGELOG.md](CHANGELOG.md) — `### Added`,
`### Changed`, `### Fixed` — in the same PR. Keep a Changelog order, one line per change, with
the host call site or module you touched, because that is what makes the entry auditable later.

## Repository settings the automation depends on

Four settings make the workflows behave as documented. They are repository configuration, not
files, so they cannot be reviewed in a diff — this is the record of them, and what to do if a
workflow starts behaving oddly.

| Setting | Value | Why it must stay |
| --- | --- | --- |
| *General → Pull Requests* → Allow auto-merge | on | Without it every `gh pr merge --auto` fails, and the Dependabot job goes red on each bump. |
| *General → Pull Requests* → Allow squash merging | on (merge and rebase commits off) | The PR title is the release notes and the changelog subject; only squash preserves that. |
| *Branches* → `main` protection → Require status checks | `typecheck + test (node 22.x)`, `typecheck + test (node 24.x)`, `package (tarball contents)` | This is what makes `--auto` *wait*. Without it, auto-merge merges immediately, before CI finishes. The names must match the `jobs.<id>.name` values in `ci.yml` — renaming a job there without updating the rule silently un-requires it. |
| *Branches* → `main` protection → Allow force pushes / deletions | off | Keeps a published release commit reachable. Direct pushes to `main` are still allowed; only merges are gated by the checks. |

Not required, but recommended after the first npm release: package *Settings → Publishing access* →
"Require two-factor authentication and disallow tokens", once trusted publishing is configured and
has completed one successful publish. The trusted-publisher configuration expires if it does not
publish within two days, so set it up when you are ready to tag, not in advance.

## What belongs here

In scope: making `/skill:` chaining work in pi — tokenising, argument binding, block emission,
the `/skill:` autocomplete menu, transcript rendering, mid-turn discovery through the `skills`
tool, and the packaging/CI around all of it.

Out of scope on purpose (see the README's "Out of scope" section for the reasoning):

- No system-prompt mutation. The extension contributes no `before_agent_start` handler.
- No tool-triggered skill invocation. pi expands skills from user input only, so a tool can list
  but never invoke.
- No `$name`-style invocation. Only pi's `/skill:<name>` syntax is recognised.
- No behaviour change for a single `/skill:<name>` message. That path is byte-identical to pi's
  own expansion and stays that way — it is the interop contract with `@juicesharp/rpiv-args`.

If your change needs a new host API, open an issue first — `extensions.md` in the pi docs is the
place to check what is available.

## Releasing (maintainers)

The release is tag-driven and does everything itself: [`.github/workflows/release.yml`](.github/workflows/release.yml)
verifies, publishes to npm with provenance, and opens the GitHub Release.

1. Bump `version` in `package.json` (SemVer) and date the `## [Unreleased]` section in
   `CHANGELOG.md`, moving it under the new version.
2. Commit that (`chore(release): 0.2.0`) and merge it to `main`.
3. Tag the merge commit and push the tag:
   ```bash
   git tag -a v0.2.0 -m v0.2.0 && git push origin v0.2.0
   ```
4. Watch the `Release` workflow. It refuses to run if the tag and `package.json` disagree, or if
   the version already exists on npm.

Authentication for the npm publish, in order of preference:

- **Trusted publishing (no secret).** On npmjs.com → the package → *Settings* → *Trusted
  publishing* → GitHub Actions, with user `AleixRocal`, repository `pi-multi-skills` and workflow
  filename `release.yml` (filename only, `.yml` included, case-sensitive). **Select “Allow npm
  publish”** — a configuration created today gets `npm stage publish` for free but direct
  publishing only if it is ticked. Needs npm ≥ 11.5.1 and Node ≥ 22.14, which the job pins via
  Node 24.
- **Granular token.** Add an `NPM_TOKEN` repository secret with publish rights to the scope. The
  workflow picks it up automatically when trusted publishing is not configured.

A trusted-publisher configuration that does not complete a successful publish **within two days
expires** and cannot be edited back to life — delete and re-create it. Set it up when you are
about to tag.

### The first release, which is the exception

`0.1.0` was published by hand before any trusted publisher could exist (there is no package
settings page until the package does), and it has no tag: `release.yml` deliberately refuses to
republish a version that is already on npm, so tagging it would only produce a red run. It is
linked from `CHANGELOG.md` by its npm version page instead.

From `0.2.0` on, the flow above is the whole flow:

```bash
npm login              # once per machine; 2FA via the browser
npm publish --access public   # 0.1.0 only, never again
```

If you ever need a release without trusted publishing, create a granular token, add it as the
`NPM_TOKEN` secret, run the tag release, then revoke the token and remove the secret.

The package is eligible for the [pi package gallery](https://pi.dev/packages) through the
`pi-package` keyword in `package.json`; keep that keyword in place.

## Reporting bugs and proposing features

Use the [issue templates](.github/ISSUE_TEMPLATE). For a bug, the highest-value detail is the
exact message you typed — a chain is positional, so `/skill:a /skill:b x` and `/skill:a x
/skill:b` differ — plus your pi and Node versions, and whether it still happens with every other
extension disabled (`pi -e ./pi-multi-skills`).
