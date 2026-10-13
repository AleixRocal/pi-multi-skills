# pi-multi-skills

Chain several `/skill:` invocations in a single pi message.

pi expands exactly one skill per message. Given `/skill:a /skill:b args` it resolves `a` and
silently swallows `/skill:b args` as that skill's argument text — no error, no signal
(`dist/core/agent-session.js:1697-1721`). This extension registers an `input` handler that runs
*before* pi's own expansion and rewrites the message into N sibling `<skill …>` blocks: one per
named skill, each followed by the argument text that skill owns.

```text
/skill:research refactor auth /skill:design write tests
```

The model receives (skill bodies abbreviated):

```text
<skill name="research" location="/home/user/.pi/agent/skills/research/SKILL.md">
References are relative to /home/user/.pi/agent/skills/research.

<body of the research skill>
</skill>

refactor auth

<skill name="design" location="/home/user/.pi/agent/skills/design/SKILL.md">
References are relative to /home/user/.pi/agent/skills/design.

<body of the design skill>
</skill>

write tests
```

## Install

```bash
pi install git:github.com/AleixRocal/pi-multi-skills
```

Or, from a local checkout:

```bash
pi install ./pi-multi-skills
```

The scoped npm name `@aleixrocal/pi-multi-skills` is the intended package name, but it is not
published yet — `pi install npm:@aleixrocal/pi-multi-skills` does not resolve today.

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

The first block renders as pi's normal collapsible skill card. Blocks 2..N are collapsed into
one-line references in the interactive transcript:

```text
> **[skill] design** — `/home/user/.pi/agent/skills/design/SKILL.md`
```

The transformer is display-only: the session message the model sees still carries the full blocks.

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

## Layout

```text
extensions/index.ts   # pi entry point — registers the handler, the tool and the renderer
src/types.ts          # shared vocabulary: SkillEntry, SkillToken, SkillChain
src/parser.ts         # /skill: tokenisation, positional argument binding, six-skill cap
src/expander.ts       # byte-exact <skill …> block emission
src/input-handler.ts  # the input hook: guards, clean path, rescue path
src/registry.ts       # name → SKILL.md index built from pi.getCommands()
src/skills-tool.ts    # read-only `skills` listing tool
src/renderer.ts       # collapses blocks 2..N in the transcript
tests/                # vitest specs, including cross-order emission parity
```

## Development

```bash
npm install
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

Requires Node `>=22.19.0`; the host packages (`@earendil-works/pi-coding-agent`, `typebox`) are
peer dependencies provided by pi.

## License

MIT
