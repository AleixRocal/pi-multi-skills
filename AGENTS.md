# AGENTS.md

Orientation for AI agents working in this repo. Humans want [CONTRIBUTING.md](CONTRIBUTING.md);
the user-facing behaviour lives in [README.md](README.md).

## What this is

A pi package: one TypeScript extension (`extensions/index.ts` → `src/`) that makes a single user
message able to chain several skills — `/skill:a x /skill:b y` — where native pi expands exactly
one and silently swallows the rest as argument text
(`@earendil-works/pi-coding-agent/dist/core/agent-session.js:1698-1722`).

Everything here is pinned to **pi 1.3.0** by reading, not by an API contract: the code comments
cite `file:line` of the host it was verified against. If pi changes those lines, the tests still
pass and the extension can still be wrong. Re-read the cited host file before trusting a comment.

## Commands

```bash
npm ci                 # lockfile-exact; Node >= 22.19.0
npm run verify         # typecheck + tests + tarball + host citations (what CI runs)
npm test               # vitest run — 14 files, 195 specs
npm run test:watch
npm run typecheck      # tsc --noEmit, NodeNext
npm run check:pack     # what `npm publish` would ship, manifest included
npm run check:host     # every cited host `file:line` still holds its text
npm run check:host -- --update  # re-snapshot after a host bump; the diff is the re-read
npm run diagrams       # regenerate docs/images/*.svg+.png from scripts/diagrams.mjs
npm run skill:zip      # dist/<skill>.zip — the marketplace upload artifact
```

`npm run verify` is the gate. Do not report work as done while it fails.

## Module map

| Path | Owns | Spec |
| --- | --- | --- |
| `extensions/index.ts` | Registration only: `input`, `session_start`, the `skills` tool, the markdown transformer. Thin by design. | — |
| `src/types.ts` | Shared vocabulary (`SkillEntry`, `SkillToken`, `SkillChain`). Imports no host code. | — |
| `src/parser.ts` | `/skill:` tokenisation, positional argument binding, `MAX_CHAINED_SKILLS = 6`. Pure, no I/O. | `tests/parser.test.ts` |
| `src/registry.ts` | Name → `SKILL.md` index built from `pi.getCommands()`; one module-level cache, invalidated on `session_start`. | `tests/registry.test.ts` |
| `src/expander.ts` | Byte-exact `<skill …>` block emission; reads skill bodies; `null` when nothing expanded. | `tests/expander.test.ts`, `tests/emit-order.test.ts` |
| `src/input-handler.ts` | The `input` hook: guards, clean path, rescue path, marking for display. | `tests/input-handler.test.ts` |
| `src/chain-display.ts` | The display marker (U+200B) and the block → `/skill:` rewrite. | `tests/chain-display.test.ts` |
| `src/renderer.ts` | The markdown transformer: user-message markdown only, and only when a block is present. | `tests/renderer.test.ts` |
| `src/autocomplete.ts` | Chain-token detection at the cursor and the `ctx.ui` provider wrapper. | `tests/autocomplete.test.ts`, `tests/host-provider.test.ts` |
| `src/skills-tool.ts` | Read-only `skills` listing tool (TypeBox params, direct exposure). | `tests/skills-tool.test.ts` |
| `skills/skill-chain/` | The model-facing half: what a chain is, positional binding, the closing report. Ships in the package and installs standalone into any agent. | `tests/skill-package.test.ts` |
| `tests/manifest.test.ts` | The `pi` manifest contract: the gallery keyword, the resource shapes the host reads, entry resolution, host packages as peers, absolute preview URLs. | `scripts/check-pack.mjs` (the same rules against the tarball) |
| `tests/helpers/mock-pi.ts` | Host fake: commands, UI surface, input events. | — |
| `scripts/check-host.mjs` | Resolves every cited host `file:line`, hashes the cited range, and fails when the text moved — or when a citation was never snapshotted. `--update` rewrites the snapshot. | `tests/host-baseline.test.ts` |
| `scripts/host-baseline.json` | The committed snapshot: host versions, one entry per citation (resolved file, line spec, range hash, boundary text), and a hash per shipped host doc. Generated, never hand-edited. | `scripts/check-host.mjs` |

`tests/editor-integration.test.ts` drives the real pi-tui editor against the wrapper, which is why
autocomplete regressions show up as a test failure rather than as a menu that does not open.

## Invariants — do not change these silently

