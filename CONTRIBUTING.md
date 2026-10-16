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
| `npm test` | Vitest, 191 specs. `npm run test:watch` while iterating. |
| `npm run typecheck` | `tsc --noEmit`, `NodeNext`, no emit. |
| `npm run check:pack` | Asserts what `npm publish` would ship (entry point + its imports in, tests out) and that every `pi` manifest entry resolves inside the tarball. |
| `npm run diagrams` | Regenerates `docs/images/*` from `scripts/diagrams.mjs`, including the gallery cover. |
| `npm run demo:video` | Re-renders `docs/images/demo.mp4` and `demo.gif` from `scripts/demo-video.mjs`. Needs Chromium (`CHROME_BIN`) and ffmpeg (`FFMPEG_BIN`); skips with a message when either is missing. |

## Pull request flow

1. **Branch from `main`.** Fork for external contributions; `fix/…`, `feat/…`, `docs/…` names.
2. **Keep the diff to one concern.** A behaviour change plus its tests; a docs change on its own.
3. **Run `npm run verify` before pushing.** CI runs exactly this, on Node 22 and 24, plus the
   tarball job.
4. **Open the PR** and fill in the template. CI needs no secrets, so it runs on fork PRs. A
   `PR title` check reads the title against the convention below, and it runs in seconds — fix the
   title rather than waiting on a review to hear about it.
5. **Merge is a squash**, so the PR title becomes the commit subject — write it as a Conventional
   Commit (below). Maintainers merge once every check is green; Dependabot bumps enable
   auto-merge themselves, and GitHub waits for the same checks.

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

These repository settings make the automation behave as documented. They are repository
configuration, not files, so they cannot be reviewed in a diff — this is the record of them, and what
to do if a workflow starts behaving oddly.

| Setting | Value | Why it must stay |
| --- | --- | --- |
| *General → Pull Requests* → Allow auto-merge | on | Without it every `gh pr merge --auto` fails, and the Dependabot job goes red on each bump. |
| *General → Pull Requests* → Allow squash merging | on | Recommended, not enforced: a merge commit replaces the PR title on `main`, so the changelog loses the `feat:`/`fix:` grouping that comes from it. Merge commits still work; the history is just less useful. |
| *Branches* → `main` protection → Require status checks | `typecheck + test (node 22.x)`, `typecheck + test (node 24.x)`, `package (tarball contents)`, `conventional title` | This is what makes `--auto` *wait*. Without it, auto-merge merges immediately, before CI finishes. The names must match the `jobs.<id>.name` values in `ci.yml` and `pr-title.yml` — renaming a job there without updating the rule silently un-requires it. |
| *Branches* → `main` protection → Allow force pushes / deletions | off | Keeps a published release commit reachable. Direct pushes to `main` are still allowed; only merges are gated by the checks. |
| *Advanced Security* → Dependabot alerts + Dependabot security updates | on | Alerts alone are a dashboard nobody opens; with security updates on, a vulnerable package anywhere in the tree opens a PR within minutes of the advisory, instead of waiting for Monday's version check. `dependabot-auto-merge.yml` never auto-merges one — a security update reports as `direct:production` or `indirect`, not `direct:development` — so it arrives labelled `needs-review`. Nothing else in this repository scans dependencies. |

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

Authentication for the npm publish — trusted publishing, and nothing else:

- **Trusted publishing (OIDC), current and validated.** On npmjs.com → the package → *Settings* →
  *Trusted publishing* → GitHub Actions, with user `AleixRocal`, repository `pi-multi-skills` and
  workflow filename `release.yml` (filename only, `.yml` included, case-sensitive). It must be
  allowed to **npm publish**, not only to stage: a configuration created today gets
  `npm stage publish` for free and direct publishing only if it is ticked. Needs npm ≥ 11.5.1 and
  Node ≥ 22.14, which the job pins via Node 24. `v0.2.1` was published this way and validated the
  configuration.
- **The workflow proves which credential published.** The publish is two ordered attempts: the
  first deletes the `_authToken` line `setup-node` writes, so npm can only use the GitHub OIDC
  token, and the second keeps a token as a fallback. The step that ran is named in the log, so a
  green release says *how* it authenticated rather than leaving it to be assumed.
- **No token exists.** `NPM_TOKEN` was deleted after `v0.2.1` proved OIDC, and the package should
  be configured to keep it that way: npmjs.com → the package → *Settings* → *Publishing access* →
  "Require 2FA and disallow tokens". If a token is ever needed again — a broken trusted publisher,
  an emergency publish — create a granular token with bypass-2FA, add it with `gh secret set
  NPM_TOKEN`, release, then revoke the token and delete the secret again.

A trusted-publisher configuration that does not complete a successful publish **within two days
expires** and cannot be edited back to life — delete and re-create it, and set it up when you are
about to tag rather than in advance.

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
`pi-package` keyword in `package.json`, and the card's preview comes from `pi.image` / `pi.video` —
absolute `https://aleixrocal.github.io/pi-multi-skills/…` URLs, served by GitHub Pages from
`docs/images/` (`.github/workflows/pages.yml` explains why Pages and not a raw URL: a raw-hosted mp4
arrives as `application/octet-stream` and downloads instead of playing), so the assets live in the
repository and not in the tarball. Pages serves `docs/` as the site root, so `index.html` is what
answers at that root — every asset URL keeps working with or without it, but without it the one URL
a human is likely to type returns GitHub's 404. Regenerate the images with `npm run diagrams` and
these fields are manifest metadata, so they reach npm only with a published version. Both fields are
checked as absolute `https:` URLs by `npm run verify` — by `scripts/check-pack.mjs` against the
published tarball and by `tests/manifest.test.ts` against the working tree.

Note that the gallery's own index is not refreshed by the publish: the package *page* exists from
the moment it is published (`https://pi.dev/packages/@aleixrocal/pi-multi-skills` answers 200 with
the README, while an unknown name is `Page Not Found`), but the *index* is a snapshot of ranked
packages, so the package is absent from it. Measured on 2026-10-16: `pi.dev/packages` has exactly
two sections — *Recently published* (the newest publishes, minutes old) and *All packages* (a
capped, ranked list; the entries sampled carry 30k–56k downloads/month, against 0 for a package
published the day before). There is no pagination (`?page=2` returns the same HTML) and no API
(`/packages.json` 404, `/api/packages` 501). Recency and installs are what move a package into that
snapshot; the keyword and exactly this manifest shape are what eligibility is checked against — see
`docs/packages.md` upstream. Searching for the name is unreliable for a third reason: the unscoped
`pi-multi-skills` on npm belongs to a different author (QuangThai's pi extension) and outranks ours
in the registry search, so the gallery is reached by URL or by the `pi install` name.

## Reporting bugs and proposing features

Use the [issue templates](.github/ISSUE_TEMPLATE). For a bug, the highest-value detail is the
exact message you typed — a chain is positional, so `/skill:a /skill:b x` and `/skill:a x
/skill:b` differ — plus your pi and Node versions, and whether it still happens with every other
extension disabled (`pi -e ./pi-multi-skills`).
