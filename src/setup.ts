import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { renderPlan } from "./render.js";

// Minimal slice of ~/.claude.json we touch.
interface ClaudeConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  [key: string]: unknown;
}

const HOME = os.homedir();
const CLAUDE_JSON = path.join(HOME, ".claude.json");
const COMMANDS_DIR = path.join(HOME, ".claude", "commands");
const COMMAND_FILE = path.join(COMMANDS_DIR, "planui.md");

const PLANUI_MCP_COMMAND = "npx";
const PLANUI_MCP_ARGS = ["-y", "--package=@prathamux/planui", "planui-mcp"];

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOrNull(p: string): Promise<ClaudeConfig | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw) as ClaudeConfig;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    if (e instanceof SyntaxError || (err as Error).name === "SyntaxError") {
      throw new Error(
        "Your ~/.claude.json is invalid JSON. Fix it manually, then re-run.",
      );
    }
    throw err;
  }
}

async function writeJsonAtomic(p: string, data: ClaudeConfig): Promise<void> {
  const tmp = `${p}.tmp`;
  const body = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, p);
}

async function checkEnvironment(): Promise<{ configExists: boolean }> {
  console.log("Checking environment...");
  console.log(`  ✓ Node ${process.versions.node}`);

  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
    console.log(`  ✓ Claude Code CLI detected`);
  } catch {
    // Not fatal — we can fall back to JSON edit.
    console.log(`  • Claude Code CLI not on PATH (will edit ~/.claude.json directly)`);
  }

  try {
    await fs.access(HOME, fsConstants.W_OK);
  } catch {
    throw new Error(`Home directory is not writable: ${HOME}`);
  }
  console.log(`  ✓ Home directory writable`);

  const configExists = await pathExists(CLAUDE_JSON);
  if (configExists) {
    // Trigger early validation so we fail fast on malformed JSON.
    await readJsonOrNull(CLAUDE_JSON);
    console.log(`  ✓ Claude Code config at ~/.claude.json`);
  } else {
    console.log(`  ✓ ~/.claude.json will be created`);
  }
  return { configExists };
}

function configHasPlanui(cfg: ClaudeConfig | null): boolean {
  const entry = cfg?.mcpServers?.planui;
  if (!entry) return false;
  if (entry.command !== PLANUI_MCP_COMMAND) return false;
  const args = entry.args ?? [];
  if (args.length !== PLANUI_MCP_ARGS.length) return false;
  return args.every((a, i) => a === PLANUI_MCP_ARGS[i]);
}

async function registerMcpServer(): Promise<void> {
  console.log("Installing...");

  // Idempotency precheck via direct JSON read — covers both CLI and fallback paths.
  const existing = await readJsonOrNull(CLAUDE_JSON);
  if (configHasPlanui(existing)) {
    console.log(`  ✓ MCP server "planui" already registered`);
    return;
  }

  // Try the official claude CLI first.
  let viaCli = false;
  try {
    execFileSync(
      "claude",
      ["mcp", "add", "planui", "-s", "user", "--", PLANUI_MCP_COMMAND, ...PLANUI_MCP_ARGS],
      { stdio: "ignore" },
    );
    viaCli = true;
  } catch {
    viaCli = false;
  }

  if (viaCli) {
    console.log(`  ✓ MCP server "planui" added via claude CLI`);
    return;
  }

  // Fallback: direct atomic JSON edit.
  const cfg: ClaudeConfig = existing ?? {};
  const servers = cfg.mcpServers ?? {};
  servers.planui = { command: PLANUI_MCP_COMMAND, args: [...PLANUI_MCP_ARGS] };
  cfg.mcpServers = servers;
  await writeJsonAtomic(CLAUDE_JSON, cfg);
  console.log(`  ✓ MCP server "planui" added (user scope, direct edit)`);
}

async function installSlashCommand(): Promise<void> {
  const srcPath = path.join(import.meta.dirname, "template", "commands", "planui.md");
  let sourceContent: string;
  try {
    sourceContent = await fs.readFile(srcPath, "utf8");
  } catch {
    throw new Error(
      `Slash command template missing at ${srcPath}. Did the package build correctly?`,
    );
  }

  await fs.mkdir(COMMANDS_DIR, { recursive: true });

  let existed = false;
  let existingContent: string | null = null;
  try {
    existingContent = await fs.readFile(COMMAND_FILE, "utf8");
    existed = true;
  } catch {
    existed = false;
  }

  if (existed && existingContent === sourceContent) {
    console.log(`  ✓ Slash command /planui already installed`);
    return;
  }

  const tmp = `${COMMAND_FILE}.tmp`;
  await fs.writeFile(tmp, sourceContent, "utf8");
  await fs.rename(tmp, COMMAND_FILE);

  if (existed) {
    console.log(`  ⚠ Updated ~/.claude/commands/planui.md (was modified)`);
  } else {
    console.log(`  ✓ Slash command /planui installed at ~/.claude/commands/planui.md`);
  }
}

