export const TRACKER_CSS = `
:root { color-scheme: light; }
html[data-theme="dark"] { --bg: #1f2023; --fg: #eeeff1; --muted: #9a9ca3; --border: #3a3b40; --accent: #7c8bff; --danger: #ff7b72; }
:root { --bg: #fff; --fg: #1c1d21; --muted: #62646b; --border: #d8d9dd; --accent: #4a5bd9; --danger: #c62828; }
body { margin: 0; background: transparent; overflow: hidden; }
.card { box-sizing: border-box; width: 320px; padding: 12px; font: 13px/1.4 system-ui, sans-serif; color: var(--fg); background: var(--bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 6px 24px rgb(0 0 0 / 25%); }
.card.minimized { width: auto; padding: 0; border-radius: 50%; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.timer { display: grid; gap: 8px; }
.elapsed { margin: 0; font: 600 22px/1 ui-monospace, monospace; }
.issue { margin: 0 0 8px; color: var(--muted); }
.problem { margin: 0 0 8px; color: var(--danger); }
.stale, .unresolved { margin: 0 0 8px; padding: 6px 8px; border: 1px solid var(--danger); border-radius: 6px; }
input, select, button { box-sizing: border-box; width: 100%; padding: 6px 8px; font: inherit; color: inherit; background: transparent; border: 1px solid var(--border); border-radius: 6px; }
header button { width: auto; border: 0; }
button { cursor: pointer; background: var(--accent); border-color: var(--accent); color: #fff; }
button.secondary, header button { background: transparent; color: var(--fg); border-color: var(--border); }
button:disabled { cursor: not-allowed; opacity: 0.5; }
button.bubble { width: 44px; height: 44px; padding: 0; border-radius: 50%; }
form { display: grid; gap: 8px; }
label { display: grid; gap: 4px; }
`;
