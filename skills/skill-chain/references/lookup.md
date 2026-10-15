# Where skills live

Resolve a name by finding the `SKILL.md` that declares it. Take the sources in this order and stop
at the first hit.

| Source | Why it is authoritative |
| --- | --- |
| The agent's own announcement | Most agents list every available skill — name, description, path — in the system prompt. That list is the session's truth. |
| A `skills` tool | Some agents expose the same list as a callable tool; in pi it is `skills` (`query` filters by name and description, `limit` pages). |
| `~/.agents/skills/` and `.agents/skills/` | The portable Agent Skills locations, read by several agents. Any directory containing a `SKILL.md` is a skill, discovered recursively. |
| The agent's own skills directory | Claude Code reads `~/.claude/skills/` and `.claude/skills/`; other agents use the same shape under their own config directory. If you cannot find one, go back to the agent's own list rather than guessing paths. |

A skill is a directory holding a `SKILL.md`. Its frontmatter `name` is what the chain refers to.
When two skills declare the same name, prefer the one the agent announced.

## Edge cases

| Situation | What to do |
| --- | --- |
| The name resolves to nothing | Leave `/skill:<name>` and the text it owns exactly as typed, keep going, report it as skipped. |
| The `SKILL.md` cannot be read | Same: the token stays verbatim and the rest of the chain still runs. |
| Seven or more markers | Expand the first six. The seventh marker and everything after it belong to the sixth skill's argument text. |
| One skill, no chain | Not a chain: invoke it normally, with the whole trailing text as its argument. |
| The same skill named twice | Apply it twice, in place. The second pass may deliberately build on the first. |
| No argument text at all | Run the skill with an empty argument. Never invent one. |

## Reporting lines

One line per skill, in the order they ran:

```text
applied  <name> ← "<argument text>"
skipped  <name> (no such skill, unreadable SKILL.md, or past the six-skill cap)
```

Quote the argument text as the user wrote it: that line is the only visible evidence of the
binding, and it is what makes a wrong split catchable.
