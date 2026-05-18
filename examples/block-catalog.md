## Summary

A small catalog of typed blocks that turn structured sections into scannable components, while keeping markdown as the authoring substrate. Invoke via fenced code blocks with `block:<type>` as the language. Seven types ship in v1.

```block:tldr
Stay markdown-first. The block catalog adds typed components for structured content (layers, comparisons, flows, tables, callouts, metrics, key takeaways) while leaving everything else as raw markdown. Agents pick when to elevate; the renderer dispatches.
```

## Layers — precedence stack

Use for fallback chains, override sequences, persistence models.

```block:layers
1. Hard-coded CSS defaults — what ships in the template
2. MCP-saved preferences — global user default across plans
3. Browser localStorage — per-plan override
```

## Compare — A vs B side-by-side

Use for trade-off decisions with multiple criteria.

```block:compare
- Auth0
  - Lower per-MAU cost above 10k users
  - Enterprise SSO out of the box
  - 14 routes affected to migrate
- Clerk
  - Better DX, less config
  - Built-in user management UI
  - 3 routes affected to migrate
```

## Sequence — linear flow

Use for pipelines, request flows, ordered processes.

```block:sequence
1. Agent calls render_plan
2. Server writes .md + .html
3. User opens file:// URL
4. User pastes planresponse
5. Agent acts on the action
```

## Table — styled data

Use for any tabular comparison or reference table.

```block:table
| Method | Latency | Offline | Cost |
| Clipboard | 0ms | yes | $0 |
| Local HTTP listener | 50ms | yes | daemon |
| Vercel RSC streaming | 200ms+ | no | infra |
```

## Callout — tinted insight

Four types: info, warn, danger, success.

```block:callout
[!info] Block invocation is opt-in. Plain markdown renders exactly as before when no block fences are present.
```

```block:callout
[!warn] Callouts are for genuine signals — not every paragraph deserves one. Overuse drowns the visual hierarchy.
```

```block:callout
[!danger] Don't put interactive elements inside a callout. Buttons and inputs belong in their own typed blocks.
```

```block:callout
[!success] All seven blocks ship in v1, ready for agents to use today.
```

## Metric — values with labels

Use for hero stats, before/after, scope numbers.

```block:metric
- **7** — block types in the catalog
- **0ms** — added latency vs plain markdown
- **~50** — lines of code per block
- **80%** — coverage of plan visualization needs (estimated)
```

## Preconditions

- `marked` already parses GFM
- Existing CSS variables cover all surfaces/text/borders/accents
- The H2 section parser is stable

## Steps

1. **Design the block schema** — define markdown shape, HTML output, parser rule for each of the 7 catalog types.
2. **Register a marked extension** — tokenize `block:type` fenced blocks at the block level so they don't conflict with regular code blocks.
3. **Implement per-block renderers** (depends on 2) — one TypeScript function per type, all dispatched from `renderPlanBlock`.
4. **Style each block in CSS** — reuse existing tokens (`--surface`, `--accent`, etc.); match the polish of the Steps section.
5. **Update the tool description** — agents need a one-line summary per block plus the invocation grammar.

## How agents invoke blocks

Each block is a fenced code block. The language tag is `block:<type>`. The body is parsed per the type's schema. Inline markdown (code spans, bold, links, `[mcp:foo]` chips) works inside block content where appropriate.

```block:callout
[!info] Unknown block types (e.g. `block:foo`) fall through to a plain code block — never lost, just not specialized. Same escape hatch as unrecognized H2 sections.
```