Each one is load-bearing against a host behaviour that fails **quietly**:

1. **Byte-exact block emission** (`src/expander.ts`). `parseSkillBlock`
   (`agent-session.js:53-63`) is `^…$`-anchored with an optional trailing group separated by
   exactly `\n\n`. One character of drift and the message falls back to raw text — no error.
2. **A single `/skill:<name>` message must stay byte-identical to native pi** and to
   `@juicesharp/rpiv-args` (`args.ts:367-373`). That is the interop contract; the two extensions
   must be interchangeable in either handler order.
3. **The display marker is a zero-width space (U+200B), never whitespace.** `trim()` does not
   remove it (format category, not `Zs`), so no host-side strip can resurrect the skill card. It
   changes rendering, never what the model reads.
4. **Guard on `event.source === "extension"` first** (`src/input-handler.ts`). `pi.sendUserMessage`
   forces that source, so it is the only thing that breaks a loop over our own output.
5. **Unknown skill → leave that span verbatim**, never bail on the whole message. `/skill:real x
   /skill:typo y` must still expand `real`.
6. **The rescue path scans only the text after the last `</skill>`.** A skill body is prose and
   may mention `/skill:` legitimately; scanning a block's body emits phantom blocks.
7. **The cap is six.** A seventh marker stays literal text and therefore ends up inside the sixth
   skill's argument text — user text is truncated deterministically, never deleted.
8. **Host packages stay in `peerDependencies` / `devDependencies`, never `dependencies`.** A
   physical copy of `@earendil-works/*` or `typebox` bypasses pi's module mapping and produces
   duplicate classes and registries; pi warns when it detects this.
9. **Only `context.messageType === "user"` markdown is transformed**, and only when it contains a
   block. Transformers also run on assistant output.
10. **The tarball contract**: `extensions/index.ts` plus every `src/*.ts` it imports and every file
    under `skills/` must ship, and `tests/`/`scripts/`/`.github/` must not. `npm run check:pack`
    derives the import list from the entry point and walks the skill directories, so adding a module
    or a `references/` page without shipping it fails CI.
11. **The `pi` manifest is the only source of resources.** With a `pi` block, the host reads the
    manifest and returns before it ever walks the conventional directories
    (`package-manager.js:1865-1871`), and a field that is not an array of strings is dropped without
    a word (`pi-manifest.js:16-18`). A shipped resource the manifest omits — or an entry that misses
    the tarball — is a package pi loads nothing from, silently. `scripts/check-pack.mjs` and
    `tests/manifest.test.ts` hold the same rules against the tarball and the working tree.
12. **A citation is a claim, and the baseline is what makes it checkable.** Every cited `file:line`
    is registered in `scripts/host-baseline.json` with a hash of the cited range. `npm run check:host`
    fails when the range's text moves, when the lines vanish, or when a source cites a host line that
    was never snapshotted — it cannot fail on a citation that merely *reads* wrong, which is why the
    prose still has to be re-read on a bump. Adding a citation means running
    `npm run check:host -- --update` and committing the resulting entry; a citation the baseline does
    not carry is unverified, not passing.

## Recipes

- **Change tokenising or argument binding** → `src/parser.ts` + `tests/parser.test.ts`. Keep it
  free of host and filesystem imports; the rescue path reuses it.
- **Add a new surface** → implement in `src/<name>.ts`, export a `register<Name>(pi)` helper,
  call it from `registerMultiSkills` in `extensions/index.ts`, add `tests/<name>.test.ts`, then
  update the README's behaviour sections (user-facing only; dev material belongs in this file and
  `CONTRIBUTING.md`), `CHANGELOG.md` under `[Unreleased]`, and the module map above.
- **Change a skill** → edit `skills/<name>/SKILL.md` (reference material belongs in its
  `references/`), then run `npm test`: `tests/skill-package.test.ts` holds the rules that fail
  quietly elsewhere — the frontmatter name must equal the directory (other Agent Skills
  implementations refuse a mismatch), the description needs a trigger or the skill is never loaded,
  linked files must exist, and the manifest plus `files` must actually expose it. `npm run skill:zip`
  rebuilds the marketplace archive from the same files.
- **Investigate a rendering bug** → the contract is in `src/chain-display.ts`'s header comment:
  host `file:line` for the card path, the transformer path, and the marker's reason to exist.
