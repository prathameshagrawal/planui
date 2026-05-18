#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { renderPlan } from "./render.js";

const TOOL_DESCRIPTION = `Render a plan as a scannable, interactive HTML page the user can review in the browser.

Use this whenever you have produced a multi-step plan, a non-trivial change proposal, or any structured plan you want the user to skim, edit, and approve — instead of dumping a wall of markdown into chat.

INPUTS:
  - title: short human-readable title (one line)
  - markdown: the full plan as markdown
  - plan_id (optional): reuse an existing plan id to overwrite a previous render

RECOGNIZED H2 HEADERS (case-insensitive, all optional):
  ## Summary | ## Overview | ## TL;DR        — short prose intro
  ## Open Questions | ## Questions           — bullet list; each item becomes an inline textarea
  ## Steps | ## Plan | ## Implementation     — numbered list; each item becomes a step row
  ## Risks | ## Risk                         — bullet list of risks
  ## Preconditions | ## Requirements         — bullet list rail card
  ## Files | ## Files Touched                — bullet list, rendered as monospace chips
  ## Stack Changes | ## Dependencies | ## New Tools — bullet list rail card
  ## Status                                  — single line, sets the status badge
  Any other H2 is preserved verbatim as a "note" card.

STEP CONVENTIONS:
  - Use a numbered list (1. 2. 3.).
  - Mark dependencies inline: "1. Build server (depends on 2)" or "(depends_on: 2)".
  - Reference files with backticks: \`src/server.ts\` — these render as inline file chips.
  - Steps without dependencies show a "Fork" toggle the user can check to fan-out as a sub-agent.
  - Steps with a dep render as "⊘ blocked by step N" (muted, non-interactive).

RISK SEVERITY:
  Prefix or inline a tag: "[high] data loss if migration fails", "[med] flaky test", "[low] minor UX nit".
  Accepted: [high], [med] / [medium], [low]. No tag = no badge.

BLOCK CATALOG — typed components for structured content

Use these to elevate structured sections (precedence chains, comparisons, flows, etc.) above plain markdown. Invoke via a fenced code block with \`block:<type>\` as the language. Skip blocks for prose; only use when the structure is visually meaningful.

Available types:

  block:layers   — Precedence stack. Numbered list of "Title — Description". Renders as stacked cards with precedence numbers.
  block:compare  — A vs B options. Top-level bullets are option names; nested bullets are points. Renders as side-by-side cards.
  block:sequence — Linear flow. Numbered list of short steps. Renders as horizontal pills with arrows.
  block:table    — Data table. GFM pipe table syntax. Renders with tinted header, hover rows.
  block:callout  — Tinted alert. Optional \`[!info|warn|danger|success]\` directive on first line. Renders as a colored card with icon.
  block:metric   — Stat cards. Bullets of \`- **value** — label\`. Renders as a responsive grid of big-number cards.
  block:tldr     — Key takeaway. Free-form prose. Renders as an accent-tinted card with TL;DR label.

Unrecognized \`block:foo\` types fall through to plain code blocks — no data loss. Stay markdown-first; use blocks sparingly for high-value structure.

APPEARANCE HANDLES (user-controlled, do not author):
  Every rendered page exposes a gear-icon dropdown in the header with live controls for theme (dark / midnight / light), font (sans / serif / mono), and primary color (blue / green / purple / white). The USER picks these — do not try to set themes via markdown content or styling hints. Persisted defaults (see prefspersist below) are baked into the HTML on each render.

USER RESPONSE PROTOCOL:
  The rendered page has action buttons that each copy a fenced \`planresponse\` block to the clipboard, which the user pastes back in chat.
  On your next turn, scan the user message for a fenced block tagged \`planresponse\`. The block is a JSON-ish payload with one of these actions:
    { "plan_id": "...", "action": "approve",  "answers": { "q1": "...", ... }, "fork": [1,3] }   // "fork" is optional; only present if the user queued any steps before approving
    { "plan_id": "...", "action": "modify",   "answers": { ... }, "feedback": "..." }
    { "plan_id": "...", "action": "fork",     "answers": { ... }, "steps": [1,3] }   // standalone fork — user wants these spawned as concurrent sub-agents WITHOUT yet approving the rest

  Note: when approve carries a fork list, treat it as "approved AND fan these steps out concurrently". Spawn sub-agents for the listed step numbers; do the rest of the plan sequentially as usual.
  Treat any of these as the user's directive for the plan.

  Additionally, the gear dropdown's "Save as default" button emits a key/value form (not JSON):
    \`\`\`planresponse plan_xxx
    prefspersist
    theme: midnight
    font: serif
    color: green
    \`\`\`
  When you see a \`prefspersist\` action, YOU (the calling agent) are responsible for updating \`~/.claude-plans/preferences.json\`:
    - Schema: { theme?: "dark"|"midnight"|"light", font?: "sans"|"serif"|"mono", color?: "blue"|"green"|"purple"|"white" }
    - Only these three keys; only the enum values listed above. Drop anything else.
    - Create the file if missing; otherwise MERGE with existing contents (don't drop unrelated keys the user may have set previously).
    - Not every key needs to be present in the block — only persist what was sent.
    - After writing, briefly confirm to the user. The next \`render_plan\` call will bake the new defaults into the HTML automatically (this server reads the file on every render; it does NOT write it).`;

const server = new Server(
  { name: "planui", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "render_plan",
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short human-readable title for the plan." },
          markdown: { type: "string", description: "The full plan in markdown. See tool description for recognized H2 headers." },
          plan_id: { type: "string", description: "Optional. Reuse an existing plan id to overwrite a previous render." },
        },
        required: ["title", "markdown"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "render_plan") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  const title = typeof args.title === "string" ? args.title : "";
  const markdown = typeof args.markdown === "string" ? args.markdown : "";
  const plan_id = typeof args.plan_id === "string" ? args.plan_id : undefined;

  if (!title || !markdown) {
    throw new Error("render_plan requires both 'title' and 'markdown'.");
  }

  const result = await renderPlan({ title, markdown, plan_id });

  const text =
    `Plan rendered: ${result.url}\n` +
    `plan_id: ${result.plan_id}\n\n` +
    `Ask the user to open the page, fill in any open questions, and click Approve / Modify / Fork. ` +
    `Each button copies a fenced \`planresponse\` block to the clipboard. On the user's next message, look for that fenced block — it carries one of the actions "approve" | "modify" | "fork" along with answers to the questions, and (for fork) which step numbers to spawn as concurrent sub-agents.`;

  return {
    content: [{ type: "text", text }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
