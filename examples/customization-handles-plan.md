## Summary

Live customization handles on every rendered plan: theme, font, primary color. Per-plan changes stay in localStorage; "Save as default" writes a `prefspersist` token that the agent persists to `~/.claude-plans/preferences.json`.

## Open Questions

1. UI placement of the controls?
   - ( ) Gear icon + dropdown in the page header, right of View Raw (compact, default)
   - ( ) Inline segmented controls in the header (always visible, more chrome)
   - ( ) A "Settings" segment inside the floating action bar
2. What does "white" primary color mean exactly?
   - ( ) Truly white accent on dark themes (monochrome / Linear-ish look)
   - ( ) Neutral — mutes the primary CTA to a surface tone, no color accent anywhere
3. How should "Save as default" persist back to MCP?
   - ( ) Paste-back `prefspersist` token (consistent with approve / modify / parallel)
   - ( ) Local HTTP listener on the MCP server (one-click, but adds a daemon and a port)
4. Should the prefs file be scoped per-project (`./.planui-prefs.json`) or user-global (`~/.claude-plans/preferences.json`)?
   - ( ) User-global (my recommendation — preferences are taste, not project state)
   - ( ) Per-project (lets teams pin a theme)
   - ( ) Both, with per-project overriding user-global when present

## Preconditions

- All colors and fonts already use CSS custom properties on `:root` (`--bg`, `--surface`, `--accent`, `--font-sans`, etc.) — themeability is one refactor away.
- The clipboard `planresponse` token pattern (approve / modify / answers / parallel) is established and stable.
- No theme switcher or settings UI exists yet — clean greenfield.

## Steps

1. **Refactor `:root` into theme blocks** — split current variable values into `[data-theme="dark"]` (current default), `[data-theme="midnight"]` (deeper neutrals, higher contrast), and `[data-theme="light"]` (light bg, dark text) selectors on `<html>`.
2. **Add font-family option blocks** — `[data-font="sans"]` (current), `[data-font="serif"]` (Georgia / system serif), `[data-font="mono"]` (full mono mode). Each flips `--font-sans`. `--font-mono` stays unchanged so code spans stay readable.
3. **Add primary-color option blocks** — `[data-color="blue|green|purple|white"]` overrides `--accent`, `--accent-hover`, and `--accent-dim`. Default stays blue.
4. **Build the settings dropdown UI** — gear icon `⚙` in the header meta row, right of the `View Raw` button. Click opens a small floating panel with three labeled radio groups (theme / font / color) and a "Save as default" action at the bottom. Vanilla HTML + CSS, no new deps.
5. **localStorage persistence** — write `{theme, font, color}` to `localStorage["planui:prefs"]` on change. Read and apply on load. This is per-browser, per-`file://` origin; behavior varies across browsers.
6. **MCP preferences read** — `src/server.ts` reads `~/.claude-plans/preferences.json` (create-on-demand). When rendering, inject the JSON as `<script>window.__PLANUI_DEFAULTS = {...}</script>` in the HTML template.
7. **Apply order at page load** (depends on 6) — CSS defaults → `window.__PLANUI_DEFAULTS` → localStorage. Each layer overrides the previous. This way: hard-coded defaults are the floor, MCP defaults are the user's global preference, localStorage is the per-plan tweak.
8. **"Save as default" action** (depends on 7) — button at bottom of the dropdown. Copies a `prefspersist {theme, font, color}` token. User pastes; agent recognizes; agent writes the JSON values to `~/.claude-plans/preferences.json` (or per-project per Q4). Next render bakes the new defaults in.
9. **Update `render_plan` tool description** — document the new `prefspersist` action so the agent knows how to handle it, plus a one-line note that every rendered HTML has user-tweakable handles (so the agent doesn't try to do the customization itself by passing colors in the markdown).

## Risks

- **localStorage behavior on `file://` origins varies by browser** [low] — Chrome/Edge: shared null origin (cross-plan persistence works). Safari: per-file origin (each plan independent). Firefox: somewhere between. Mitigation: rely on MCP-baked defaults as the source of truth across plans; localStorage stays the per-plan layer only.
- **Light theme breaks the floating bar's backdrop-blur contrast** [low] — current bar has a dark translucent bg with blur; on a light bg it'd look wrong. Mitigation: bar bg becomes a CSS variable like `--bar-bg` with per-theme values.
- **Mono font hurts readability for long prose** (notes, descriptions) [med] — mono is dense and tiring at body sizes. Mitigation: keep mono as an opt-in handle, not a default; flag in the tool description so agents don't recommend it for long plans.
- **Handle creep** [med] — once handles exist, every new request ("can we add line-height?", "can we change spacing?") becomes a request to add another handle. Mitigation: lock the v1 handle set at exactly **3** (theme / font / color); new handles require a separate plan.

## Stack Changes

- + `~/.claude-plans/preferences.json` (small JSON; server-read, agent-written via `prefspersist`)
- + Settings dropdown in `template.html` (~40 lines)
- + Theme / font / color CSS variable blocks in `styles.css` (~120 lines)
- + Settings JS in `actions.js` (~80 lines)
- + One new `planresponse` action `prefspersist` (agent updates the prefs file)
- + One MCP tool change: `render_plan` reads prefs and injects defaults into the HTML
- No new npm dependencies

## Persistence model — the full picture

Three layers, lowest precedence to highest:

1. **Hard-coded CSS defaults** — what ships in the template (current dark + blue + sans). Always present, always at the bottom of the stack.
2. **MCP-saved preferences** in `~/.claude-plans/preferences.json` — baked into every rendered HTML as `window.__PLANUI_DEFAULTS`. Survives across plans, sessions, and machines (if the file syncs via dotfiles). This is the user's global preference.
3. **Browser localStorage** — per-browser, per-plan overrides. Lets you tweak within a plan without losing your global default. Stays sticky as long as the browser keeps the storage.

**Load sequence** when the HTML opens: defaults applied first → `window.__PLANUI_DEFAULTS` from server applied on top → localStorage applied last (highest priority). User changes write to localStorage immediately. Clicking "Save as default" promotes the current state back up to layer 2 via the `prefspersist` clipboard token.

This gives a clean separation between **taste preference** (the global default I want for every plan) and **per-plan tweak** (let me try mono for this one).

## What this does NOT change

- The schema (sections / questions / steps / risks) — unchanged.
- The `planresponse` action grammar — we **add** `prefspersist`; existing actions (approve / modify / answers / parallel) stay identical.
- The render pipeline — adds one read of `preferences.json` at the start; no other rendering changes.
- The agent's job — it still authors markdown plans. It doesn't pick the theme; the user does.
