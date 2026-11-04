# Clockify for Linear

Chrome and Firefox (Manifest V3) extension that shows a small Clockify timer on Linear issue pages and in the toolbar popup. Clockify is the only source of truth for the running timer.

## Behavior

- Open the toolbar popup and paste a Clockify API key. It is validated with `GET /user`, then stored in `chrome.storage.local` under `clockifyApiKey`. The key is never sent to content scripts or pages.
- On `https://linear.app/<workspace>/issue/<KEY-n>` a floating widget (minimizable, follows Linear's theme) offers Start, Stop, Save changes and Discard (with confirmation). Description defaults to the issue key. A project is suggested only when exactly one project matches the code in the title.
- Drafts are per issue (idle) or per running entry, and a periodic refresh never overwrites typing.
- The popup shows the issue of the active Linear tab, or nothing.
- The extension sends entry-addressed updates and deletions after a fresh read. If a write has an uncertain outcome, the affected account stays blocked until you press "Check Clockify".

## Known limits

- Clockify offers no idempotency or compare-and-swap. Another client can change an entry between the preflight read and the write. Stop uses `PUT` with `end` because the documented stop endpoint is user-scoped and could stop a replacement timer.
- The extension does not retry writes, but the browser may retry an HTTP request after a connection reset. In a Chromium test, one failed `PUT` reached the fake server twice.
- Removing a project from a running entry is not supported. Change it in Clockify instead.
- Entries with custom fields or non-regular types are refused for editing and stopping, because the documented PUT semantics for them are not verified.
- The unresolved-operation marker is persisted before dispatch, but there is no automatic crash recovery beyond showing it and requiring a manual re-check.
- The old local history list and the undocumented favorites endpoint were removed. Legacy stored keys (`timerState`, `entries`, `currentLinearIssue`) are ignored, not deleted.
- The Linear title comes from `document.title`; the layout of real Linear pages was not verified.
- The key is stored as plaintext in extension storage. The widget uses an extension-origin iframe to keep its data separate from the Linear page. The page controls the iframe's position, so a compromised page could disguise the controls and trick you into clicking them.

## Development

```sh
npm install
npm run build        # dist/chrome and dist/firefox (classic self-contained background scripts)
npm run format:check
npm run lint         # oxlint with the generic anti-slop plugin in tools/oxlint/anti-slop
npm run typecheck
npm test             # unit tests
npm run test:e2e     # builds, then drives real Chromium with the unpacked extension
```

Load `dist/chrome` as an unpacked Chrome extension, or `dist/firefox` via `about:debugging` (Gecko ID `clockify-for-linear@and-solution.de`).

## End-to-end tests

`tests/e2e/chromium.test.ts` launches Chromium (path in `CHROME_BIN`, default the Playwright cache) with the built extension. All traffic goes through a local proxy that only reaches an in-process TLS fake serving `linear.app` and `api.clockify.me` with a synthetic key; other hosts are refused. Real Clockify is never contacted and no real credentials are used.

**Firefox is not covered by automated tests.** The Firefox build exists and the manifest uses `background.scripts`, but it has not been loaded in a browser in this repository's test suite.
