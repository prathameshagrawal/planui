## Summary

PlanUI turns AI-generated plans from wall-of-markdown into interactive HTML pages with answer fields, fork toggles, and a copyable action bar. This page is itself a PlanUI render — try toggling the gear in the top-right.

```block:tldr
Type `/planui <task>` in Claude Code to author and render a plan. The agent picks the structure; PlanUI gives it visual hierarchy.
```

## Open Questions

1. What kind of plan do you want to render first? (you can also just close this page and run `/planui` to start)

2. How will you primarily use PlanUI?
   - ( ) Personal — quick plans for my own work
   - ( ) With my team — shared decision docs
   - ( ) Just exploring for now

## How it works

When you call `/planui <description>`, your Claude agent writes a structured markdown plan. PlanUI parses recognized sections (Summary, Steps, Risks, Open Questions, etc.) into specialized UI components, and any structured sub-content can be elevated via "blocks" (you're looking at one right now).

```block:layers
1. You type `/planui` — slash command captures your task
2. The agent authors a markdown plan with PlanUI conventions
3. The MCP server parses + renders → self-contained HTML in `~/.claude-plans/`
4. You open the URL, interact, copy an action, paste back
```

## The action bar

At the bottom of every plan:

- **Approve** — sends back your question answers and tells the agent to proceed
- **Modify** — write feedback; the agent revises and re-renders
- **Fork** — pick which steps run as concurrent sub-agents (toggle them in the Steps section, then click Fork N)
- The gear icon top-right — live theme/font/color toggles, persist via "Save as default"

## Catalog

There's a catalog of 7 typed blocks the agent can reach for when content has visible structure: layers, compare, sequence, table, callout, metric, tldr. You've already seen tldr and layers above. Here's the rest.

```block:callout
[!info]
Block invocation is opt-in. Most plan content stays as natural markdown — blocks are for sub-sections with obvious visual structure.
```

```block:metric
- **7** — block types
- **0ms** — added latency vs plain markdown
- **3** — themes (dark / midnight / light)
- **4** — primary colors
```

## Try it

Close this page. In Claude Code chat, type:

```
/planui add idempotency to /v2/refresh
```

You'll get a fresh plan rendered just like this one. Approve, Modify, or Fork it the same way.
