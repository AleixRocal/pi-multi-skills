# pi-multi-skills

Chain several `/skill:` invocations in a single pi message: `/skill:a x /skill:b y`.

[![CI](https://github.com/AleixRocal/pi-multi-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/AleixRocal/pi-multi-skills/actions/workflows/ci.yml)
[![Release](https://github.com/AleixRocal/pi-multi-skills/actions/workflows/release.yml/badge.svg)](https://github.com/AleixRocal/pi-multi-skills/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@aleixrocal/pi-multi-skills?label=npm)](https://www.npmjs.com/package/@aleixrocal/pi-multi-skills)
[![GitHub stars](https://img.shields.io/github/stars/AleixRocal/pi-multi-skills?label=stars&color=blue)](https://www.star-history.com/#AleixRocal/pi-multi-skills&Date)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

pi expands exactly one skill per message. Given `/skill:a x /skill:b y` it invokes `a` with
`x /skill:b y` as its argument text — the second marker is swallowed, with no error and no signal.
This extension runs an `input` handler before pi's own expansion and rewrites the message into one
`<skill …>` block per named skill, each followed by the argument text that skill owns:

| You type | pi alone | With this extension |
| --- | --- | --- |
| `/skill:research auth /skill:design write tests` | `research`, invoked with `auth /skill:design write tests` | `research` with `auth`, `design` with `write tests` |
| `/skill:research /skill:design shared` | `research`, invoked with `/skill:design shared` | both, with `shared` after the last block |

A single `/skill:<name>` message is passed through untouched, byte-identical to what pi produces on
its own.

![One typed message: native pi resolves one skill and swallows the rest; with the extension both skills resolve](https://aleixrocal.github.io/pi-multi-skills/images/message-flow.light.svg)

![The autocomplete menu opening at the second /skill: token, then the two skill blocks the model receives](https://aleixrocal.github.io/pi-multi-skills/images/demo.gif)

Twelve seconds of the flow, from the menu opening at the second `/skill:` token to the blocks the
model receives. The animation is rendered frame by frame from the behaviour the test suite asserts
rather than screen-recorded, so it cannot drift from the code; the full-quality
[demo.mp4](https://aleixrocal.github.io/pi-multi-skills/images/demo.mp4) (1280×720) is one click
away.

## Install

```bash
pi install npm:@aleixrocal/pi-multi-skills
pi install git:github.com/AleixRocal/pi-multi-skills
pi install ./pi-multi-skills                 # from a local checkout
```

Requires Node `>=22.19.0`; the host packages are provided by pi. The package carries the
`pi-package` keyword, which is what lists it in the [pi package gallery](https://pi.dev/packages).

## Usage

- **`/skill:<name>` is a token wherever it appears** in the message, not only at the first
  character. Only that literal marker counts, so absolute paths (`/etc/hosts`), relative paths
  (`src/app.ts`), URLs (`https://example.com/x`) and a lone slash in prose pass through untouched.
- **Each token owns the text that follows it**, up to the next token — or to the end of the
  message, for the last one. That is *positional binding*.
- **Text before the first marker is kept** in front of the blocks, as written.
- **Six skills maximum.** A seventh marker is not expanded; it is bound as the sixth skill's
  argument text instead, so text that overruns the cap degrades into text the model still reads
  and nothing typed is ever deleted.

| You type | What happens |
| --- | --- |
| `/skill:research auth /skill:design tests` | `research` runs with `auth`; `design` runs with `tests`. |
| `/skill:research /skill:design refactor auth` | Both markers are contiguous, so the run after them lands once, after the last block — the shape Claude Code's stacked skills use. |
| `/skill:nonexistent /skill:real x` | `real` still runs with `x`; the unknown token stays in the message exactly as typed. |
| `/skill:research auth` | Identical to native pi, byte for byte — the collapsible skill card and `@juicesharp/rpiv-args` interop are unchanged. |
| `/skill:a /skill:b /skill:c /skill:d /skill:e /skill:f /skill:g x` | `a`–`f` run; `/skill:g x` becomes `f`'s argument text. |

## Behaviour

### A skill that cannot be resolved never costs you the chain

A token that names no skill in the session, or whose `SKILL.md` cannot be read, stays in the
message exactly as typed — the rest of the chain still expands.

### Order independence with `@juicesharp/rpiv-args`

[`@juicesharp/rpiv-args`](https://www.npmjs.com/package/@juicesharp/rpiv-args) expands the same
syntax, and extension load order is not controllable. When it runs first it consumes the leading
`/skill:a` and leaves `/skill:b args` as plain text; this extension detects the residual token
after the last emitted block and expands it, so both load orders produce the same chain. An
already-emitted `<skill …>` block is never reprocessed, and a skill body that happens to mention
`/skill:` is never re-expanded.

### Autocomplete at every chain position

Pi's own menu is line-start only, so it closes after the first skill: the second `/skill:` falls
through to argument completions and shows nothing. This extension wraps pi's provider and supplies
the missing case. Entries are named `/skill:<name>` — the exact text the choice writes — and the
menu takes two shapes:

- **Marker typed or half-typed** — `/skill:pl`, `/skill:`, `/skill`, `/sk`, … — listed on the
  partial name, or on every skill while only the marker is partial.
- **Bare name fragment** — `/pl` — listed on the name. This is the shape you reach for after
  picking the first skill from pi's own menu, which inserts the whole marker.

Both are accepted only **past the first token**, and only while the fragment stays name-shaped, so
`check /srv` and `/skill:implement /plans/x.md` keep pi's path completion instead of offering
skills. Everything else is delegated unchanged — the first token (pi's menu there lists every
command, not only skills), `@` attachments, file paths, argument completions and non-chain
commands all come from pi's own provider. Inside a chain token, <kbd>Tab</kbd> completes the skill
rather than searching for a file path, and the six-skill cap applies to the menu too: once six
markers are on the line, a seventh offers no names, because it would not expand.

![The wrapper answers at a chain position and delegates every other completion request to pi](https://aleixrocal.github.io/pi-multi-skills/images/autocomplete.light.svg)

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

No XML block, no injected body. This is display only: the session message the model sees still
carries the full blocks. A chain's message therefore carries one leading zero-width space, which
is invisible and changes nothing the model reads.

- **A single `/skill:name` message is untouched** — it keeps pi's normal collapsible skill card,
  byte for byte as native pi and `@juicesharp/rpiv-args` produce it.
- **The HTML export is not transformed** (`pi --export`), so an exported chain shows its blocks as
  plain text.

### The chain, executed: the `skill-chain` skill

The extension *delivers* a chain; the model still has to run it. This package ships a skill that
says how, declared in the manifest so pi loads it beside the extension:

- read each named `SKILL.md` **in order** and follow it as if it were the only skill invoked,
- hand each skill its own argument text — the same positional binding the extension implements,
- report what ran, so a wrong split is visible instead of silent.

The same `SKILL.md` is portable: it installs into any agent with a skills directory (Claude Code,
Cursor, Copilot), where it does the chaining by hand. It says which of the two splits it is looking
at, because the host decides: pi binds **positionally** — each `/skill:<name>` token owns the text
up to the next one — while Claude Code **stacks** user-invocable skills at the start of a message
(`/write-tests /fix-issue 123`), expands the first plus up to five more, and hands the same trailing
text to every skill in the run. The stack must be contiguous: the first token that is not a skill
ends it, and that token with everything after it becomes the argument text for the rest.

Drop the skill in and it works:

```bash
cp -r skills/skill-chain ~/.claude/skills/     # personal; /skill-chain, or Claude invokes it
```

`npm run skill:zip` builds the archive for a marketplace upload; the skill is
`skills/skill-chain/` in this repository.

## Out of scope

- No system prompt is mutated — the extension contributes no `before_agent_start` handler.
- A tool call cannot invoke a skill. pi expands `/skill:` on user input only, so `skills` lists and
  never triggers.
- Only pi's `/skill:<name>` syntax is recognised. The `$name`-style invocation used by other tools
  is not supported.

## Cost

A chained message carries the full body of every named skill: six large skills means six bodies in
context. Nothing is truncated or cached — a skill edited mid-session is picked up on the next
message.

## Docs

| Document | For |
| --- | --- |
| [AGENTS.md](AGENTS.md) | AI agents: module map, the invariants that fail quietly, recipes for the usual changes. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Building, the PR flow, releasing. |
| [CHANGELOG.md](CHANGELOG.md) | What changed, per version. |

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=AleixRocal/pi-multi-skills&type=date&legend=top-left)](https://www.star-history.com/?repos=AleixRocal%2Fpi-multi-skills&type=date&legend=top-left)

## License

MIT — see [LICENSE](LICENSE).
