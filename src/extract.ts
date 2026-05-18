export interface Sections {
  summary: string;
  openQuestions: string;
  steps: string;
  risks: string;
  preconditions: string;
  files: string;
  stackChanges: string;
  status: string;
  notes: { heading: string; content: string }[];
}

export interface Step {
  num: number;
  title: string;
  description?: string;
  files: string[];
  dependsOn?: number;
}

export interface Risk {
  text: string;
  severity: "high" | "med" | "low" | "none";
}

type SectionKey = Exclude<keyof Sections, "notes">;

function normalizeHeading(h: string): string {
  return h.toLowerCase().replace(/[\s:.?!,;]+$/g, "").trim();
}

function mapHeading(h: string): SectionKey | null {
  const n = normalizeHeading(h);
  switch (n) {
    case "summary":
    case "overview":
    case "tl;dr":
      return "summary";
    case "open questions":
    case "questions":
      return "openQuestions";
    case "steps":
    case "plan":
    case "implementation":
    case "implementation plan":
      return "steps";
    case "risks":
    case "risk":
      return "risks";
    case "preconditions":
    case "requirements":
    case "prerequisites":
    case "prereqs":
      return "preconditions";
    case "files":
    case "files touched":
    case "affected files":
      return "files";
    case "stack changes":
    case "changes to stack":
    case "dependencies":
    case "new tools":
      return "stackChanges";
    case "status":
      return "status";
    default:
      return null;
  }
}

export function extractSections(markdown: string): Sections {
  const sections: Sections = {
    summary: "",
    openQuestions: "",
    steps: "",
    risks: "",
    preconditions: "",
    files: "",
    stackChanges: "",
    status: "",
    notes: [],
  };

  const lines = markdown.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentHeading === null) return;
    const content = buffer.join("\n").trim();
    const key = mapHeading(currentHeading);
    if (key) {
      sections[key] = content;
    } else {
      sections.notes.push({ heading: currentHeading, content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      flush();
      currentHeading = m[1].trim();
    } else if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

export function parseListItems(text: string): string[] {
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const items: string[] = [];
  let current: string | null = null;
  let baseIndent = 0;

  const bulletRe = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/;

  for (const line of lines) {
    const m = line.match(bulletRe);
    if (m) {
      if (current !== null) items.push(current.trim());
      baseIndent = m[1].length;
      current = m[2];
    } else if (current !== null && line.trim() === "") {
      // blank line — keep gathering, but don't add
    } else if (current !== null) {
      const indentMatch = line.match(/^(\s*)(.*)$/);
      if (indentMatch && indentMatch[1].length > baseIndent && indentMatch[2].trim() !== "") {
        current += " " + indentMatch[2].trim();
      } else if (line.trim() !== "") {
        // non-list, non-indented line ends the list
        items.push(current.trim());
        current = null;
      }
    }
  }
  if (current !== null) items.push(current.trim());
  return items.filter((s) => s.length > 0);
}

export type QuestionKind = "text" | "checkbox" | "radio";
export interface Question {
  text: string;
  kind: QuestionKind;
  options: string[];
}

export function parseQuestions(text: string): Question[] {
  const lines = text.split(/\r?\n/);
  const questions: Question[] = [];
  let current: Question | null = null;
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const qMatch = rawLine.match(/^\s*(?:\d+\.|[-*+])\s+(.+)$/);
    const cbMatch = rawLine.match(/^\s{2,}-\s+\[[ xX]\]\s+(.+)$/);
    const rbMatch = rawLine.match(/^\s{2,}-\s+\([ xX]\)\s+(.+)$/);
    if (cbMatch && current) {
      current.kind = "checkbox";
      current.options.push(cbMatch[1].trim());
      continue;
    }
    if (rbMatch && current) {
      current.kind = "radio";
      current.options.push(rbMatch[1].trim());
      continue;
    }
    if (qMatch) {
      if (current) questions.push(current);
      current = { text: qMatch[1].trim(), kind: "text", options: [] };
      continue;
    }
    if (current && /^\s+\S/.test(rawLine) && current.options.length === 0) {
      current.text += " " + rawLine.trim();
    }
  }
  if (current) questions.push(current);
  return questions;
}

export function parseFiles(text: string): string[] {
  const items = parseListItems(text);
  if (items.length > 0) {
    return items.map((s) => s.replace(/^`(.+)`$/, "$1").trim()).filter((s) => s.length > 0);
  }
  const codeSpans = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
  if (codeSpans.length > 0) return codeSpans;
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseSteps(text: string): Step[] {
  const items = parseListItems(text);
  return items.map((raw, i) => {
    let rest = raw;
    let dependsOn: number | undefined;

    const depRe = /\(\s*depends?(?:\s+on|_on:)\s*(\d+)\s*\)/i;
    const depMatch = rest.match(depRe);
    if (depMatch) {
      dependsOn = parseInt(depMatch[1], 10);
      rest = rest.replace(depRe, "").trim();
    }

    const files: string[] = [];
    for (const m of rest.matchAll(/`([^`]+)`/g)) {
      const s = m[1].trim();
      if (/[./]/.test(s)) files.push(s);
    }

    let title = rest;
    let description: string | undefined;
    const splitRe = /^\*\*([^*]+?)\*\*\s*(?:—|–|-|:)\s*(.+)$/s;
    const splitMatch = rest.match(splitRe);
    if (splitMatch) {
      title = splitMatch[1].trim();
      description = splitMatch[2].trim();
    }

    return { num: i + 1, title, description, files, dependsOn };
  });
}

export function parseRisks(text: string): Risk[] {
  const items = parseListItems(text);
  return items.map((raw) => {
    const sevRe = /\[(high|med|medium|low)\]/i;
    const m = raw.match(sevRe);
    if (m) {
      const cleaned = raw.replace(sevRe, "").trim();
      const rawSev = m[1].toLowerCase();
      const severity: Risk["severity"] = rawSev === "medium" ? "med" : (rawSev as "high" | "med" | "low");
      return { text: cleaned, severity };
    }
    return { text: raw, severity: "none" };
  });
}
