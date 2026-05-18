## Summary

Ship PlanUI to npm so users get one terminal command and a `/planui` slash command inside Claude Code. After install, they describe their task in chat (`/planui add stripe webhook handling`), the agent authors a structured plan, calls `render_plan`, and posts back a `file://` URL to a rendered HTML page.

```block:tldr
One-command install. The package bundles the MCP server + a `/planui` slash command. Users run `npx -y planui setup`, restart Claude Code, then type `/planui <task>` in any chat to get a rendered plan back.
```

## Open Questions

1. NPM package name?
   - ( ) `planui` (cleanest if available — must check)
   - ( ) `@planui/mcp` (scoped — always available if I own the `planui` org)
   - ( ) `@prathmesh/planui` (scoped under your personal npm org — fastest path)

2. Install command shape?
   - ( ) `npx -y planui setup` (no global install, idempotent one-shot, my recommendation)
   - ( ) `npm install -g planui` then `planui setup` (two steps, classic)
   - ( ) `npm install -g planui` with a postinstall hook that auto-configures (one step but postinstall has caveats: silently fails if Claude Code isn't installed)

3. Slash command name?
   - ( ) `/planui`
   - ( ) `/plan`
   - ( ) `/draft`

4. After install, should the setup script open the first sample plan in the browser automatically, or stay silent and just print next steps? Free-text.

## Preconditions

- Repo builds cleanly: `npm install && npm run build` produces working `dist/`
- An npm account exists with publish rights (or an `npm org` for scoped publish)
- All 7 catalog blocks render correctly across themes (verified in `examples/block-catalog.md`)

```block:compare
- npx-only install
  - Zero global state — every run is a fresh download
  - Always latest version
  - First invocation is slow (~5–10s npm cache miss)
  - Works without `sudo` on locked-down machines
- Global install
  - One-time download, every invocation instant
  - Standard `npm` lifecycle (`update`, `uninstall`)
  - Requires write access to global node_modules (sudo on some setups)
  - Version drift: users may run old PlanUI against new Claude Code
```

## Steps

1. **Verify npm name availability** — `npm view planui`; if taken, fall back to the scoped name from Q1.
2. **Polish `package.json`** — set `bin`, `files: ["dist","README.md","LICENSE"]`, `repository`, `homepage`, `keywords`, `engines.node`, and `publishConfig.access: "public"` if scoped.
3. **Build the `setup` subcommand** (depends on 2) — new `src/setup.ts` that uses `claude mcp add planui -- npx -y planui-mcp` (or writes `~/.claude.json` directly), then drops `~/.claude/commands/planui.md`. Idempotent — safe to re-run.
4. **Ship the slash command** — `src/template/commands/planui.md` with frontmatter (`description`, `argument-hint`) and a prompt that teaches the agent to author PlanUI-conformant markdown then call `render_plan`.
5. **Update README** (depends on 4) — three-line quickstart at the top: install, restart, use. Include one screenshot of a rendered plan.
6. **Smoke-test the tarball** (depends on 5) — `npm pack` produces `planui-0.1.0.tgz`; install it in `/tmp/planui-test`, run `planui setup`, restart Claude Code, type `/planui add idempotency to /v2/refresh`, verify a `file://` URL comes back.
7. **Publish** (depends on 6) — `npm publish --access public`; tag `v0.1.0` and push to GitHub.

## Files

- `src/setup.ts` — new (~150 lines)
- `src/template/commands/planui.md` — new (~30 lines, ships with the package)
- `package.json` — updated (bin, files, repository, publishConfig)
- `README.md` — updated (install snippet, usage)

## Risks

- npm name `planui` is already taken [med] — fall back to `@planui/mcp` or `@prathmesh/planui`; UX stays identical, only the install command string changes.
- Claude Code's config schema (`~/.claude.json`) changes [low] — pin to current schema; ship a `planui doctor` command later for diagnostics if it breaks.
- Windows path differences [med] — `~/.claude/commands/` resolves differently on Windows; setup script must use `os.homedir()` + `path.join`, never hard-coded `/`.
- Users skip the "restart Claude Code" step [low] — setup script prints this prominently; first `/planui` invocation will silently 404 if they don't restart.
- npm publish is essentially permanent [high] — once `0.1.0` is published, that version can't be re-published with different bits. Bump versions for any fix. Use `npm pack` + manual install for testing before `npm publish`.

```block:callout
[!warn] `npm publish` is one-way. Do step 6 thoroughly — install the local tarball end-to-end before publishing. Once `0.1.0` is out, the next iteration must be `0.1.1`.
```

## Stack Changes

- + npm package `planui` (or scoped equivalent)
- + 3 bins: `planui` (CLI), `planui-mcp` (server), `planui-setup` (installer) — or one bin with subcommands
- + One file written at setup time: `~/.claude/commands/planui.md`
- + One entry written at setup time: `mcpServers.planui` in `~/.claude.json` (via `claude mcp add`)

## The end-user flow

```block:sequence
1. npx -y planui setup
2. Restart Claude Code
3. Type /planui <task>
4. Open the file:// URL
5. Approve / Modify / Fork
```

## What `/planui <task>` does behind the scenes

```block:layers
1. Slash command captures `$ARGUMENTS` — the user's task description.
2. Slash command's prompt expands the brief into a PlanUI-conformant markdown plan (Summary, Open Questions, Steps, Risks, etc., with catalog blocks where structure earns it).
3. The agent calls `render_plan({title, markdown})` over MCP.
4. The agent's chat response is one line — the `file://` URL. The user opens it.
```

## Sizing

```block:metric
- **~150** — lines of new code for `setup.ts`
- **~30** — lines for the slash command markdown
- **0** — new runtime dependencies
- **5** — install steps the user sees (1 command + 1 restart + 3 chat interactions to verify)
```

## Rollback Plan

If a published version breaks for users:

1. Publish a fixed patch version immediately (`0.1.1`).
2. Mark the broken version deprecated: `npm deprecate planui@0.1.0 "broken, use 0.1.1"`.
3. Update the README install snippet to pin the working version if needed.
4. Add a `planui doctor` command in the next minor release that detects misconfiguration and suggests fixes.

`npm unpublish` is allowed within 72 hours of publish but is strongly discouraged — prefer deprecate + patch.
