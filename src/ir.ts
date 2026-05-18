// Plan IR — typed, JSON-serializable intermediate representation.
//
// The parser produces a PlanRoot (pure data); renderers consume it to emit HTML
// (today) or other targets (PDF/email/RSC in the future).
//
// Conventions:
//   - Structured content (steps, risks, questions, layers/compare/sequence/table/metric)
//     is stored as data so alt renderers can re-format freely.
//   - Free-form prose (summary, notes, callout body, tldr body) is pre-rendered to
//     HTML and carried as `html: string` — re-parsing marked output downstream
//     would be wasted work; alt renderers accept HTML for these.
//   - Top-level discriminator is `type`; for blocks the secondary discriminator is `kind`.

export type PlanNode =
  | PlanRoot
  | SummarySection
  | QuestionsSection
  | StepsSection
  | RisksSection
  | NoteSection
  | RailListSection
  | BlockNode
  | MarkdownNode;

export interface PlanRoot {
  type: "plan";
  id: string;
  title: string;
  status: string;
  rawMdPath: string;
  children: PlanNode[];
}

export interface SummarySection {
  type: "summary";
  html: string;
}

export type QuestionKind = "text" | "checkbox" | "radio";

export interface QuestionItem {
  text: string;
  kind: QuestionKind;
  options: string[];
}

export interface QuestionsSection {
  type: "questions";
  items: QuestionItem[];
}

export interface StepItem {
  num: number;
  title: string;
  description?: string;
  files: string[];
  dependsOn?: number;
}

export interface StepsSection {
  type: "steps";
  items: StepItem[];
}

export type RiskSeverity = "high" | "med" | "low" | "none";

export interface RiskItem {
  title: string;
  description?: string;
  severity: RiskSeverity;
}

export interface RisksSection {
  type: "risks";
  items: RiskItem[];
}

export interface NoteSection {
  type: "note";
  heading: string;
  html: string;
}

export type RailListVariant = "preconditions" | "files" | "stack-changes";

export interface RailListSection {
  type: "raillist";
  variant: RailListVariant;
  title: string;
  items: string[];
  countBadge?: number;
  mono?: boolean;
}

// Block catalog — typed components invoked via ```block:<kind> fences.

export type BlockNode =
  | BlockLayersNode
  | BlockCompareNode
  | BlockSequenceNode
  | BlockTableNode
  | BlockCalloutNode
  | BlockMetricNode
  | BlockTldrNode;

export interface BlockLayersNode {
  type: "block";
  kind: "layers";
  items: Array<{ num: string; title: string; description?: string }>;
}

export interface BlockCompareNode {
  type: "block";
  kind: "compare";
  options: Array<{ title: string; points: string[] }>;
}

export interface BlockSequenceNode {
  type: "block";
  kind: "sequence";
  steps: Array<{ num: string; text: string }>;
}

export interface BlockTableNode {
  type: "block";
  kind: "table";
  header: string[];
  rows: string[][];
}

export type CalloutTone = "info" | "warn" | "danger" | "success";

export interface BlockCalloutNode {
  type: "block";
  kind: "callout";
  tone: CalloutTone;
  html: string;
}

export interface BlockMetricNode {
  type: "block";
  kind: "metric";
  items: Array<{ value: string; label: string }>;
}

export interface BlockTldrNode {
  type: "block";
  kind: "tldr";
  html: string;
}

// MarkdownNode is a free-form escape hatch — pre-rendered HTML for prose chunks
// that don't fit one of the structured types.
export interface MarkdownNode {
  type: "markdown";
  html: string;
}

// Placeholder map produced by the IR walker; consumed by the template injector.
export interface RenderPlacements {
  SUMMARY: string;
  QUESTIONS: string;
  STEPS: string;
  RISKS: string;
  NOTES: string;
  PRECONDITIONS: string;
  FILES: string;
  STACK_CHANGES: string;
  GATING_HINT: string;
}
