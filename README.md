# Clockify for Linear

A Chrome and Firefox extension that shows your Clockify timer on Linear issue pages and in the toolbar popup. Clockify is the source of truth for the running timer.

## Install

1. Install Node.js 24 and run `npm ci`.
2. Run `npm run build`.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**. Choose `dist/chrome`.
4. In Firefox, open `about:debugging`, select **This Firefox**, and load `dist/firefox/manifest.json` as a temporary add-on. Firefox removes temporary add-ons when it exits.
5. Open the extension's toolbar popup and enter your Clockify API key. You can find the key in [Clockify settings](https://clockify.me/user/settings).

The extension requests access to Linear and Clockify. A new unpacked installation has its own storage and may require you to enter the key again. Reload the extension after rebuilding it.

## Behavior

- Open the toolbar popup and paste a Clockify API key. It is validated with `GET /user`, then stored in `chrome.storage.local` under `clockifyApiKey`. The key is never sent to content scripts or pages.
- On `https://linear.app/<workspace>/issue/<KEY-n>` a floating widget (minimizable, follows Linear's theme) offers Start, Stop, Save changes and Discard (with confirmation). Description defaults to the issue key. A project is suggested only when exactly one project matches the code in the title.
- Click the project field and type to search by project or client name. Clockify favorites appear first. Use the arrow keys and Enter to select a project.
- Drafts are per issue when idle or per running entry. A refresh does not overwrite text you are editing.
- An open widget checks Clockify every four seconds while visible. It also refreshes when you return to the page. The interval increases after failed requests.
- The popup shows the issue of the active Linear tab, or nothing.
- The extension sends entry-addressed updates and deletions after a fresh read. If a write has an uncertain outcome, the affected account stays blocked until you press "Check Clockify".

## Known limits

- Clockify offers no idempotency or compare-and-swap. Another client can change an entry between the preflight read and the write. Stop uses `PUT` with `end` because the documented stop endpoint is user-scoped and could stop a replacement timer.
- The extension does not retry writes, but the browser may retry an HTTP request after a connection reset. In a Chromium test, one failed `PUT` reached the fake server twice.
- Removing a project from a running entry is not supported. Change it in Clockify instead.
- Entries with custom fields or non-regular types are refused for editing and stopping, because the documented PUT semantics for them are not verified.
- The unresolved-operation marker is persisted before dispatch, but there is no automatic crash recovery beyond showing it and requiring a manual re-check.
- Clockify favorites use an undocumented endpoint at `app.clockify.me`. The extension sends your API key to that host to load favorites. If that request fails, the project picker lists projects by name and shows a notice.
- The old local history list was removed. Legacy stored keys (`timerState`, `entries`, `currentLinearIssue`) are ignored, not deleted.
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
npm run test:e2e     # builds, then drives real Chromium and Firefox with the built extension
npm run package      # release/*.zip for Chrome and Firefox
```

Load `dist/chrome` as an unpacked Chrome extension, or `dist/firefox` via `about:debugging` (Gecko ID `clockify-for-linear@and-solution.de`).

## End-to-end tests

`tests/e2e/extension.test.ts` is one scenario file that runs against both real browsers with the built extension. `E2E_BROWSER=chromium|firefox` selects the browser, and `tests/e2e/browser.ts` holds the only browser-specific code.

```sh
npx playwright-core install --with-deps chromium firefox   # revisions pinned by the locked playwright-core
npm run build
npm run test:e2e:chromium
npm run test:e2e:firefox
```

Playwright's managed browsers are used. Set `E2E_CHROMIUM_BIN` or `E2E_FIREFOX_BIN` only to override the executable. There is no skip path: if a browser is not installed the run fails.

All traffic goes through a local proxy that only reaches an in-process TLS fake serving `linear.app`, `api.clockify.me`, and `app.clockify.me` with synthetic keys; other hosts are refused. Real Clockify is never contacted and no real credentials are used.

**Firefox mechanics.** Playwright has no Firefox extension API, so `tests/e2e/marionette.ts` installs `dist/firefox` as a temporary add-on over Marionette (`Addon:Install`) in the Playwright-launched Firefox. This relies on Playwright's patched Firefox starting with `-marionette` and listening on the fixed port 2828; the `marionette.port` pref is ignored. The test fails with a clear error if that port is already taken, so run Firefox suites one at a time per machine (CI jobs are isolated). A Playwright upgrade could drop this flag, which would fail the Firefox run loudly. Juggler does not attach to top-level `moz-extension://` pages, so the Firefox popup is tested inside an iframe on a fake Linear page, from a copy of the build whose manifest also lists `popup.html` as web-accessible. The shipped Firefox manifest is unchanged.

Firefox tests inspect extension storage through an extension page. The popup runs in a test-only iframe, so the suite does not verify opening it from the browser toolbar.

## Releases

Pushing a tag `vX.Y.Z` runs the full check suite (both browsers) and then creates a **draft** GitHub release with `clockify-for-linear-X.Y.Z-chrome.zip` and `clockify-for-linear-X.Y.Z-firefox.zip`. The workflow fails if the tag is not `v` plus the `package.json` version (which `scripts/build.ts` writes into both manifests) or if the release already exists, so published assets are never overwritten. Nothing is sent to a browser store.

1. Bump `version` in `package.json` and `package-lock.json`, merge, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
2. Review and publish the draft release.

Locally, `npm run package` writes the archives to `release/`. Each archive has `manifest.json` at its root, and the script checks this.

- **Chrome:** unzip the archive and load the folder with **Load unpacked** in `chrome://extensions` (Developer mode). A `.zip` cannot be installed directly outside the Chrome Web Store.
- **Firefox:** the archive is **unsigned**. Regular Firefox (release and beta) refuses unsigned add-ons; the build only loads as a temporary add-on via `about:debugging`, or in Developer Edition/Nightly/ESR with `xpinstall.signatures.required` set to false. To distribute to normal Firefox users from GitHub, sign the archive as an **unlisted** add-on with Mozilla (`web-ext sign --channel=unlisted`, which needs AMO API credentials) and attach the signed `.xpi`. This repository does not hold those credentials and does not sign.
