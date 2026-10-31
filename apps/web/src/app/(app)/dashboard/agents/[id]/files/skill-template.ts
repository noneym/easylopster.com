export const SKILL_TEMPLATE = (name: string) => `---
name: ${name}
description: One line on when to use this skill.
---

# ${name}

## When to use
Describe the situation that should trigger this skill.

## Steps
1. First step, with the exact command or tool call.
2. Second step.

## Gotchas
- Things that went wrong before and how to avoid them.
`;
