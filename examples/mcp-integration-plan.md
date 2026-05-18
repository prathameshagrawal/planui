## Summary

PlanUI ships as an MCP stdio server (`dist/server.js`). Adding one entry to `~/.claude/settings.json` registers it with Claude Code. The agent then sees a single tool — `render_plan` — and learns from its description to call it instead of dumping markdown plans in chat. The agent's chat response shrinks to a single line (the `file://` URL). The user reviews in the browser, fills questions, clicks an action, copies, pastes; the agent recognizes the `planresponse` block in the next user turn and acts on it.

## Open Questions

1. Should `render_plan` accept a `mode` field for in-progress vs approval-ready plans?
   - ( ) Yes, add `mode: "draft" | "final"` and style differently
   - ( ) No, keep schema minimal — one render style for v1
   - ( ) Defer until we see real demand
2. Which MCP hosts should we test against first?
   - [ ] [mcp:claude-code]
   - [ ] [mcp:cursor]
   - [ ] [mcp:zed]
   - [ ] [mcp:vscode-cline]
3. When the user pastes a `modify` token, should the agent re-render with the same `plan_id` (stable URL) or generate a fresh ID per version (audit trail)?

## Preconditions

- Repo built: `npm install && npm run build` produces `dist/server.js`
- Node 20.11+ on PATH
- Claude Code (or another MCP host) installed

## Steps

1. **Register the MCP server** — add a `planui` entry under `mcpServers` in `~/.claude/settings.json`, pointing `command: "node"` and `args` to `/Users/pratham/planui/dist/server.js`. Restart Claude Code.
2. **Verify discovery** — open a new Claude Code session and ask what tools are available. The agent should mention `render_plan` from server `planui`.
3. **First end-to-end test** — give the agent a real task (e.g. "refactor the auth middleware"). Watch that it calls `render_plan` with a markdown body, then posts only the `file://` URL in chat — not a duplicate markdown dump.
4. **Validate the response loop** — open the URL, answer any open questions, click Approve. Paste the copied `planresponse` block. The agent should parse the action and proceed.
5. **Test modify + parallel paths** — type modification feedback, paste; queue a couple of independent steps, paste. Verify the agent revises the plan or spawns sub-agents accordingly.
6. **Tune the tool description** (depends on 5) — if the agent ignores the convention (still dumps markdown alongside the URL) or mishandles the response block, refine the `description` in `src/server.ts`. That description is the agent's only training signal for this workflow.

## Files

- `~/.claude/settings.json` — MCP server registration
- `~/planui/src/server.ts` — tool description (the agent's instructions)
- `~/.claude-plans/` — runtime output directory (auto-created)

## Risks

- Agent ignores the convention and dumps markdown anyway [med] — mitigated by a sharper tool description; ultimately depends on agent adherence to tool guidance.
- User has multiple open plans in one session and pastes the wrong `planresponse` block [low] — mitigated by the `plan_id` in the fence header; the agent should validate it before acting.
- Stale plans accumulate under `~/.claude-plans/` [low] — already mitigated by the 50-newest auto-prune in `render.ts`.

## Stack Changes

- + One entry in `~/.claude/settings.json` (the MCP registration; no new processes, no new ports)

## Dogfood without MCP

For testing template changes without restarting Claude Code, the CLI is a fast loop:

```
node /Users/pratham/planui/dist/cli.js path/to/plan.md "Plan title"
```

This bypasses the MCP server entirely and prints a `file://` URL.
