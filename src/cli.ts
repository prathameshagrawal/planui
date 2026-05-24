#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { renderPlan } from "./render.js";
import { runSetup, runUpgrade, runUninstall } from "./setup.js";

function printUsage(): void {
  console.log(`planui — render AI agent plans as scannable HTML

Usage:
  planui setup                            Add PlanUI to Claude Code (one-time)
  planui upgrade                          Pull the latest version + re-install
  planui uninstall                        Remove MCP entry + slash command
  planui render <plan.md> [title]         Render a plan markdown to HTML
  planui --help                           Show this help

After running setup, restart Claude Code and use /planui <task> in any chat.

Tip: always invoke via "npx -y @prathamux/planui@latest <command>" to
guarantee npx pulls the newest published version. Do NOT run from inside
a directory whose package.json name is @prathamux/planui — npx will try
local resolution instead of the registry and fail with "command not found".`);
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
  if (cmd === "upgrade") {
    await runUpgrade();
    return;
  }
  if (cmd === "uninstall") {
    await runUninstall();
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
