---
description: How to write and format rules in this directory.
alwaysApply: true
---

# How to write rules

Each rule file covers one topic (Expo, commits, TypeScript). Rules are the
_enforceable_ half of the agent context: short, scoped, actionable. Anything
that explains architecture belongs in `AGENTS.md`, not here.

## Frontmatter

```
---
description: One sentence summary of what the rule enforces.
globs: '*.ts, *.mts'    # omit if the rule applies to all file types
alwaysApply: false      # true only for rules that must always be in context
---
```

## Body

- Write rules as a flat bullet list. No headings, no nested sections.
- Each bullet is one actionable rule: what to do, what not to do, and why (briefly).
- Start with the most important rule first.
- Prefer "do X" / "never do Y" phrasing over "you should" or "it is recommended".
- Keep bullets short, one idea per bullet, and the whole file under ~15 bullets.
- Use inline code for identifiers, type names, and file paths.
- After adding a rule, list it in `AGENTS.md` with its scope.
