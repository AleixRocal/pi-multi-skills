# pi-multi-skills

A [pi](https://github.com/earendil-works/pi) plugin that lets skills be **chained** — the way
Codex `$skill` invocation composes — instead of one-shot invocations.

Motivation: in pi, a skill can only be invoked as a single top-level unit. You cannot chain
skill → skill inside one turn, and you cannot trigger a skill mid-conversation (e.g. "now go
search") without dropping out of the current flow. This plugin closes that gap.

## Status

Pre-design. Architecture is not settled yet — this repository is a scaffold.

## Layout

```text
skills/          # plugin skills exposed to pi
extensions/      # pi extension entry points
.rpiv/           # local only, gitignored: research → design → plan artifacts
```

## Development

Not yet scaffolded. Package layout, install path, and the chaining mechanism are decided
in the design phase.