async function resolveWelcomeMarkdown(): Promise<string | null> {
  // Try bundled location first (if Agent A wires it up), then dev/monorepo fallback.
  const candidates = [
    path.join(import.meta.dirname, "template", "welcome.md"),
    path.join(import.meta.dirname, "..", "examples", "welcome.md"),
  ];
  for (const c of candidates) {
    try {
      return await fs.readFile(c, "utf8");
    } catch {
      // try next
    }
  }
  return null;
}

function openInBrowser(url: string): void {
  let cmd: string;
  let args: string[];
  switch (process.platform) {
    case "darwin":
      cmd = "open";
      args = [url];
      break;
    case "win32":
      cmd = "cmd";
      args = ["/c", "start", "", url];
      break;
    default:
      cmd = "xdg-open";
      args = [url];
      break;
  }
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* swallow — caller already printed the URL */
    });
    child.unref();
  } catch {
    /* swallow */
  }
}

async function renderAndOpenWelcome(): Promise<void> {
  const markdown = await resolveWelcomeMarkdown();
  if (markdown === null) {
    console.log(`  ⚠ Welcome plan markdown not found, skipping`);
    return;
  }
  let result;
  try {
    result = await renderPlan({
      title: "Welcome to PlanUI",
      markdown,
      plan_id: "welcome",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠ Welcome plan render failed: ${msg}`);
    return;
  }
  console.log(`  ✓ Welcome plan rendered: ${result.url}`);
  console.log("Opening welcome plan...");
  openInBrowser(result.url);
}

async function clearNpxCache(): Promise<number> {
  const npxDir = path.join(HOME, ".npm", "_npx");
  let cleared = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(npxDir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const pkgJsonPath = path.join(npxDir, entry, "node_modules", "@prathamux", "planui", "package.json");
    try {
      await fs.access(pkgJsonPath);
    } catch {
      continue;
    }
    try {
      await fs.rm(path.join(npxDir, entry), { recursive: true, force: true });
      cleared++;
    } catch {
      // best-effort
    }
  }
  return cleared;
}

async function unregisterMcpServer(): Promise<boolean> {
  const cfg = await readJsonOrNull(CLAUDE_JSON);
  if (!cfg?.mcpServers?.planui) return false;
  delete cfg.mcpServers.planui;
  await writeJsonAtomic(CLAUDE_JSON, cfg);
  return true;
}

async function removeSlashCommand(): Promise<boolean> {
  try {
    await fs.unlink(COMMAND_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function runSetup(): Promise<void> {
  await checkEnvironment();
  await registerMcpServer();
  await installSlashCommand();
  await renderAndOpenWelcome();
  console.log("");
  console.log("Done. Restart Claude Code, then type /planui <task> in any chat.");
}

export async function runUpgrade(): Promise<void> {
  console.log("Upgrading PlanUI...");
  console.log(`  ✓ Running v${await getOwnVersion()}`);

  // Re-run setup steps — registerMcpServer and installSlashCommand are
  // already idempotent, so this picks up any command/format changes
  // between versions without duplicating work.
  await registerMcpServer();
  await installSlashCommand();

  // Bust the npx cache so the next MCP cold-start re-downloads from the
  // registry instead of running a stale cached binary.
  const cleared = await clearNpxCache();
  if (cleared > 0) {
    console.log(`  ✓ Cleared ${cleared} stale npx cache entr${cleared === 1 ? "y" : "ies"}`);
  } else {
    console.log(`  • No npx cache entries to clear`);
  }

  console.log("");
  console.log("Done. Restart Claude Code to load the new MCP server.");
}

export async function runUninstall(): Promise<void> {
  console.log("Uninstalling PlanUI...");

  const removedMcp = await unregisterMcpServer();
  console.log(removedMcp
    ? `  ✓ MCP server "planui" removed from ~/.claude.json`
    : `  • MCP server entry not found (already removed)`);

  const removedCmd = await removeSlashCommand();
  console.log(removedCmd
    ? `  ✓ Slash command removed from ~/.claude/commands/planui.md`
    : `  • Slash command file not found`);

  const cleared = await clearNpxCache();
  if (cleared > 0) {
    console.log(`  ✓ Cleared ${cleared} npx cache entr${cleared === 1 ? "y" : "ies"}`);
  }

  console.log("");
  console.log("Done. Your rendered plans at ~/.claude-plans/ were left in place.");
  console.log("To remove them too:  rm -rf ~/.claude-plans");
}

async function getOwnVersion(): Promise<string> {
  try {
    // dist/setup.js → ../package.json
    const pkgPath = path.join(import.meta.dirname, "..", "package.json");
    const raw = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
