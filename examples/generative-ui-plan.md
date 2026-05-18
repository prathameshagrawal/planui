## Summary

PlanUI currently handles schema-level structure (Summary, Open Questions, Steps, Risks, etc.) with markdown content inside each slot. As agents generate more varied plans — questions with multi-choice answers, MCP/tool references, code diffs, embedded tables — we need a clear policy for what content types get bespoke UI affordances vs. what falls through to plain markdown rendering. **Recommendation: stay markdown-first, add interactive overlays for two high-value patterns (task-list answers in questions, MCP/tool chips), keep everything else as markdown.**

## Open Questions

1. **Multi-choice question answers** — should `- [ ]` items under a question render as **checkboxes** (multi-select) or **radio buttons** (single-select)? Mixed support is possible via different markers (`- [ ]` vs `- ( )`), but doubles the surface area.
2. **Tool / MCP reference convention** — auto-detect bare patterns like `mcp:linear` and `[tool:foo]`, or require agents to use an explicit marker like `[mcp:linear]`? Explicit is safer; auto-detection is friendlier but produces awkward false positives.

## Preconditions

- The current schema (Sections, Steps, Questions, Risks, Notes) is stable and tested.
- `marked` already handles GFM: task lists, tables, fenced code, blockquotes, strikethrough.
- Note cards already act as the fallback for unrecognized H2 sections — no content is ever lost.

## Steps

1. **Stay markdown-first** — all content within sections is rendered via `marked` (already true). No new components per section type unless they add real interactive value over plain text.
2. **Task lists in Open Questions** — if a question has `- [ ]` items under it, parse them as choices and render as native checkboxes (matching the per-step Parallel checkbox style). Selected choices get bundled into the `approve` token as `q1: choice-a, choice-c`. Touches `src/extract.ts` (parseQuestions) and `src/render.ts` (renderQuestions).
3. **MCP / tool chips** — detect explicit markers like `[mcp:linear-mcp]` or `[tool:foo]` in any prose; render as a small chip with a leading icon. Don't auto-detect every bare word — require a convention so agents can opt in. Touches `src/render.ts` (mdInline post-processor).
4. **File path linking** — already render file paths as inline `code`. Make them clickable if they look like a path (open via `file://` or editor protocol). Touches `src/render.ts` only.
5. **Diff blocks** — fenced code blocks with `diff` language get +/- line coloring via CSS-only tokenizer (no JS highlighter dependency). Touches `src/template/styles.css`.
6. **Everything else** — falls through to markdown via marked. Tables, nested lists, blockquotes already work.

## Risks

- Over-specifying patterns (e.g. auto-detecting MCP references) makes agents anxious about format and produces awkward output [med] — mitigated by requiring explicit markers (`[mcp:...]`) instead of heuristics.
- Multi-choice question UX might conflict with free-text answer expectations when the agent wanted a typed response, not a choice [low] — mitigated by always rendering a free-text textarea below the choice list so the user can override.
- Variability in step `description` content (diffs, tables, sub-tasks) can balloon vertical space when expanded [low] — mitigated by the existing "View details" collapse.

## Stack Changes

- + One new branch in `parseQuestions` to detect task-list options (~30 lines).
- + Tool-chip detector and renderer (~20 lines).
- + Diff fence renderer (~40 lines CSS + small JS for line coloring).
- No new npm dependencies; all on top of existing `marked`.

## What we deliberately do NOT handle

These either stay as plain markdown or are out of scope for v1:

- **Charts / graphs** — agents can embed a Mermaid fenced block; we render it as a code block. Optional Mermaid support is a future add.
- **Image embeds** — out of scope for v1. Could add `<img>` rendering for `![alt](path)` later.
- **Custom decision matrices** — use a markdown table.
- **Inline React / Vue components** — no client-side framework. The output stays a single self-contained HTML file.

The escape hatch for genuinely novel content: agent writes it under a new H2 section. It renders as a "note" card with full markdown — never lost, just not specialized.

## Why this works for generative variability

The schema (Summary / Questions / Steps / Risks / Preconditions / Notes / Files / Stack) covers the *shape* of plans. The shape is stable across plan types — every plan has goals, decisions to make, work to do, things that could go wrong. Generative variability lives in the *content* of each slot, not the *count or kind* of slots. Markdown handles content; the schema handles shape. Note cards are the safety valve for shape-breaking cases.
