# AGENTS.md

Orientation for AI agents working in this repo. Humans want [CONTRIBUTING.md](CONTRIBUTING.md);
the user-facing behaviour lives in [README.md](README.md).

## What this is

A pi package: one TypeScript extension (`extensions/index.ts` → `src/`) that makes a single user
message able to chain several skills — `/skill:a x /skill:b y` — where native pi expands exactly
one and silently swallows the rest as argument text
(`@earendil-works/pi-coding-agent/dist/core/agent-session.js:1697-1721`).

Everything here is pinned to **pi 1.2.0** by reading, not by an API contract: the code comments
cite `file:line` of the host it was verified against. If pi changes those lines, the tests still
pass and the extension can still be wrong. Re-read the cited host file before trusting a comment.

## Commands

```bash
npm ci                 # lockfile-exact; Node >= 22.19.0
npm run verify         # typecheck + tests + tarball check (what CI runs)
npm test               # vitest run — 11 files, 172 specs
npm run test:watch
npm run typecheck      # tsc --noEmit, NodeNext
npm run check:pack     # what `npm publish` would ship
npm run diagrams       # regenerate docs/images/*.svg+.png from scripts/diagrams.mjs
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
| `tests/helpers/mock-pi.ts` | Host fake: commands, UI surface, input events. | — |

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
10. **The tarball contract**: `extensions/index.ts` plus every `src/*.ts` it imports must ship, and
    `tests/`/`scripts/`/`.github/` must not. `npm run check:pack` derives the import list from the
    entry point, so adding a module without shipping it fails CI.

## Recipes

- **Change tokenising or argument binding** → `src/parser.ts` + `tests/parser.test.ts`. Keep it
  free of host and filesystem imports; the rescue path reuses it.
- **Add a new surface** → implement in `src/<name>.ts`, export a `register<Name>(pi)` helper,
  call it from `registerMultiSkills` in `extensions/index.ts`, add `tests/<name>.test.ts`, then
  update the README's Layout/behaviour sections, `CHANGELOG.md` under `[Unreleased]`, and the
  module map above.
- **Investigate a rendering bug** → the contract is in `src/chain-display.ts`'s header comment:
  host `file:line` for the card path, the transformer path, and the marker's reason to exist.
- **Regenerate the diagrams** → edit `scripts/diagrams.mjs` (each diagram is a function returning
  SVG for a light and a dark palette) and run `npm run diagrams`. The script throws when a text run
  would overflow its box, so layout mistakes fail loudly instead of shipping.
- **Release** → see CONTRIBUTING.md → *Releasing*. Tag-driven; never publish by hand after the
  first release.

## Conventions

- TypeScript, `NodeNext`, tabs for indentation (match the file you are editing), explicit `.js`
  extensions in relative imports.
- Comments explain *why*, and cite the host `file:line` that makes the reason true. A comment that
  restates the code is noise; a comment that names the host line is the reason the next agent can
  verify the decision.
- Tests are Vitest, no network, no sleeps; the host is faked through `tests/helpers/mock-pi.ts`.
- Docs are `##`-structured, wrapped near 100 columns, and reference host lines the same way.
- One concern per PR, Conventional Commit title, changelog entry in the same PR.
