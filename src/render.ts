import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { marked } from "marked";
import {
  extractSections,
  parseFiles,
  parseListItems,
  parseQuestions,
  parseRisks,
  parseSteps,
} from "./extract.js";
import type {
  BlockCalloutNode,
  BlockCompareNode,
  BlockLayersNode,
  BlockMetricNode,
  BlockNode,
  BlockSequenceNode,
  BlockTableNode,
  BlockTldrNode,
  CalloutTone,
  NoteSection,
  PlanNode,
  PlanRoot,
  QuestionsSection,
  RailListSection,
  RenderPlacements,
  RisksSection,
  StepsSection,
  SummarySection,
} from "./ir.js";

// ---------- Block catalog: typed components invoked via ```block:<type> fences ----------
// The marked extension remains the safety net for block fences buried inside prose
// (e.g. a callout inside a Note's deep body). The primary IR walker handles top-level
// fences directly via parseSectionToIR — see buildPlanIR below.

interface PlanBlockToken {
  type: "planBlock";
  raw: string;
  blockType: string;
  body: string;
  tokens: [];
}

marked.use({
  extensions: [
    {
      name: "planBlock",
      level: "block",
      start(src: string) {
        const m = src.match(/^```block:[a-z]+/m);
        return m ? m.index : undefined;
      },
      tokenizer(src: string) {
        const m = src.match(/^```block:([a-z]+)\s*\n([\s\S]*?)```\s*(?:\n|$)/);
        if (m) {
          return {
            type: "planBlock",
            raw: m[0],
            blockType: m[1],
            body: m[2],
            tokens: [],
          };
        }
        return undefined;
      },
      renderer(token) {
        const t = token as PlanBlockToken;
        const node = buildBlockNode(t.blockType, t.body);
        return node ? renderBlock(node) : `<pre class="block-fallback"><code>${escapeHtml(t.body)}</code></pre>`;
      },
    },
  ],
});

export interface RenderResult {
  plan_id: string;
  url: string;
  md_path: string;
  html_path: string;
}

export interface RenderOptions {
  title: string;
  markdown: string;
  plan_id?: string;
}

const PLANS_DIR = path.join(os.homedir(), ".claude-plans");
const TEMPLATE_DIR = path.join(import.meta.dirname, "template");
const PREFS_FILE = path.join(PLANS_DIR, "preferences.json");

interface Prefs {
  theme?: "dark" | "midnight" | "light";
  font?: "sans" | "serif" | "mono";
  color?: "blue" | "green" | "purple" | "white";
}

const VALID_PREFS = {
  theme: new Set(["dark", "midnight", "light"]),
  font: new Set(["sans", "serif", "mono"]),
  color: new Set(["blue", "green", "purple", "white"]),
} as const;

async function readPrefs(): Promise<Prefs> {
  try {
    const raw = await fs.readFile(PREFS_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const src = parsed as Record<string, unknown>;
    const out: Prefs = {};
    for (const key of Object.keys(VALID_PREFS) as Array<keyof Prefs>) {
      const v = src[key];
      if (typeof v === "string" && (VALID_PREFS[key] as Set<string>).has(v)) {
        (out as Record<string, string>)[key] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function prefsScript(prefs: Prefs): string {
  const keys = Object.keys(prefs);
  if (keys.length === 0) return "";
  return `<script>window.__PLANUI_DEFAULTS = ${JSON.stringify(prefs)};</script>`;
}

function genPlanId(): string {
  let id = "plan_";
  for (let i = 0; i < 6; i++) {
    id += Math.floor(Math.random() * 36).toString(36);
  }
  return id;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rewriteRefs(html: string): string {
  // Split on <code>...</code> blocks; rewrite only outside them so backtick-escaped
  // examples like `[mcp:foo]` stay literal in documentation.
  const parts = html.split(/(<code\b[^>]*>[\s\S]*?<\/code>)/i);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/\[(mcp|tool):([^\]]+)\]/gi, (_, kind, name) => {
        const k = (kind as string).toLowerCase();
        return (
          `<span class="ref-chip ref-${k}">` +
          `<span class="ref-chip-kind">${k}</span>` +
          `<span class="ref-chip-name">${escapeHtml(name.trim())}</span>` +
          `</span>`
        );
      });
    })
    .join("");
}

function md(text: string): string {
  return rewriteRefs(marked.parse(text, { async: false }) as string);
}

function mdInline(text: string): string {
  return rewriteRefs(marked.parseInline(text, { async: false }) as string);
}

function stripWrappingP(html: string): string {
  const trimmed = html.trim();
  const m = trimmed.match(/^<p>([\s\S]*?)<\/p>\s*$/);
  if (m && !m[1].includes("<p>")) return m[1];
  return trimmed;
}

// ---------- IR construction ----------

// Parse the body of a single ```block:<kind> fence into a typed BlockNode.
// Returns undefined for unknown kinds or unparseable bodies — callers fall back
// to a <pre> rendering.
function buildBlockNode(kind: string, body: string): BlockNode | undefined {
  switch (kind) {
    case "layers":   return buildLayersBlock(body);
    case "compare":  return buildCompareBlock(body);
    case "sequence": return buildSequenceBlock(body);
    case "table":    return buildTableBlock(body);
    case "callout":  return buildCalloutBlock(body);
    case "metric":   return buildMetricBlock(body);
    case "tldr":     return buildTldrBlock(body);
    default:         return undefined;
  }
}

function buildLayersBlock(body: string): BlockLayersNode | undefined {
  const lines = body.split(/\r?\n/);
  const items: BlockLayersNode["items"] = [];
  const lineRe = /^\s*(\d+)\.\s+(.+?)(?:\s+[—–-]\s+(.+))?\s*$/;
  for (const line of lines) {
    const m = line.match(lineRe);
    if (!m) continue;
    const description = (m[3] ?? "").trim();
    items.push({
      num: m[1],
      title: m[2].trim(),
      ...(description ? { description } : {}),
    });
  }
  if (items.length === 0) return undefined;
  return { type: "block", kind: "layers", items };
}

function buildCompareBlock(body: string): BlockCompareNode | undefined {
  const lines = body.split(/\r?\n/);
  const options: BlockCompareNode["options"] = [];
  let current: { title: string; points: string[] } | null = null;
  const topRe = /^-\s+(.+)$/;
  const subRe = /^\s{2,}-\s+(.+)$/;
  for (const line of lines) {
    if (!line.trim()) continue;
    const sub = line.match(subRe);
    if (sub && current) {
      current.points.push(sub[1].trim());
      continue;
    }
    const top = line.match(topRe);
    if (top) {
      if (current) options.push(current);
      current = { title: top[1].trim(), points: [] };
    }
  }
  if (current) options.push(current);
  if (options.length === 0) return undefined;
  return { type: "block", kind: "compare", options };
}

function buildSequenceBlock(body: string): BlockSequenceNode | undefined {
  const lines = body.split(/\r?\n/);
  const steps: BlockSequenceNode["steps"] = [];
  const lineRe = /^\s*(\d+)\.\s+(.+?)\s*$/;
  for (const line of lines) {
    const m = line.match(lineRe);
    if (!m) continue;
    steps.push({ num: m[1], text: m[2].trim() });
  }
  if (steps.length === 0) return undefined;
  return { type: "block", kind: "sequence", steps };
}

function buildTableBlock(body: string): BlockTableNode | undefined {
  const rawLines = body.split(/\r?\n/);
  const rows: string[][] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.includes("|")) continue;
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  if (rows.length === 0) return undefined;
  const header = rows[0];
  const body_ = rows.slice(1);
  return { type: "block", kind: "table", header, rows: body_ };
}

function buildCalloutBlock(body: string): BlockCalloutNode {
  let tone: CalloutTone = "info";
  let rest = body;
  const m = body.match(/^\s*\[!\s*(info|warn|danger|success)\s*\]\s*/i);
  if (m) {
    tone = m[1].toLowerCase() as CalloutTone;
    rest = body.slice(m[0].length);
  }
  const html = stripWrappingP(md(rest.trim()));
  return { type: "block", kind: "callout", tone, html };
}

function buildMetricBlock(body: string): BlockMetricNode | undefined {
  const lines = body.split(/\r?\n/);
  const items: BlockMetricNode["items"] = [];
  const lineRe = /^-\s+\*\*(.+?)\*\*\s+[—–-]\s+(.+)$/;
  for (const line of lines) {
    const m = line.trim().match(lineRe);
    if (!m) continue;
    items.push({ value: m[1].trim(), label: m[2].trim() });
  }
  if (items.length === 0) return undefined;
  return { type: "block", kind: "metric", items };
}

function buildTldrBlock(body: string): BlockTldrNode {
  const html = stripWrappingP(md(body.trim()));
  return { type: "block", kind: "tldr", html };
}

// Split a section's raw markdown into a list of IR nodes — block fences become
// typed BlockNodes; surrounding prose becomes MarkdownNode (pre-rendered HTML).
// This is the primary path for top-level block fences inside a section body.
export function parseSectionToIR(text: string): PlanNode[] {
  const nodes: PlanNode[] = [];
  const blockRe = /^```block:([a-z]+)\s*\n([\s\S]*?)```\s*$/gm;
  let lastIndex = 0;
  for (const m of text.matchAll(blockRe)) {
    const idx = m.index ?? 0;
    const prefix = text.slice(lastIndex, idx);
    if (prefix.trim()) nodes.push({ type: "markdown", html: md(prefix) });
    const blockNode = buildBlockNode(m[1], m[2]);
    if (blockNode) {
      nodes.push(blockNode);
    } else {
      nodes.push({ type: "markdown", html: `<pre class="block-fallback"><code>${escapeHtml(m[2])}</code></pre>` });
    }
    lastIndex = idx + m[0].length;
  }
  const tail = text.slice(lastIndex);
  if (tail.trim()) nodes.push({ type: "markdown", html: md(tail) });
  return nodes;
}

// Build the Plan IR from raw render options. Pure: no filesystem, no template,
// no side effects — just markdown in, IR out.
export function buildPlanIR(opts: RenderOptions & { plan_id: string }): PlanRoot {
  const sections = extractSections(opts.markdown);

  const questions = parseQuestions(sections.openQuestions);
  const steps = parseSteps(sections.steps);
  const risks = parseRisks(sections.risks);
  const preconditions = parseListItems(sections.preconditions);
  const filesList = parseFiles(sections.files);
  const stackChanges = parseListItems(sections.stackChanges);

  const status = sections.status
    ? sections.status.toLowerCase().trim()
    : questions.length > 0
      ? "needs review"
      : "ready";

  const children: PlanNode[] = [];

  if (sections.summary) {
    children.push({ type: "summary", html: md(sections.summary) } as SummarySection);
  }

  if (questions.length > 0) {
    children.push({
      type: "questions",
      items: questions.map((q) => ({ text: q.text, kind: q.kind, options: q.options })),
    } as QuestionsSection);
  }

  if (steps.length > 0) {
    children.push({
      type: "steps",
      items: steps.map((s) => ({
        num: s.num,
        title: s.title,
        ...(s.description !== undefined ? { description: s.description } : {}),
        files: s.files,
        ...(s.dependsOn !== undefined ? { dependsOn: s.dependsOn } : {}),
      })),
    } as StepsSection);
  }

  if (risks.length > 0) {
    children.push({
      type: "risks",
      items: risks.map((r) => {
        const splitMatch = r.text.match(/^(.+?)\s+[—–-]\s+(.+)$/s);
        const title = splitMatch ? splitMatch[1].trim() : r.text;
        const description = splitMatch ? splitMatch[2].trim() : undefined;
        return {
          title,
          ...(description ? { description } : {}),
          severity: r.severity,
        };
      }),
    } as RisksSection);
  }

  for (const note of sections.notes) {
    children.push({
      type: "note",
      heading: note.heading,
      html: md(note.content),
    } as NoteSection);
  }

  if (preconditions.length > 0) {
    children.push({
      type: "raillist",
      variant: "preconditions",
      title: "Preconditions",
      items: preconditions,
    } as RailListSection);
  }

  if (filesList.length > 0) {
    children.push({
      type: "raillist",
      variant: "files",
      title: "Files Touched",
      items: filesList,
      countBadge: filesList.length,
      mono: true,
    } as RailListSection);
  }

  if (stackChanges.length > 0) {
    children.push({
      type: "raillist",
      variant: "stack-changes",
      title: "Changes to Stack",
      items: stackChanges,
    } as RailListSection);
  }

  return {
    type: "plan",
    id: opts.plan_id,
    title: opts.title,
    status,
    rawMdPath: `${opts.plan_id}.md`,
    children,
  };
}

// ---------- IR rendering ----------

function renderSummary(node: SummarySection): string {
  return node.html;
}

function renderQuestions(node: QuestionsSection): string {
  if (node.items.length === 0) return "";
  const items = node.items
    .map((q, i) => {
      const idx = i + 1;
      if (q.kind === "text" || q.options.length === 0) {
        return (
          `      <li>\n` +
          `        <label for="q${idx}" class="q-label">${mdInline(q.text)}</label>\n` +
          `        <textarea id="q${idx}" data-question data-q-num="${idx}" rows="2" placeholder="Type answer…"></textarea>\n` +
          `      </li>`
        );
      }
      const inputType = q.kind === "checkbox" ? "checkbox" : "radio";
      const groupName = `q${idx}-group`;
      const optionsHtml = q.options
        .map((opt, j) => {
          const optId = `q${idx}-opt${j}`;
          return (
            `          <label class="q-option" for="${optId}">\n` +
            `            <input type="${inputType}" id="${optId}" name="${groupName}" data-q-option data-q-num="${idx}" value="${escapeHtml(opt)}">\n` +
            `            <span class="q-option-text">${mdInline(opt)}</span>\n` +
            `          </label>`
          );
        })
        .join("\n");
      return (
        `      <li>\n` +
        `        <div class="q-label">${mdInline(q.text)}</div>\n` +
        `        <div class="q-options q-options-${q.kind}">\n${optionsHtml}\n        </div>\n` +
        `      </li>`
      );
    })
    .join("\n");
  return (
    `<section class="card card-questions">\n` +
    `  <h2 class="card-title"><span class="badge badge-warn">⚠</span> Open Questions <span class="count">${node.items.length}</span></h2>\n` +
    `  <ol class="questions">\n${items}\n  </ol>\n` +
    `</section>`
  );
}

function renderSteps(node: StepsSection): string {
  if (node.items.length === 0) return "";
  const items = node.items
    .map((s) => {
      const blocked = s.dependsOn !== undefined;
      const hasBody = Boolean(s.description) || s.files.length > 0;
      const viewDetailsBtn = hasBody
        ? `        <button type="button" class="step-view-details" data-step-details="${s.num}" aria-expanded="false">View details</button>\n`
        : "";
      const trailing = blocked
        ? `        <span class="step-blocked-note muted small">⊘ blocked by step ${s.dependsOn}</span>\n`
        : `        <label class="step-parallel-check">\n` +
          `          <input type="checkbox" data-step-parallel data-step="${s.num}">\n` +
          `          <span>Fork</span>\n` +
          `        </label>\n`;
      const descriptionHtml = s.description
        ? `        <div class="step-description prose">${md(s.description)}</div>\n`
        : "";
      const filesHtml =
        s.files.length > 0
          ? `        <div class="step-files-row">\n` +
            `          <span class="step-files-label">Files:</span>\n` +
            `          <div class="step-files">` +
            s.files.map((f) => `<span class="chip mono">${escapeHtml(f)}</span>`).join("") +
            `</div>\n` +
            `        </div>\n`
          : "";
      const bodyHtml = hasBody
        ? `      <div class="step-body" data-step-body="${s.num}" hidden>\n` +
          descriptionHtml +
          filesHtml +
          `      </div>\n`
        : "";
      return (
        `    <li class="step${blocked ? " step-blocked" : ""}">\n` +
        `      <div class="step-header">\n` +
        `        <span class="step-num">${s.num}</span>\n` +
        `        <span class="step-title">${mdInline(s.title)}</span>\n` +
        `        <div class="step-actions">\n` +
        viewDetailsBtn +
        trailing +
        `        </div>\n` +
        `      </div>\n` +
        bodyHtml +
        `    </li>`
      );
    })
    .join("\n");
  const hasParallelizable = node.items.some((s) => s.dependsOn === undefined);
  const globalToggle = hasParallelizable
    ? `    <label class="step-parallel-check step-parallel-check-all">\n` +
      `      <input type="checkbox" data-step-parallel-all>\n` +
      `      <span>Fork all</span>\n` +
      `    </label>\n`
    : "";
  return (
    `<section class="card card-steps">\n` +
    `  <div class="card-header">\n` +
    `    <h2 class="card-title">Steps <span class="count">${node.items.length}</span></h2>\n` +
    globalToggle +
    `  </div>\n` +
    `  <ol class="steps">\n${items}\n  </ol>\n` +
    `</section>`
  );
}

function renderRisks(node: RisksSection): string {
  if (node.items.length === 0) return "";
  const icon =
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>` +
    `<path d="M12 9v4"/>` +
    `<path d="M12 17h.01"/>` +
    `</svg>`;
  const cards = node.items
    .map((r) => {
      const sevClass = r.severity !== "none" ? ` sev-${r.severity}` : " sev-none";
      const descHtml = r.description
        ? `      <div class="risk-card-desc">${mdInline(r.description)}</div>\n`
        : "";
      return (
        `    <div class="risk-card${sevClass}">\n` +
        `      <div class="risk-icon-wrap">${icon}</div>\n` +
        `      <div class="risk-card-title">${mdInline(r.title)}</div>\n` +
        descHtml +
        `    </div>`
      );
    })
    .join("\n");
  return (
    `<section class="card card-risks">\n` +
    `  <h2 class="card-title">Risks <span class="count">${node.items.length}</span></h2>\n` +
    `  <div class="risks-grid">\n${cards}\n  </div>\n` +
    `</section>`
  );
}

function renderNote(node: NoteSection): string {
  return (
    `<section class="card card-note">\n` +
    `  <h2 class="card-title">${escapeHtml(node.heading)}</h2>\n` +
    `  <div class="prose">${node.html}</div>\n` +
    `</section>`
  );
}

function renderRailList(node: RailListSection): string {
  if (node.items.length === 0) return "";
  const extraClass =
    node.variant === "files" ? "rail-files" : node.variant === "stack-changes" ? "rail-stack" : undefined;
  const showCount = node.countBadge !== undefined;
  const mono = node.mono === true;
  const titleHtml = showCount
    ? `${node.title} <span class="count">${node.items.length}</span>`
    : node.title;
  const liClass = mono ? ' class="mono"' : "";
  const lis = node.items
    .map((it) => `    <li${liClass}>${mono ? escapeHtml(it) : mdInline(it)}</li>`)
    .join("\n");
  const ulClass = extraClass ? `rail-list ${extraClass}` : "rail-list";
  return (
    `<section class="rail-card">\n` +
    `  <h3 class="rail-title">${titleHtml}</h3>\n` +
    `  <ul class="${ulClass}">\n${lis}\n  </ul>\n` +
    `</section>`
  );
}

// ---------- Block renderers (typed data → HTML) ----------

function renderBlock(node: BlockNode): string {
  switch (node.kind) {
    case "layers":   return renderLayersBlock(node);
    case "compare":  return renderCompareBlock(node);
    case "sequence": return renderSequenceBlock(node);
    case "table":    return renderTableBlock(node);
    case "callout":  return renderCalloutBlock(node);
    case "metric":   return renderMetricBlock(node);
    case "tldr":     return renderTldrBlock(node);
  }
}

function renderLayersBlock(b: BlockLayersNode): string {
  const items = b.items
    .map(
      (l) =>
        `  <div class="block-layer">\n` +
        `    <div class="block-layer-num">${escapeHtml(l.num)}</div>\n` +
        `    <div class="block-layer-body">\n` +
        `      <div class="block-layer-title">${mdInline(l.title)}</div>\n` +
        (l.description ? `      <div class="block-layer-desc">${mdInline(l.description)}</div>\n` : "") +
        `    </div>\n` +
        `  </div>`
    )
    .join("\n");
  return `<div class="block-layers">\n${items}\n</div>`;
}

function renderCompareBlock(b: BlockCompareNode): string {
  const cards = b.options
    .map((o) => {
      const points = o.points
        .map((p) => `      <li>${mdInline(p)}</li>`)
        .join("\n");
      return (
        `  <div class="block-compare-option">\n` +
        `    <div class="block-compare-title">${mdInline(o.title)}</div>\n` +
        (o.points.length > 0
          ? `    <ul class="block-compare-points">\n${points}\n    </ul>\n`
          : "") +
        `  </div>`
      );
    })
    .join("\n");
  return `<div class="block-compare">\n${cards}\n</div>`;
}

function renderSequenceBlock(b: BlockSequenceNode): string {
  const parts: string[] = [];
  b.steps.forEach((s, i) => {
    parts.push(
      `  <div class="block-sequence-step">\n` +
        `    <span class="block-sequence-num">${escapeHtml(s.num)}</span>\n` +
        `    <span class="block-sequence-text">${mdInline(s.text)}</span>\n` +
        `  </div>`
    );
    if (i < b.steps.length - 1) {
      parts.push(`  <span class="block-sequence-arrow" aria-hidden="true">→</span>`);
    }
  });
  return `<div class="block-sequence">\n${parts.join("\n")}\n</div>`;
}

function renderTableBlock(b: BlockTableNode): string {
  const thead =
    `  <thead>\n` +
    `    <tr>${b.header.map((c) => `<th>${mdInline(c)}</th>`).join("")}</tr>\n` +
    `  </thead>`;
  const tbody =
    b.rows.length > 0
      ? `  <tbody>\n` +
        b.rows
          .map(
            (r) => `    <tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join("")}</tr>`
          )
          .join("\n") +
        `\n  </tbody>`
      : "";
  return `<table class="block-table">\n${thead}\n${tbody}\n</table>`;
}

const CALLOUT_ICONS: Record<CalloutTone, string> = {
  info: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`,
  warn: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>`,
  danger: `<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><path d="M12 8v4"/><path d="M12 16h.01"/>`,
  success: `<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>`,
};

function renderCalloutBlock(b: BlockCalloutNode): string {
  const iconPath = CALLOUT_ICONS[b.tone];
  const icon =
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPath}</svg>`;
  return (
    `<div class="block-callout block-callout-${b.tone}">\n` +
    `  <div class="block-callout-icon" aria-hidden="true">${icon}</div>\n` +
    `  <div class="block-callout-body">${b.html}</div>\n` +
    `</div>`
  );
}

function renderMetricBlock(b: BlockMetricNode): string {
  const cards = b.items
    .map(
      (mt) =>
        `  <div class="block-metric">\n` +
        `    <div class="block-metric-value">${mdInline(mt.value)}</div>\n` +
        `    <div class="block-metric-label">${mdInline(mt.label)}</div>\n` +
        `  </div>`
    )
    .join("\n");
  return `<div class="block-metrics">\n${cards}\n</div>`;
}

function renderTldrBlock(b: BlockTldrNode): string {
  return (
    `<div class="block-tldr">\n` +
    `  <div class="block-tldr-label">TL;DR</div>\n` +
    `  <div class="block-tldr-body">${b.html}</div>\n` +
    `</div>`
  );
}

// Dispatch a single PlanNode to HTML. Used by renderIR for prose-context contexts
// (currently MarkdownNode embedded in section bodies via parseSectionToIR).
function renderNode(node: PlanNode): string {
  switch (node.type) {
    case "plan":     return node.children.map(renderNode).join("\n");
    case "summary":  return renderSummary(node);
    case "questions":return renderQuestions(node);
    case "steps":    return renderSteps(node);
    case "risks":    return renderRisks(node);
    case "note":     return renderNote(node);
    case "raillist": return renderRailList(node);
    case "block":    return renderBlock(node);
    case "markdown": return node.html;
  }
}

// Walk the IR tree and return a placeholder map for the template injector.
// Each top-level slot (SUMMARY, QUESTIONS, STEPS, RISKS, NOTES, PRECONDITIONS,
// FILES, STACK_CHANGES, GATING_HINT) is filled by the matching IR section(s).
export function renderIR(ir: PlanRoot): RenderPlacements {
  const out: RenderPlacements = {
    SUMMARY: "",
    QUESTIONS: "",
    STEPS: "",
    RISKS: "",
    NOTES: "",
    PRECONDITIONS: "",
    FILES: "",
    STACK_CHANGES: "",
    GATING_HINT: "",
  };
  const notes: string[] = [];
  let questionCount = 0;
  for (const node of ir.children) {
    switch (node.type) {
      case "summary":
        out.SUMMARY = renderSummary(node);
        break;
      case "questions":
        questionCount = node.items.length;
        out.QUESTIONS = renderQuestions(node);
        break;
      case "steps":
        out.STEPS = renderSteps(node);
        break;
      case "risks":
        out.RISKS = renderRisks(node);
        break;
      case "note":
        notes.push(renderNote(node));
        break;
      case "raillist":
        if (node.variant === "preconditions") out.PRECONDITIONS = renderRailList(node);
        else if (node.variant === "files") out.FILES = renderRailList(node);
        else if (node.variant === "stack-changes") out.STACK_CHANGES = renderRailList(node);
        break;
      // Unexpected top-level node kinds are ignored — the IR's top-level shape
      // is sectional today, but we keep the switch exhaustive-friendly.
      case "plan":
      case "block":
      case "markdown":
        break;
    }
  }
  out.NOTES = notes.join("\n");
  out.GATING_HINT =
    questionCount > 0
      ? `<div class="gating-hint">⚠ Answer ${questionCount} question(s) to approve</div>`
      : "";
  return out;
}

async function ensureFontsDeployed(): Promise<void> {
  try {
    const srcFonts = path.join(import.meta.dirname, "template", "fonts");
    const dstFonts = path.join(PLANS_DIR, "fonts");
    await fs.mkdir(dstFonts, { recursive: true });
    const entries = await fs.readdir(srcFonts);
    await Promise.all(
      entries
        .filter((name) => name.endsWith(".woff2"))
        .map(async (name) => {
          const src = path.join(srcFonts, name);
          const dst = path.join(dstFonts, name);
          try {
            await fs.stat(dst);
            return;
          } catch {
            await fs.copyFile(src, dst);
          }
        })
    );
  } catch {
    // Font deployment failure must not block plan rendering;
    // HTML falls back to system fonts via CSS fallback stack.
  }
}

async function pruneOldPlans(): Promise<void> {
  try {
    const entries = await fs.readdir(PLANS_DIR);
    const stats = await Promise.all(
      entries.map(async (name) => {
        const full = path.join(PLANS_DIR, name);
        try {
          const st = await fs.stat(full);
          return { name, full, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
    );
    const valid = stats.filter((s): s is { name: string; full: string; mtime: number } => s !== null);
    const byId = new Map<string, { mtime: number; files: string[] }>();
    for (const s of valid) {
      const m = s.name.match(/^(plan_[a-z0-9]+)\.(?:md|html)$/);
      if (!m) continue;
      const id = m[1];
      const cur = byId.get(id);
      if (cur) {
        cur.mtime = Math.max(cur.mtime, s.mtime);
        cur.files.push(s.full);
      } else {
        byId.set(id, { mtime: s.mtime, files: [s.full] });
      }
    }
    const sorted = [...byId.values()].sort((a, b) => b.mtime - a.mtime);
    const toDelete = sorted.slice(50);
    await Promise.all(
      toDelete.flatMap((g) => g.files.map((f) => fs.unlink(f).catch(() => undefined)))
    );
  } catch {
    // pruning failures must not affect render success
  }
}

export async function renderPlan(opts: RenderOptions): Promise<RenderResult> {
  const plan_id = opts.plan_id ?? genPlanId();
  await fs.mkdir(PLANS_DIR, { recursive: true });
  await ensureFontsDeployed();

  const [templateHtml, styles, script] = await Promise.all([
    fs.readFile(path.join(TEMPLATE_DIR, "template.html"), "utf8"),
    fs.readFile(path.join(TEMPLATE_DIR, "styles.css"), "utf8"),
    fs.readFile(path.join(TEMPLATE_DIR, "actions.js"), "utf8"),
  ]);

  const ir = buildPlanIR({ ...opts, plan_id });
  const placements = renderIR(ir);

  const md_path = path.join(PLANS_DIR, `${plan_id}.md`);
  const html_path = path.join(PLANS_DIR, `${plan_id}.html`);

  const replacements: Record<string, string> = {
    PLAN_ID: ir.id,
    TITLE: escapeHtml(ir.title),
    STATUS: escapeHtml(ir.status),
    SUMMARY: placements.SUMMARY,
    QUESTIONS: placements.QUESTIONS,
    STEPS: placements.STEPS,
    RISKS: placements.RISKS,
    NOTES: placements.NOTES,
    PRECONDITIONS: placements.PRECONDITIONS,
    FILES: placements.FILES,
    STACK_CHANGES: placements.STACK_CHANGES,
    GATING_HINT: placements.GATING_HINT,
    RAW_MD_NAME: ir.rawMdPath,
    PREFS_SCRIPT: prefsScript(await readPrefs()),
    STYLES: styles,
    SCRIPT: script,
  };

  const html = templateHtml.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : ""
  );

  await Promise.all([fs.writeFile(md_path, opts.markdown, "utf8"), fs.writeFile(html_path, html, "utf8")]);

  await pruneOldPlans();

  return { plan_id, url: `file://${html_path}`, md_path, html_path };
}
