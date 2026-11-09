# Clockify for Linear

<p align="center">
  <img src="public/icons/icon128.png" alt="Clockify for Linear logo" width="128" height="128">
</p>

A Chrome and Firefox extension that shows your Clockify timer on Linear issue pages and in the toolbar popup. Clockify is the source of truth for the running timer. The Firefox build requires Firefox 140 or newer on desktop and 142 or newer on Android.

## Getting started

Download the files from the [latest release](https://github.com/WoH/clockify-for-linear/releases/latest).

### Chrome

1. Download `clockify-for-linear-<version>-chrome.zip` and unzip it into a folder you will keep.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the unzipped folder.

Chrome allows the signed `.crx` only on Linux, and only for self-hosted installs. On other systems, use the zip.

### Firefox

1. Download `clockify-for-linear-<version>-firefox.xpi`. Mozilla signed it, so regular Firefox accepts it.
2. Open `about:addons`, select the gear icon, choose **Install Add-on From File**, and pick the `.xpi`. You can also drag the file into the Firefox window.

Do not use the Firefox zip: it is unsigned.

### Set your API key

Open the extension's toolbar popup and enter your Clockify API key. You can find the key in [Clockify settings](https://clockify.me/user/settings). Then open a Linear issue.

The extension requests access to Linear and Clockify. The extension has no automatic updates: to upgrade, install the new release. An unpacked Chrome install has its own storage and may ask for the key again.

To build from source, see [Development](#development).

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
- The extension sends your Clockify API key, account and project identifiers, and timer descriptions to Clockify. A timer description can contain a Linear issue identifier or text you enter. The extension reads the current Linear issue and its title to suggest a description and project.

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

Pushing a tag `vX.Y.Z` runs the full check suite in both browsers, builds both zips, signs the Chrome CRX, gets the signed Firefox XPI from Mozilla, and only then creates a **published** GitHub release with all four assets. There is no draft release. Pull request checks never sign or publish, and CI uses throwaway keys only.

1. Bump `version` in `package.json` and `package-lock.json`, merge, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
2. If the run fails with "awaiting review", wait for Mozilla's approval email and then follow Recovery.

The workflow fails before building if the tag is not `v` plus the `package.json` version, if the tag is not the checked-out commit on `main`, or if a release for the tag already exists, so published assets are never overwritten. Locally, `npm run package` writes the zips to `release/`. Each has `manifest.json` at its root, and the script checks this.

**Firefox signing and AMO state.** Mozilla is the authority on whether a version was submitted. Before anything else the workflow asks the authenticated Mozilla v5 API (`scripts/amo.ts`) about the version:

- **Absent:** the tag run submits the build with `web-ext sign --channel=unlisted` and the tagged source archive. The tagged source goes to Mozilla reviewers. It waits up to 20 minutes.
- **Pending:** nothing is submitted or released. The run fails. Mozilla may defer signing for manual review.
- **Approved:** the signed XPI is fetched from Mozilla, never resubmitted.
- **Anything else** (duplicate versions, listed channel, disabled file, malformed or unreachable API): the run fails closed.

Every XPI, whether returned by `web-ext` or downloaded, is checked by `scripts/verify-firefox-xpi.ts`. It rejects duplicate paths, extra or missing files, and any file that differs from `dist/firefox` (the `META-INF` signature files are excluded). Downloads also must match the SHA-256 that Mozilla reports. Before publishing, Firefox must reject an unsigned control and accept the signed XPI with signature enforcement enabled. The API client sends the JWT only to the Mozilla API origin, never follows redirects automatically, refuses redirects outside Mozilla's origin and CDN, and retries only transient failures of read-only requests. Submission is never retried by the workflow, and runs for one tag are serialized by a concurrency group. The tagged workflow uses the `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` secrets in the XPI step only. The add-on is not listed on AMO.

**Recovery after a pending review.** When Mozilla approves the version, open **Actions > Release > Run workflow** and select the same tag `vX.Y.Z` as the ref (not a branch). By default, this run rebuilds the tag, signs the CRX, and downloads and verifies the approved XPI without submitting it again. If the version is still pending or absent, nothing is released. A GitHub rerun also uses this recovery mode.

If a run failed before submitting and the AMO developer dashboard confirms that Mozilla has no submission for the version, select **Allow submission only after checking Mozilla has no version** when starting the workflow. Do not select it when the earlier submission's outcome is unknown. Never re-tag the same version: a fix needs a new version.

If release verification itself needs a fix after tagging, merge the fix to `main` and run **Recover signed release** from `main` with the existing tag. It rebuilds and tests the tagged source, downloads the approved XPI without resubmitting it, verifies both packages, and publishes the release.

**Publishing is automatic.** `gh release create` stages assets in a temporary draft and publishes the release after uploading them. The workflow checks that the published release has four assets. An interrupted run may leave a draft that needs attention. Check the release and Mozilla dashboard before retrying; keep the tag and use the recovery workflow to download an already approved XPI rather than resubmit it.

**Chrome and keys.** The release includes a signed `.crx` for self-hosted Linux distribution and a zip that you can load with **Load unpacked** in `chrome://extensions`. Chrome restricts off-store installation on other platforms. The CRX uses the `CHROME_CRX_PRIVATE_KEY` secret and the public ID in `tools/chrome-extension-id`, and signing fails if the key does not match that ID. Keep a separate secure backup of the private key: GitHub cannot show it again, and a new key changes the extension ID. A separately loaded unpacked extension may have a different ID and separate storage. The Firefox zip is unsigned, and regular Firefox installs only the signed XPI.

Mozilla reviewers can reproduce the Firefox build on Ubuntu 24.04 x86-64 with Node.js 24. Run `npm ci` followed by `npm run build`; the result is in `dist/firefox`. The extension does not currently provide an automatic Firefox update URL.
