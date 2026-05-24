---
description: Author a plan and render it as a scannable HTML page via PlanUI
argument-hint: <what you want to plan>
---

The user invoked `/planui` with arguments: `$ARGUMENTS`

Author a PlanUI-conformant markdown plan, then render it.

**Title** — short noun phrase or imperative, under 60 chars. Not a question.

**Plan structure** — use these H2 sections, skip any that don't apply. Better to omit than pad:

- `## Summary` — 1-3 sentences, lead with the goal.
- `## Open Questions` — only when you genuinely don't know. Not for performative confirmation. Each question is a top-level bullet. For multiple-choice questions, follow the question bullet with **sibling** bullets carrying `( )` (radio) or `[ ]` (checkbox) markers — do not indent them as sub-bullets. Free-text answers are just a question bullet with no marker siblings after it.

  Example:

  ```
  - Which storage backend should we use?
  - ( ) Redis
  - ( ) Postgres
  - ( ) In-memory

  - Which themes ship in v1?
  - [ ] dark
  - [ ] midnight
  - [ ] light

  - What's the rollout window?
  ```
- `## Preconditions` — what must be true before the plan can start. Skip if there are none.
- `## Steps` — numbered list, `**Title** — description` format. Annotate deps with `(depends on N)`. Reference files in backticks.
- `## Risks` — only if a real failure mode exists. Prefix `[high]` / `[med]` / `[low]` for severity badges. Skip the section if every item would be a stretch.
- `## Files` and `## Stack Changes` — only when they add information beyond what Steps already names.

**Catalog blocks** — reach for these when sub-content has visible structure:

- ` ```block:tldr ` — one-sentence key takeaway. Sparingly, near the top.
- ` ```block:layers ` — precedence stacks, fallback chains. Numbered list inside.
- ` ```block:compare ` — A vs B trade-offs. Top-level bullets = options; sub-bullets = points.
- ` ```block:sequence ` — linear flow / phases. Numbered list inside.
- ` ```block:table ` — GFM pipe table for comparisons.
- ` ```block:callout ` — `[!info|warn|danger|success]` directive + body. Reserve for genuine signals.
- ` ```block:metric ` — `- **value** — label` bullets. For scope / size / numbers.

Example — compare:

````
```block:compare
- Synchronous handler
  - Simpler control flow
  - p99 stays high
- Event-driven pipeline
  - Decouples critical path
  - At-least-once delivery to handle
```
````

**Mermaid diagrams** — for architecture, flows, and data shapes, prefer a ` ```mermaid ` fence over prose. Pick the right diagram type:

- `flowchart LR` — system architecture, component layout, dependency graphs
- `sequenceDiagram` — request flows, async coordination, multi-party handshakes
- `erDiagram` — data models, table relationships
- `stateDiagram-v2` — lifecycle / state machines

One diagram beats a paragraph of "the X talks to the Y which then…". Mermaid auto-themes to the user's selected planui theme.

**Inline markers** — `[mcp:server-name]` and `[tool:tool-name]` render as accent chips. Use when naming MCP servers or external tools.

**Avoid**:

- Padding empty sections — omit Risks/Preconditions if you have nothing real to say.
- Callouts on every paragraph; the tinted card is a signal, not a default.
- Walls of prose where a `block:compare`, `block:table`, or `mermaid` would carry the structure.
- Numbering steps when the order doesn't matter — use a regular bullet list under a note heading instead.
- Restating in `## Files` what `## Steps` already chips.

**Render** — call the `render_plan` MCP tool with `{title, markdown}`. Title is a short headline under 60 chars. Markdown is the full plan body.

**Respond** — your chat reply is ONE LINE: the `file://` URL the tool returns. No markdown dump. The rendered page is the artifact.

**Follow-ups** — when the user later pastes a fenced ` ```planresponse ` block, parse the first non-empty line as the action:

- `approve` — proceed with implementation. Body lines `qN: <answer>` carry question answers; a `fork: 2, 5` line means also fan out those steps.
- `modify` — re-render the plan applying the body as revision feedback.
- `answers` — same body shape as approve, but re-render before executing.
- `fork` — body is `steps: N, M, …`. Spawn one Agent sub-agent per listed step number, in parallel, each scoped to the corresponding step's title + description.
- `prefspersist` — body is `theme: …` / `font: …` / `color: …` lines. Write them to `~/.claude-plans/preferences.json` as the new global default.
