#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { renderPlan } from "./render.js";
import { runSetup } from "./setup.js";

function printUsage(): void {
  console.log(`planui — render AI agent plans as scannable HTML

Usage:
  planui setup                            Add PlanUI to Claude Code (one-time)
  planui render <plan.md> [title]         Render a plan markdown to HTML
  planui --help                           Show this help

After running setup, restart Claude Code and use /planui <task> in any chat.`);
}

async function runRender(args: string[]): Promise<void> {
  const mdPath = args[0];
  if (!mdPath) {
    console.error("planui render: missing markdown path");
    process.exit(1);
  }
  const titleArg = args[1];
  const abs = path.resolve(mdPath);
  const markdown = await fs.readFile(abs, "utf8");
  const title = titleArg ?? path.basename(abs, path.extname(abs));
  const result = await renderPlan({ title, markdown });
  console.log(result.url);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printUsage();
    return;
  }
  if (cmd === "setup") {
    await runSetup();
    return;
  }
  if (cmd === "render") {
    await runRender(argv.slice(1));
    return;
  }
  // Legacy: planui <path> [title]
  if (cmd.endsWith(".md") || cmd.includes("/") || cmd.includes("\\")) {
    await runRender(argv);
    return;
  }
  console.error(`Unknown command: ${cmd}`);
  printUsage();
  process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`planui: ${msg}`);
  process.exit(1);
});
