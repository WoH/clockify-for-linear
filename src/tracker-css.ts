export const TRACKER_CSS = `
:root {
  color-scheme: light dark;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --gutter: 8px;
  --font: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
}
html[data-theme="light"] {
  color-scheme: light;
  --surface: #ffffff;
  --field: #f7f8f9;
  --fg: #1c1d22;
  --muted: #5f636b;
  --border: rgb(20 22 30 / 11%);
  --border-strong: rgb(20 22 30 / 20%);
  --hover: rgb(20 22 30 / 5%);
  --accent: #0369a1;
  --accent-hover: #075985;
  --accent-fg: #ffffff;
  --accent-soft: rgb(3 105 161 / 9%);
  --danger: #b42318;
  --danger-soft: rgb(180 35 24 / 7%);
  --warn: #8a4b00;
  --warn-soft: rgb(217 119 6 / 10%);
  --ring: rgb(3 105 161 / 45%);
  --shadow: 0 0 0 1px rgb(20 22 30 / 6%), 0 4px 8px rgb(20 22 30 / 6%), 0 6px 16px -4px rgb(20 22 30 / 14%);
  --chevron: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%235f636b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 4.5 3 3 3-3'/%3E%3C/svg%3E");
}
html[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1c1d22;
  --field: #24252b;
  --fg: #eeeff2;
  --muted: #9c9fa6;
  --border: rgb(255 255 255 / 9%);
  --border-strong: rgb(255 255 255 / 17%);
  --hover: rgb(255 255 255 / 6%);
  --accent: #38bdf8;
  --accent-hover: #7dd3fc;
  --accent-fg: #0b1a24;
  --accent-soft: rgb(56 189 248 / 12%);
  --danger: #ff8a80;
  --danger-soft: rgb(255 138 128 / 10%);
  --warn: #f5c26b;
  --warn-soft: rgb(245 194 107 / 10%);
  --ring: rgb(56 189 248 / 55%);
  --shadow: 0 0 0 1px rgb(0 0 0 / 35%), 0 4px 8px rgb(0 0 0 / 25%), 0 8px 20px -4px rgb(0 0 0 / 45%);
  --chevron: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%239c9fa6' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 4.5 3 3 3-3'/%3E%3C/svg%3E");
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body { font: 13px/1.45 var(--font); color: var(--fg); -webkit-font-smoothing: antialiased; }
html[data-surface="widget"], html[data-surface="widget"] body { height: 100%; overflow: hidden; }
html[data-surface="widget"] body { display: flex; align-items: flex-end; justify-content: flex-end; padding: var(--gutter); }
html[data-surface="popup"] body { width: 340px; background: var(--surface); }

.card { flex: none; display: grid; gap: 12px; width: min(320px, calc(100vw - 2 * var(--gutter))); max-height: calc(100vh - 2 * var(--gutter)); overflow: auto; padding: 14px; color: var(--fg); background: var(--surface); border-radius: 12px; box-shadow: var(--shadow); }
html[data-surface="popup"] .card { width: 100%; max-height: none; padding: 16px; border-radius: 0; box-shadow: none; }
.card.minimized { width: auto; padding: 0; overflow: visible; border-radius: 999px; background: transparent; box-shadow: none; }

.top { display: flex; align-items: flex-start; gap: 8px; min-height: 24px; }
.subject { flex: 1; min-width: 0; display: grid; gap: 2px; }
.brand { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
.brand svg { color: var(--accent); }
.issue { margin: 0; display: flex; gap: 6px; align-items: baseline; min-width: 0; }
.issue-key { flex: none; font: 500 12px/1.4 var(--mono); color: var(--muted); }
.issue-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.icon-button { flex: none; display: inline-grid; place-items: center; width: 24px; height: 24px; margin: -2px -4px 0 0; padding: 0; color: var(--muted); background: transparent; border: 0; border-radius: 6px; }

.clock { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-radius: 10px; background: var(--field); }
.elapsed { margin: 0; font: 600 24px/1 var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.clock.running .elapsed { color: var(--accent); }
.clock.idle .elapsed, .clock.unknown .elapsed { color: var(--muted); }
.state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.dot { display: inline-block; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--border-strong); }
.running .dot { background: var(--accent); animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }

form.fields { display: grid; gap: 8px; margin: 0; }
label { display: grid; gap: 4px; font-size: 12px; font-weight: 500; color: var(--muted); }
input, select { width: 100%; height: 32px; padding: 0 10px; font: 13px var(--font); color: var(--fg); background: var(--field); border: 1px solid var(--border); border-radius: 8px; transition: border-color 150ms ease, background-color 150ms ease; }
input::placeholder { color: var(--muted); opacity: 0.8; }
select { appearance: none; padding-right: 28px; background-image: var(--chevron); background-repeat: no-repeat; background-position: right 10px center; cursor: pointer; }
select option { color: var(--fg); background-color: var(--surface); }
input:disabled, select:disabled { opacity: 0.6; cursor: not-allowed; }

.picker { display: grid; gap: 4px; }
.picker > label { display: block; }
.picker-field { position: relative; display: flex; align-items: center; }
.picker-field input { padding: 0 30px 0 32px; text-overflow: ellipsis; cursor: pointer; }
.picker-field input[aria-expanded="true"] { cursor: text; border-color: var(--accent); }
.picker-leading, .picker-chevron { position: absolute; top: 0; bottom: 0; display: grid; place-items: center; color: var(--muted); }
.picker-leading { left: 10px; width: 14px; pointer-events: none; }
.picker-chevron { right: 4px; width: 24px; cursor: pointer; transition: transform 150ms var(--ease-out); }
.picker-field:has([aria-expanded="true"]) .picker-chevron { transform: rotate(180deg); }
.mark { display: inline-grid; place-items: center; flex: none; width: 14px; height: 14px; color: var(--muted); }
.mark.dot::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: currentColor; }
.picker-panel { display: grid; overflow: hidden; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 8px; transform-origin: top center; transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out); }
@starting-style { .picker-panel { opacity: 0; transform: translateY(-2px) scale(0.98); } }
.picker-panel[hidden] { display: none; }
.picker-note { margin: 0; padding: 6px 10px; font-size: 12px; color: var(--warn); background: var(--warn-soft); border-bottom: 1px solid var(--border); }
.picker-note[hidden] { display: none; }
.picker-list { max-height: 216px; overflow-y: auto; overscroll-behavior: contain; padding: 4px; scrollbar-width: thin; }
.picker-list[hidden] { display: none; }
.picker-group { margin: 0; padding: 6px 8px 2px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: var(--muted); }
.picker-list > div[role="group"] + div[role="group"] { margin-top: 4px; padding-top: 2px; border-top: 1px solid var(--border); }
.picker-option { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 8px; border-radius: 6px; cursor: pointer; }
.picker-option[aria-selected="true"] { background: var(--hover); }
.picker-option.none { color: var(--muted); }
.picker-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-client { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--muted); }
.picker-client::before { content: "• "; }
.picker-check { display: inline-grid; margin-left: auto; padding-left: 4px; color: var(--accent); }
.picker-empty { margin: 0; padding: 10px; font-size: 12.5px; color: var(--muted); }
.picker-empty[hidden] { display: none; }

.actions { display: flex; gap: 8px; align-items: center; }
.actions .grow { flex: 1; }
button { font: 500 13px var(--font); cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms var(--ease-out); }
button:active:not(:disabled) { transform: scale(0.97); }
button:disabled { cursor: not-allowed; opacity: 0.5; }
.primary, .secondary, .ghost { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 8px; white-space: nowrap; }
.primary { color: var(--accent-fg); background: var(--accent); border: 1px solid transparent; }
.secondary { color: var(--fg); background: transparent; border: 1px solid var(--border-strong); }
.ghost { color: var(--muted); background: transparent; border: 1px solid transparent; padding: 0 8px; }
.ghost.danger { color: var(--danger); }
button[aria-busy="true"] { cursor: progress; opacity: 0.75; }

.notice { margin: 0; display: grid; gap: 8px; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; }
.notice p { margin: 0; }
.notice.problem { color: var(--danger); background: var(--danger-soft); }
.notice.warn { color: var(--warn); background: var(--warn-soft); }
.notice.confirm { color: var(--fg); background: var(--danger-soft); }
.notice .actions { justify-content: flex-end; }
.notice .primary.danger { color: #fff; background: #b42318; }
.hint { margin: 0; color: var(--muted); }
.hint a { color: var(--accent); text-underline-offset: 2px; }
.running-dot { display: inline-flex; }
.lead { margin: 0; font-weight: 500; }
.status { min-height: 0; margin: 0; font-size: 12px; color: var(--muted); }
.status:empty { display: none; }

.footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
.footer .state .dot { background: #16a34a; }

.bubble { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; min-width: 44px; padding: 0 12px; color: var(--muted); background: var(--surface); border: 0; border-radius: 999px; box-shadow: var(--shadow); }
.bubble.running { padding: 0 14px 0 12px; color: var(--fg); }
.bubble .elapsed { font-size: 13px; font-weight: 600; color: var(--accent); }
.bubble svg { color: var(--accent); }

:focus { outline: none; }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
input:focus-visible, select:focus-visible { outline-offset: 0; border-color: var(--accent); }

@media (hover: hover) and (pointer: fine) {
  .primary:hover:not(:disabled) { background: var(--accent-hover); }
  .secondary:hover:not(:disabled), .ghost:hover:not(:disabled), .icon-button:hover { background: var(--hover); color: var(--fg); }
  .ghost.danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
  input:hover:not(:disabled):not(:focus), select:hover:not(:disabled):not(:focus) { border-color: var(--border-strong); }
  .bubble:hover { color: var(--fg); }
}
@media (forced-colors: active) {
  .picker-option[aria-selected="true"] { outline: 1px solid Highlight; outline-offset: -1px; }
}
@media (prefers-reduced-motion: reduce) {
  .running .dot { animation: none; }
  button:active:not(:disabled) { transform: none; }
  .picker-panel, .picker-chevron { transition: none; }
}
`;
