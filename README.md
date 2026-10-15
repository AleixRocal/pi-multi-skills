# pi-multi-skills

Chain several `/skill:` invocations in a single pi message.

[![CI](https://github.com/AleixRocal/pi-multi-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/AleixRocal/pi-multi-skills/actions/workflows/ci.yml)
[![Release](https://github.com/AleixRocal/pi-multi-skills/actions/workflows/release.yml/badge.svg)](https://github.com/AleixRocal/pi-multi-skills/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@aleixrocal/pi-multi-skills?label=npm)](https://www.npmjs.com/package/@aleixrocal/pi-multi-skills)
[![GitHub stars](https://img.shields.io/github/stars/AleixRocal/pi-multi-skills?label=stars&color=blue)](https://www.star-history.com/#AleixRocal/pi-multi-skills&Date)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

pi expands exactly one skill per message. Given `/skill:a /skill:b args` it resolves `a` and
silently swallows `/skill:b args` as that skill's argument text — no error, no signal
(`dist/core/agent-session.js:1697-1721`). This extension registers an `input` handler that runs
*before* pi's own expansion and rewrites the message into N sibling `<skill …>` blocks: one per
named skill, each followed by the argument text that skill owns.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/architecture.dark.svg">
  <img alt="Where pi-multi-skills hooks into pi: the message path, and the four extension surfaces" src="https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/architecture.light.svg">
</picture>

[![The autocomplete menu opening at the second token, then the two skill blocks the model receives](https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/demo-poster.png)](https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/demo.mp4)

Twelve seconds of the flow, from the menu opening at the second `/skill:` token to the blocks the
model receives ([`docs/images/demo.mp4`](docs/images/demo.mp4), 1280×720). Generated from the
behaviour the test suite asserts rather than screen-recorded — `npm run demo:video` renders it frame
by frame, which is why it does not drift from the code.

| Document | For |
| --- | --- |
| [AGENTS.md](AGENTS.md) | AI agents: module map, invariants, recipes, what must not change. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Humans: commands, PR flow, release checklist. |
| [CHANGELOG.md](CHANGELOG.md) | What changed, per version. |

## Install

```bash
pi install npm:@aleixrocal/pi-multi-skills
pi install git:github.com/AleixRocal/pi-multi-skills
pi install ./pi-multi-skills                 # from a local checkout
```

The package carries the `pi-package` keyword, which is what makes it eligible for discovery in the
[pi package gallery](https://pi.dev/packages) — the same package `pi install` resolves from npm.
Requires Node `>=22.19.0`; the host packages are provided by pi.

## Syntax

- **`/skill:<name>` is a token**, wherever it appears in the message — not only at the start.
- **Each token owns the text that follows it**, up to the next token (or to the end of the message
  for the last one). That is *positional binding*: in `/skill:a x /skill:b y`, `a` is invoked with
  the argument text `x` and `b` with `y`.
- **A contiguous run still broadcasts.** `/skill:a /skill:b shared args` — the shape Claude Code's
  stacked skills use — produces `B(a)\n\nB(b)\n\nshared args`: the argument text is appended once,
  after the last block, exactly as pi's native single-skill expansion appends it.
- **Six skills maximum.** A seventh `/skill:` marker is not expanded: it stays literal text and
  therefore ends up inside the sixth skill's argument text, so nothing typed is deleted.
- **`/skill:a args` is unchanged.** With one skill the extension emits byte-identical output to
  pi's own expansion, so the native skill card and `@juicesharp/rpiv-args` interop behave exactly
  as before.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/message-flow.dark.svg">
  <img alt="One typed message: native pi resolves one skill and swallows the rest; with the extension both skills resolve" src="https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/message-flow.light.svg">
</picture>

## Behaviour

### Unknown skills stay verbatim

A token that names no skill in the session, or whose `SKILL.md` cannot be read, is left in the
message exactly as typed while every other token still expands. `/skill:nonexistent /skill:real x`
therefore still invokes `real`.

### A bare `/` never triggers

Only the literal `/skill:` marker is a token. Absolute paths (`/etc/hosts`), relative paths
(`src/app.ts`), URLs (`https://example.com/x`) and a lone slash in prose pass through untouched.

### Order independence with `@juicesharp/rpiv-args`

`@juicesharp/rpiv-args` expands the same syntax, and extension load order is not controllable. When
it runs first it consumes the leading `/skill:a` and leaves `/skill:b args` as plain text; this
extension detects the residual token after the last emitted block and expands it, so both load
orders produce the same chain. Already-emitted `<skill …>` blocks are never reprocessed, and a
skill body that happens to mention `/skill:` is never re-expanded.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/handler-flow.dark.svg">
  <img alt="The input hook: guards, the clean path, the rescue path, and every return that leaves pi unchanged" src="https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/handler-flow.light.svg">
</picture>

### Autocomplete at every chain position

Pi's own menu is line-start only: `CombinedAutocompleteProvider.getSuggestions`
(`@earendil-works/pi-tui/dist/autocomplete.js:232-235`) enters the command branch only when the text
before the cursor, trimmed, starts with `/` **and** carries no space — so a second token falls
through to the argument branch (`:263-271`), finds no argument completions, and shows no menu. This
extension wraps the provider (`ctx.ui.addAutocompleteProvider`) and supplies the missing case.

Entries are named `/skill:<name>`, the exact text the choice writes, and the menu takes two shapes:

- **Marker typed or half-typed** — `/skill:pl`, `/skill:`, `/skill`, `/sk`, … — listed on the
  partial name, or on every skill while only the marker is partial.
- **Bare name fragment** — `/pl` — listed on the name. This is the shape a user reaches for after
  picking the first skill from pi's own menu, which inserts the whole marker.

Both are accepted only **past the first token** and only while the fragment stays name-shaped, so
`check /srv` and `/skill:implement /plans/x.md` keep pi's path completion
(`autocomplete.js:388-390`) instead of offering skills.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/autocomplete.dark.svg">
  <img alt="The wrapper answers at a chain position and delegates every other completion request to pi" src="https://raw.githubusercontent.com/AleixRocal/pi-multi-skills/main/docs/images/autocomplete.light.svg">
</picture>

- **Everything else is delegated unchanged.** The first token (pi's menu there lists every command,
  not only skills), `@` attachments, file paths, argument completions and non-chain commands all
  come from pi's own provider.
- **`/` alone starts nothing mid-message.** The editor auto-triggers on `/` only at the start of the
  message (`components/editor.js:1022-1027`) and refuses `/` as a trigger character
  (`:1952-1956`), so the request the second `/` would have made happens on the character after it —
  unless the list is still open from the first token, in which case `/` does request and the menu
  opens on the slash itself (`:1029-1037`). Either way the next character settles it, and
  half-typed markers and bare fragments are accepted for that reason.
- **A leading fragment in prose is left to pi.** `/s` counts as a chain position only when a token
  is already committed before it, so `check /srv` keeps pi's path completion
  (`autocomplete.js:388-390`) instead of offering skills.
- **Tab inside a chain token completes the skill** rather than searching for a file path.
- **The six-skill cap applies to the menu too.** Once six markers are on the line, a seventh offers
  no names: it would not expand.

### `skills` — mid-turn discovery

A read-only tool named `skills` lists the skills available in the session, with the canonical
`SKILL.md` path for each one:

```text
skills({ "query": "design", "limit": 20 })
→ { skills: [{ name, description, location }], total, truncated }
```

`query` matches names and descriptions case-insensitively; `limit` pages the result (`total` and
`truncated` report what was left out). The tool never invokes a skill — pi expands skills from user
input only — but `location` is readable with the built-in `read` tool.

### Transcript rendering

A chain is displayed as the chain that was typed — one `/skill:<name>` per token, each followed by
its own argument text:

```text
/skill:research refactor auth /skill:design write tests
```

No XML block, no injected body. The transformer that does this is display-only: the session message
the model sees still carries the full blocks.

Why the message is *marked* for that: `parseSkillBlock` is `^…$`-anchored, and a message that starts
with a well-formed block is rendered by pi's collapsible skill card, which runs no markdown
transformers (`components/skill-invocation-message.js:9-37`) — the only display hook an extension
has. So a chain carries one leading zero-width space (`src/chain-display.ts`), which defeats the
anchored parse and hands the whole message to the transformer instead. The marker is invisible and
is never whitespace, so no host-side trim can resurrect the card.

- **A single `/skill:name` message is untouched** — it keeps pi's normal collapsible card, byte for
  byte as native pi and `@juicesharp/rpiv-args` produce it.
- **The HTML export is not transformed** (`pi --export`). It parses the same anchored way and runs
  no extensions, so an exported chain shows its blocks as plain text.

### Out of scope

- No system prompt is mutated — the extension contributes no `before_agent_start` handler.
- A tool call cannot invoke a skill. pi expands `/skill:` on user input only, so `skills` lists and
  never triggers.
- Only pi's `/skill:<name>` syntax is recognised. The `$name`-style invocation used by other tools
  is not supported.

## Cost

A chained message carries the full body of every named skill: six large skills means six bodies in
context. Nothing is truncated or cached — a skill edited mid-session is picked up on the next
message.

## If you are an AI agent

Read [AGENTS.md](AGENTS.md) before editing anything: it holds the module map, the ten invariants
that fail *quietly* when broken (byte-exact block emission, the `\n\n` separator, the zero-width
marker, the six-skill cap), and recipes for the usual changes.

```bash
npm ci && npm run verify    # typecheck + 172 specs + the publish-tarball contract
npm run diagrams            # regenerate docs/images from scripts/diagrams.mjs
npm run demo:video          # re-render docs/images/demo.mp4 (needs Chromium + ffmpeg)
```

Ground rules: one concern per PR, tests with the change, a `CHANGELOG.md` entry under
`[Unreleased]`, and no host package in `dependencies`. Never treat a passing suite as proof that a
host-behaviour claim still holds — every claim in this repo cites the host `file:line` it was read
against, and those lines move between pi versions.

## CI and releases

Every pull request and every push to `main` runs `CI`: `npm ci`, `typecheck`, the vitest suite on
Node 22 and 24, and a job that asserts what `npm publish` would ship (entry point and its imports
in, tests out). No secrets are used, so the checks run on fork PRs too.

Releases are tag-driven and need nobody's laptop: push a tag whose name matches `package.json`
(`v0.2.0`) and [`release.yml`](.github/workflows/release.yml) re-runs the gate, refuses a version
that already exists on npm, publishes with provenance, and opens the GitHub Release. Auth is npm
trusted publishing (no secret) or an `NPM_TOKEN` repository secret. Maintainer steps are in
[CONTRIBUTING.md](CONTRIBUTING.md#releasing-maintainers).

Dependabot opens grouped weekly bumps, and a dev-dependency patch or minor bump auto-merges once CI
is green; anything else is labelled `needs-review` for a human.

## Layout

```text
extensions/index.ts   # pi entry point — registers the handler, the autocomplete wrapper, the tool
                      #   and the renderer
src/types.ts          # shared vocabulary: SkillEntry, SkillToken, SkillChain
src/parser.ts         # /skill: tokenisation, positional argument binding, six-skill cap
src/expander.ts       # byte-exact <skill …> block emission
src/input-handler.ts  # the input hook: guards, clean path, rescue path
src/autocomplete.ts   # /skill: menu at every chain position (wraps the host provider)
src/chain-display.ts  # typed-form transcript: the display marker and the block → /skill: rewrite
src/registry.ts       # name → SKILL.md index built from pi.getCommands()
src/skills-tool.ts    # read-only `skills` listing tool
src/renderer.ts       # the markdown transformer that renders a chain as typed
tests/                # vitest specs: unit, plus the host provider and the host editor
docs/images/          # the diagrams above (light + dark SVG, PNG renders), the gallery cover
                      #   and the demo animation
scripts/              # diagrams.mjs and demo-video.mjs (generators), check-pack.mjs (tarball
                      #   contract), release-notes.mjs
.github/              # ci.yml, release.yml, dependabot, PR and issue templates
```

## Development

```bash
npm ci
npm run verify        # typecheck + tests + tarball check — the same gate CI runs
```

Requires Node `>=22.19.0`; the host packages (`@earendil-works/pi-coding-agent`, `typebox`) are
peer dependencies provided by pi. Contributions are welcome — read
[CONTRIBUTING.md](CONTRIBUTING.md) first, and see [AGENTS.md](AGENTS.md) if you are an agent.

## Star History

<a href="https://www.star-history.com/?repos=AleixRocal%2Fpi-multi-skills&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=AleixRocal/pi-multi-skills&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=AleixRocal/pi-multi-skills&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=AleixRocal/pi-multi-skills&type=date&legend=top-left" />
 </picture>
</a>

## Links

| Where | What |
| --- | --- |
| [npm](https://www.npmjs.com/package/@aleixrocal/pi-multi-skills) | The package `pi install npm:` resolves. |
| [pi package gallery](https://pi.dev/packages) | Discovery, via the `pi-package` keyword. |
| [GitHub Releases](https://github.com/AleixRocal/pi-multi-skills/releases) | Every version, with the changelog entry as its notes. |
| [Issues](https://github.com/AleixRocal/pi-multi-skills/issues) | Bug reports and feature requests. |

## License

MIT — see [LICENSE](LICENSE).
