# Changelog

All notable changes to this project will be documented in this file. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] — 2026-05-23

### Fixed
- **Open Questions radio/checkbox parser** — relaxed the option-line regex from `\s{2,}-` (requiring indented sub-bullets) to `\s*-` (accepting top-level sibling bullets). Agents reliably emit radios as sibling bullets, not nested ones, so the strict regex was treating each `- ( )` option as its own question with a textarea. The fix accepts both indented and sibling layouts.
- **Slash command brief** — clarified the Open Questions format with an explicit example showing sibling bullets, so agents stop having to guess.

## [0.3.1] — 2026-05-23

### Changed
- README cleanup: removed the "Gotcha" callout about running from inside the planui source repo. It's a contributor-only failure mode; doesn't belong on the npm landing page.
- `planui --help` shortened to the essentials — kept the `@latest` install tip, dropped the cwd warning.

## [0.3.0] — 2026-05-23

### Added
- **`planui upgrade` command** — pulls the newest published version, re-runs idempotent setup, and clears the npx cache so Claude Code's MCP cold-start picks up the new binary on next restart. Run as `npx -y @prathamux/planui@latest upgrade`.
- **`planui uninstall` command** — removes the `planui` MCP entry from `~/.claude.json`, deletes `~/.claude/commands/planui.md`, and clears the npx cache. Leaves `~/.claude-plans/` (your rendered plans) untouched; full nuke is a manual `rm -rf`.
- **CLI `--help` text expanded** to document all three lifecycle commands, the importance of the `@latest` suffix, and the cwd footgun (running `npx @prathamux/planui …` from inside the planui source repo triggers npx's local-package resolution and fails with `command not found`).

### Changed
- README "Install" section restructured to cover install + upgrade + uninstall as a single three-command block, with the cwd gotcha called out.

## [0.2.0] — 2026-05-23

### Added
- **Mermaid passthrough** — ` ```mermaid ` fences in plan markdown now render as themed SVG diagrams. Supports `flowchart`, `sequenceDiagram`, `erDiagram`, `stateDiagram-v2`, and the rest of Mermaid's catalog. Auto-themes to match the active planui theme (dark / midnight / light) and re-renders live when you toggle the settings panel. Loads `mermaid@11.15.0` from jsdelivr only when the page contains at least one diagram; gracefully falls back to raw source if offline.
- New example plan `examples/architecture-with-mermaid.md` demonstrating `flowchart`, `sequenceDiagram`, and `erDiagram` inside a realistic event-driven architecture plan.
- Welcome plan now showcases a small Mermaid `flowchart` so the feature is discoverable on first install.
- Slash command brief (`/planui`) now documents Mermaid usage, includes a `block:compare` example, lists anti-patterns to avoid, and clarifies the mechanic for each `planresponse` action — notably that `fork` spawns one Agent sub-agent per listed step in parallel.
- `mermaid` added to npm keywords.

### Changed
- **Default serif font swapped from EB Garamond → Source Serif 4 (Adobe, SIL OFL 1.1).** Source Serif 4 is screen-optimized at the body sizes PlanUI uses (~14px) and reads cleaner on dark themes than Garamond's print-tuned strokes. Font fallback chain now: `"Source Serif 4", "Source Serif Pro", Charter, "Iowan Old Style", Georgia, ...`. **Note:** the bundled font file grows from 41 KB to 419 KB to cover Source Serif 4's full glyph set.
- README "Live customization" feature bullet updated to reflect the new serif name.

### Fixed
- ER diagram alternating rows previously rendered light-text-on-light-background on dark themes. Switched Mermaid initialization from `theme: 'base'` (where every variable had to be hand-defined) to Mermaid's built-in `theme: 'dark'` / `'default'`, with only `primaryColor`, `lineColor`, and `activationBkgColor` overridden to flow the planui accent through. Fixes legibility for ER, sequence, and class diagrams.

## [0.1.1] — 2026-05-23

- Fix install command and repo URLs.

## [0.1.0] — 2026-05-23

- Initial release.
