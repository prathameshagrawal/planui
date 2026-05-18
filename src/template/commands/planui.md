---
description: Author a plan and render it as a scannable HTML page via PlanUI
argument-hint: <what you want to plan>
---

The user invoked `/planui` with arguments: `$ARGUMENTS`

Author a PlanUI-conformant markdown plan, then render it.

**Plan structure** — use these H2 sections, skip any that don't apply:

- `## Summary` — 1-3 sentences, lead with the goal.
- `## Open Questions` — only when you genuinely don't know. Not for performative confirmation. Mix shapes by answer type:
  - Free-text for open prompts
  - `- [ ]` checkboxes for multi-select
  - `- ( )` radios for single-select
- `## Preconditions` — what must be true before the plan can start.
- `## Steps` — numbered list, `**Title** — description` format. Annotate deps with `(depends on N)`. Reference files in backticks.
- `## Risks` — bullets; prefix `[high]` / `[med]` / `[low]` for severity badges.
- `## Files` and `## Stack Changes` — only when meaningfully different.

Better to omit a section than pad it.

**Catalog blocks** — reach for these when sub-content has visible structure:

- ` ```block:tldr ` — one-sentence key takeaway. Sparingly, near the top.
- ` ```block:layers ` — precedence stacks, fallback chains.
- ` ```block:compare ` — A vs B trade-offs. Top-level bullets = options; sub-bullets = points.
- ` ```block:sequence ` — linear flow / phases.
- ` ```block:table ` — GFM pipe table for comparisons.
- ` ```block:callout ` — `[!info|warn|danger|success]` directive + body. Reserve for genuine signals.
- ` ```block:metric ` — `- **value** — label` bullets. For scope / size / numbers.

**Inline markers** — `[mcp:server-name]` and `[tool:tool-name]` render as accent chips. Use when naming MCP servers or external tools.

**Render** — call the `render_plan` MCP tool with `{title, markdown}`. Title is a short headline under 60 chars. Markdown is the full plan body.

**Respond** — your chat reply is ONE LINE: the `file://` URL the tool returns. No markdown dump. The rendered page is the artifact.

**Follow-ups** — when the user later pastes a fenced ` ```planresponse ` block, parse the first non-empty line as the action: `approve` | `modify` | `fork` | `answers` | `prefspersist`. Then act: proceed, re-plan, fan out sub-agents, or write preferences.
