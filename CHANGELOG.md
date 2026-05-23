# Changelog

All notable changes to this project will be documented in this file. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