- **Regenerate the diagrams** → edit `scripts/diagrams.mjs` (each diagram is a function returning
  SVG for a light and a dark palette) and run `npm run diagrams`. The cover is one of them: it is
  rendered at 1x and is the file the gallery preview (`pi.image` in `package.json`) points at, so a
  change there is only visible on npm after a release. The script throws when a text run
  would overflow its box, so layout mistakes fail loudly instead of shipping. The README embeds
  every diagram as a markdown image, never a `<picture>` block: the pi gallery renders the README
  out of the published tarball and drops that element with its children, which cost the two inline
  diagrams their place on the gallery page, and npm sanitizes the HTML the same way. Don't re-add a
  "light and dark" link list to the README: the diagrams that are not embedded inline are linked
  from `docs/index.html`, which is what the Pages root is for. `docs/index.html` is the
  Pages site root: `pages.yml` publishes `docs/`, and GitHub Pages answers 404 for a directory with
  no `index.html`, so deleting that file breaks no asset URL and still 404s the root.
- **Regenerate the demo video** → `scripts/demo-video.mjs`: one HTML page whose `renderAt(ms)` is the
  entire animation, driven over the DevTools protocol (`renderAt`, a double-`requestAnimationFrame`
  wait, then a screenshot — a headless page that is not focused is throttled and would return the
  previous paint). Two things are checked rather than trusted: every frame must be exactly 1280x720
  (libx264 refuses odd heights, and a wrong viewport crops silently), and the page must expose
  `window.renderAt` (a missing page once produced 240 identical frames of Chromium's error page).
  It is a rendering of asserted behaviour, not a screen recording — keep any wording in it honest
  about that, and remember `pi.video` only refreshes on npm when a version is published. Two
  outputs are produced from the same frames: the mp4 (`pi.video`, served by jsDelivr because
  `raw.githubusercontent.com` returns `application/octet-stream` for mp4, which downloads instead
  of plays) and the GIF the README shows inline (GitHub plays an animated GIF and cannot play a
  raw-hosted mp4).
- **Change what the CodeRabbit review says** → `.coderabbit.yaml` (not shipped; `files` keeps it out of
  the tarball). Keys are validated against CodeRabbit's published JSON schema, so a typo is rejected
  on the next PR rather than silently ignored — but nothing here checks it offline, and the network
  is not available to CI. The review is advisory on purpose: it is not one of the required status
  checks in CONTRIBUTING.md → *Repository settings*, and `request_changes_workflow: false` keeps it
  from ever blocking. When it asks for a change this repo rejects by design (tabs, a comment that
  cites a host line, the byte-exact skill block), the fix belongs in this file, not in the code.
- **Release** → see CONTRIBUTING.md → *Releasing*. Tag-driven; never publish by hand after the
  first release.

A host bump is a re-read, not a lockfile edit — and `npm run check:host` is what turns it into a
mechanical one:

```bash
npm run check:host -- --update      # re-snapshot against node_modules/@earendil-works/*
git diff scripts/host-baseline.json # THIS diff is the re-read
```

Line numbers moving is a bump that changed no cited text. A `first`/`last`/`sha256` changing is a
bump that changed cited behaviour: read that function. The failure path names the new line
(`the expected text now starts at :54 (+1)`), so a red CI run is a work instruction, not a search.
From 1.2.0 to 1.3.0 no cited region changed its text — only its line number, by `+1` in
`agent-session.js`, `+2` in `interactive-mode.js` and `+5` in `export-html/template.js` — which is
exactly the drift a reader cannot see, and the case the range hash exists for. The same run lists
the shipped host docs whose text changed since the snapshot (`docs/extensions.md`, `docs/tui.md`, …)
because those are the pages worth reading before trusting a moved citation; a docs-only change warns
and does not fail, since it is not a behaviour change.

## Conventions

- TypeScript, `NodeNext`, tabs for indentation (match the file you are editing), explicit `.js`
  extensions in relative imports.
- Comments explain *why*, and cite the host `file:line` that makes the reason true. A comment that
  restates the code is noise; a comment that names the host line is the reason the next agent can
  verify the decision — and the line is registered in `scripts/host-baseline.json`, so the next agent
  can also find out that it moved.
- Tests are Vitest, no network, no sleeps; the host is faked through `tests/helpers/mock-pi.ts`.
- Docs are `##`-structured, wrapped near 100 columns, and reference host lines the same way.
- One concern per PR, Conventional Commit title, changelog entry in the same PR.
