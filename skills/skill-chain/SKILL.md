---
name: skill-chain
description: Run several agent skills in one request, in the order they were named, each with the argument text that belongs to it. Use when the user asks to chain, stack, or combine skills ("run X then Y", "/skill:a x /skill:b y"), or when a request reaches you already carrying more than one skill block.
---

# Chaining skills

A chain is one request that names several skills. Each skill runs in the order it was named, with
the text that belongs to it and nothing else:

```text
/skill:research auth /skill:design tests
        │                        │
        └─ research ← "auth"     └─ design ← "tests"
```

## Run it

1. **Get the skills.** If the request already carries `<skill …>` blocks, they are resolved — take
   them in order and do not re-resolve the names. Otherwise resolve each name yourself; see
   [references/lookup.md](references/lookup.md) for where skills live and what to do when one will
   not resolve.
2. **Read each `SKILL.md`** and follow it as if it had been the only skill invoked.
3. **Give each skill its own argument text** — the binding below, not the whole message.
4. **Report the chain** when you finish, one line per skill.

## Binding

- **Each token owns what follows it.** A `/skill:<name>` token owns the text from the end of its
  name up to the next token; the last token owns the rest of the request.
- **A run of tokens broadcasts once.** With no text between them — `/skill:a /skill:b shared` —
  `a` receives nothing and `shared` lands once, after the last skill.
- **Text before the first token is context**, not an argument to any skill.
- **Six skills, maximum.** A seventh marker is not a skill: it stays literal text inside the sixth
  skill's argument text, so nothing the user typed disappears.
- **An unresolvable name stays verbatim.** Leave the token exactly as written, keep the rest of the
  chain running, and report which one you could not resolve.

## Keep the steps apart

- Run the skills as steps, in order. Never blend them into one answer.
- Apply each named skill once; do not re-read one that already ran.
- A skill whose own text names another skill is prose, not a chain: do not follow it.

## Report

Close with what actually ran, so the binding is visible and a wrong split can be corrected:

```text
applied  research ← "auth"
applied  design   ← "tests"
skipped  typo     (no such skill; left verbatim)
```

When two skills in the chain conflict, say so instead of choosing silently — the order is the
user's, so the resolution is theirs too.
