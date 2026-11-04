import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { chromium } from "playwright-core";

import { FakeWorld, SECOND_KEY, SYNTHETIC_KEY } from "./fake-world.ts";

import type { BrowserContext, FrameLocator, Page, Worker } from "playwright-core";

const EXTENSION_DIR = join(import.meta.dirname, "../../dist/chrome");

const CHROME =
  process.env["CHROME_BIN"] ?? "/home/woh/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";

const ISSUE_URL = "https://linear.app/acme/issue/ENG-1/first";

const world = new FakeWorld();
const profile = mkdtempSync(join(tmpdir(), "clockify-for-linear-profile-"));
let context: BrowserContext;
let extensionId = "";

async function launch(): Promise<void> {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      `--proxy-server=http://${world.proxyUrl}`,
      "--ignore-certificate-errors",
    ],
  });

  context.setDefaultTimeout(5_000);

  const worker: Worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

  extensionId = new URL(worker.url()).host;
}

function widget(page: Page): FrameLocator {
  return page.frameLocator("#clockify-for-linear-host");
}

async function popup(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  return page;
}

async function connect(page: Page): Promise<void> {
  await page.getByTestId("api-key").fill(SYNTHETIC_KEY);
  await page.getByTestId("connect").click();
  await page.getByTestId("start").waitFor();
}

async function storedKey(): Promise<string | undefined> {
  const worker = context.serviceWorkers()[0];
  assert.ok(worker);
  const stored = await worker.evaluate(() => chrome.storage.local.get("clockifyApiKey"));

  const key = stored["clockifyApiKey"];

  return key === undefined ? undefined : String(key);
}

before(async () => {
  await world.start();
  await launch();
});

async function connectedAs(key: string): Promise<void> {
  const worker = context.serviceWorkers()[0];
  assert.ok(worker);
  const page = await popup();
  const disconnect = page.getByTestId("disconnect");

  if (await disconnect.isVisible({ timeout: 1000 }).catch(() => false)) await disconnect.click();
  await page.getByTestId("api-key").fill(key);
  await page.getByTestId("connect").click();
  await page.getByTestId("start").waitFor();
  await page.close();
}

beforeEach(async () => {
  const stored = await storedKey();

  if (stored !== SYNTHETIC_KEY) await connectedAs(SYNTHETIC_KEY);

  world.entries = [];
  world.clearFaults();
  await context
    .serviceWorkers()[0]
    ?.evaluate(() => chrome.storage.local.remove("unresolvedOperations"));
});

after(async () => {
  await context.close();
  world.stop();
  rmSync(profile, { recursive: true, force: true });
});

test("an invalid key is rejected and not stored", async () => {
  await context.serviceWorkers()[0]?.evaluate(() => chrome.storage.local.clear());
  const page = await popup();
  await page.getByTestId("api-key").fill("not-the-synthetic-key");
  await page.getByTestId("connect").click();
  await page.getByTestId("problem").waitFor();
  assert.match(await page.getByTestId("problem").innerText(), /rejected the API key/u);
  assert.equal(await storedKey(), undefined);
  await page.close();
});

test("connecting stores the key under clockifyApiKey and keeps it away from pages", async () => {
  await context.serviceWorkers()[0]?.evaluate(() => chrome.storage.local.clear());
  const page = await popup();
  await connect(page);
  assert.equal(await storedKey(), SYNTHETIC_KEY);
  assert.equal(await page.content().then((html) => html.includes(SYNTHETIC_KEY)), false);
  await page.close();
});

test("the widget follows Linear navigation and hides off issue pages", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("issue").waitFor();
  assert.match(await widget(page).getByTestId("issue").innerText(), /ENG-1 First issue/u);
  await page.locator("#go-eng-2").click();
  await widget(page).getByText("ENG-2 AU1002440: Second issue").waitFor();
  assert.equal(await widget(page).getByTestId("description").inputValue(), "ENG-2");
  assert.equal(await widget(page).getByTestId("project").inputValue(), "proj-au");
  await page.locator("#go-inbox").click();
  await page.locator("#clockify-for-linear-host").waitFor({ state: "hidden" });
  await page.close();
});

test("start, an unconfirmed stop, then a successful stop", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").click();
  await widget(page).getByTestId("stop").waitFor();
  assert.equal(world.entries.length, 1);
  assert.equal(world.entries[0]?.description, "ENG-1");

  world.failNext({
    method: "PUT",
    pathPattern: /time-entries/u,
    status: "drop",
    applyWrite: false,
    times: 2,
  });
  await widget(page).getByTestId("stop").click();
  await widget(page).getByTestId("unresolved").waitFor();
  assert.equal(world.entries[0]?.timeInterval.end, null);
  assert.equal(await widget(page).getByTestId("stop").isDisabled(), true);
  const putsBeforeRecheck = world.mutations().filter((request) => request.method === "PUT").length;

  await widget(page).getByTestId("recheck").click();
  await widget(page).getByTestId("unresolved").waitFor({ state: "detached" });
  await widget(page).getByTestId("stop").click();
  await widget(page).getByTestId("start").waitFor();
  assert.notEqual(world.entries[0]?.timeInterval.end, null);
  assert.equal(
    world.mutations().filter((request) => request.method === "PUT").length,
    putsBeforeRecheck + 1,
  );
  await page.close();
});

test("a stop that reached Clockify before the connection dropped is reconciled, not replayed", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").click();
  await widget(page).getByTestId("stop").waitFor();
  const puts = () => world.mutations().filter((request) => request.method === "PUT").length;
  const before = puts();
  world.failNext({
    method: "PUT",
    pathPattern: /time-entries/u,
    status: "drop",
    applyWrite: true,
    times: 2,
  });
  await widget(page).getByTestId("stop").click();
  await widget(page).getByTestId("unresolved").waitFor();
  const dispatched = puts();
  // Chromium's network stack replays a PUT once when the connection is reset; the extension itself sends one.
  assert.equal(dispatched - before, 2);
  await widget(page).getByTestId("recheck").click();
  await widget(page).getByTestId("start").waitFor();
  assert.equal(puts(), dispatched);
  assert.notEqual(world.entries.at(-1)?.timeInterval.end, null);
  await page.close();
});

test("a timer stopped elsewhere is never stopped again by a stale Stop", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").click();
  await widget(page).getByTestId("stop").waitFor();
  const original = world.entries.find((entry) => entry.timeInterval.end === null);
  assert.ok(original);
  original.timeInterval.end = new Date().toISOString();
  const replacement = world.seedRunning("Started on another device", null);
  const before = world.mutations().length;
  await widget(page).getByTestId("stop").click();
  await widget(page).getByText("running timer changed").waitFor();
  assert.equal(world.mutations().length, before);
  assert.equal(replacement.timeInterval.end, null);
  replacement.timeInterval.end = new Date().toISOString();
  await page.close();
});

test("editing keeps untouched fields and Clockify's project-clear contract is not assumed", async () => {
  const running = world.seedRunning("manual", "proj-other");
  running.billable = true;
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("stop").waitFor();
  const before = world.mutations().length;
  await widget(page).getByTestId("project").selectOption("");
  await widget(page).getByTestId("save").click();
  await widget(page).getByTestId("problem").waitFor();
  assert.match(
    await widget(page).getByTestId("problem").innerText(),
    /Removing a project is not supported/u,
  );
  assert.equal(world.mutations().length, before);
  assert.equal(running.projectId, "proj-other");
  await widget(page).getByTestId("project").selectOption("proj-au");
  await widget(page).getByTestId("description").fill("renamed");
  await widget(page).getByTestId("save").click();
  await widget(page).getByTestId("problem").waitFor({ state: "detached" });
  assert.equal(running.description, "renamed");
  assert.equal(running.projectId, "proj-au");
  assert.equal(running.billable, true);
  running.timeInterval.end = new Date().toISOString();
  await page.close();
});

test("a passive refresh never clears an unresolved write; only an explicit check does", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").click();
  await widget(page).getByTestId("stop").waitFor();
  world.failNext({
    method: "PUT",
    pathPattern: /time-entries/u,
    status: "drop",
    applyWrite: false,
    times: 2,
  });
  await widget(page).getByTestId("stop").click();
  await widget(page).getByTestId("unresolved").waitFor();
  const other = await popup();
  await other.getByTestId("unresolved").waitFor();
  await other.reload();
  await other.getByTestId("unresolved").waitFor();
  await other.close();
  const puts = () => world.mutations().filter((request) => request.method === "PUT").length;
  const before = puts();
  assert.equal(await widget(page).getByTestId("stop").isDisabled(), true);
  await widget(page).getByTestId("recheck").click();
  await widget(page).getByTestId("unresolved").waitFor({ state: "detached" });
  assert.equal(puts(), before);
  await widget(page).getByTestId("stop").click();
  await widget(page).getByTestId("start").waitFor();
  await page.close();
});

async function waitUntil(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("condition not reached in time");
}

async function clockedPopup(): Promise<Page> {
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  return page;
}

test("a refreshed view keeps its baseline: untouched fields merge, stale edits conflict", async () => {
  const running = world.seedRunning("original", "proj-other");
  const first = await context.newPage();
  await first.goto(ISSUE_URL);
  await widget(first).getByTestId("stop").waitFor();
  const second = await clockedPopup();
  await second.getByTestId("stop").waitFor();

  await widget(first).getByTestId("description").fill("newer description");
  await widget(first).getByTestId("save").click();
  await waitUntil(() => running.description === "newer description");
  await second.getByTestId("project").selectOption("proj-au");
  await second.clock.fastForward(31_000);
  await waitUntil(
    async () => (await second.getByTestId("description").inputValue()) === "newer description",
  );
  await second.getByTestId("save").click();
  await waitUntil(() => running.projectId === "proj-au");
  assert.equal(running.description, "newer description");
  assert.equal(running.projectId, "proj-au");

  await second.getByTestId("description").fill("mine");
  await first.reload();
  await widget(first).getByTestId("description").fill("theirs");
  await widget(first).getByTestId("save").click();
  await waitUntil(() => running.description === "theirs");
  await second.clock.fastForward(31_000);
  await second.waitForTimeout(500);
  const before = world.mutations().length;
  await second.getByTestId("save").click();
  await second.getByTestId("problem").waitFor();
  assert.match(await second.getByTestId("problem").innerText(), /edited in Clockify/u);
  assert.equal(world.mutations().length, before);
  assert.equal(running.description, "theirs");
  running.timeInterval.end = new Date().toISOString();
  await first.close();
  await second.close();
});

test("main-world page scripts can neither read the widget's data nor change its drafts", async () => {
  const running = world.seedRunning("private description", "proj-other");
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("stop").waitFor();
  const before = world.mutations().length;

  const view = await page.evaluate(async () => {
    const host = document.querySelector<HTMLIFrameElement>("#clockify-for-linear-host");
    let contentDocument = "unreadable";

    try {
      contentDocument = host?.contentDocument === null ? "null" : "readable";
    } catch {
      contentDocument = "threw";
    }

    host?.contentWindow?.postMessage(
      { issue: { workspace: "x", identifier: "EVIL-1", title: "evil" }, theme: "dark" },
      "*",
    );
    host?.contentWindow?.postMessage({ type: "state", description: "tampered" }, "*");
    host?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 700));

    return {
      tag: host?.tagName,
      shadowRoot: host?.shadowRoot === null ? "none" : "present",
      contentDocument,
      pageHtmlLeaks: document.documentElement.outerHTML.includes("private description"),
      pageTextLeaks: document.body.innerText.includes("private description"),
    };
  });

  assert.equal(view.tag, "IFRAME");
  assert.equal(view.shadowRoot, "none");
  assert.notEqual(view.contentDocument, "readable");
  assert.equal(view.pageHtmlLeaks, false);
  assert.equal(view.pageTextLeaks, false);
  assert.match(await widget(page).getByTestId("issue").innerText(), /ENG-1/u);
  assert.equal(await widget(page).getByTestId("description").inputValue(), "private description");
  assert.equal(world.mutations().length, before);
  await widget(page).getByTestId("description").fill("typed by the user");
  await widget(page).getByTestId("save").click();
  await waitUntil(() => running.description === "typed by the user");
  assert.equal(world.mutations().length, before + 1);
  assert.equal(running.timeInterval.end, null);
  running.timeInterval.end = new Date().toISOString();
  await page.close();
});

test("the widget frame is the only page-facing extension surface and the key never reaches the page", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").waitFor();
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  assert.equal(html.includes(SYNTHETIC_KEY), false);
  const frames = page.frames().filter((frame) => frame.url().startsWith("chrome-extension://"));
  assert.equal(frames.length, 1);
  assert.equal(new URL(frames[0]?.url() ?? "").pathname, "/widget.html");

  const rejected = await frames[0]?.evaluate(() =>
    chrome.runtime.sendMessage({ type: "connect", apiKey: "x" }),
  );

  assert.deepEqual(rejected, { rejected: true });
  assert.equal(await storedKey(), SYNTHETIC_KEY);
  await page.close();
});

async function switchAccount(managing: Page, key: string): Promise<void> {
  await managing.getByTestId("disconnect").click();
  await managing.getByTestId("api-key").fill(key);
  await managing.getByTestId("connect").click();
  await managing.getByTestId("description").waitFor();
}

test("an unresolved write stays with its own account and only that account can clear it", async () => {
  await connectedAs(SYNTHETIC_KEY);
  const managing = await popup();
  await managing.getByTestId("start").click();
  await managing.getByTestId("stop").waitFor();
  const puts = () => world.mutations().filter((request) => request.method === "PUT");
  world.failNext({
    method: "PUT",
    pathPattern: /time-entries/u,
    status: 500,
    applyWrite: false,
  });
  const putsBefore = puts().length;
  await managing.getByTestId("stop").click();
  await managing.getByTestId("unresolved").waitFor();
  assert.equal(puts().length - putsBefore, 1);

  await switchAccount(managing, SECOND_KEY);
  assert.equal(await managing.getByTestId("unresolved").count(), 0);
  const accountBEntries = world.entries.filter((entry) => entry.userId === "user-2").length;
  await managing.getByTestId("start").click();
  await managing.getByTestId("stop").waitFor();
  assert.equal(
    world.entries.filter((entry) => entry.userId === "user-2").length,
    accountBEntries + 1,
  );
  await managing.getByTestId("stop").click();
  await managing.getByTestId("start").waitFor();
  const putsAfterB = puts().length;
  assert.equal(putsAfterB - putsBefore, 2);

  const staleAck = await managing.evaluate(() =>
    chrome.runtime.sendMessage({ type: "acknowledge", accountId: "ws-1/user-1" }),
  );

  assert.equal(staleAck.error.kind, "conflict");

  await switchAccount(managing, SYNTHETIC_KEY);
  await managing.getByTestId("unresolved").waitFor();
  assert.equal(await managing.getByTestId("stop").isDisabled(), true);
  await managing.getByTestId("recheck").click();
  await managing.getByTestId("unresolved").waitFor({ state: "detached" });
  assert.equal(puts().length, putsAfterB);
  await managing.getByTestId("stop").click();
  await managing.getByTestId("start").waitFor();
  assert.equal(puts().length, putsAfterB + 1);
  await managing.close();
});

test("a view of one account cannot write into a newly connected account", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").waitFor();
  await widget(page).getByTestId("description").fill("account A draft");
  const managing = await popup();
  await switchAccount(managing, SECOND_KEY);
  const before = world.mutations().length;
  await widget(page).getByTestId("start").click();
  await widget(page).getByTestId("problem").waitFor();
  assert.match(await widget(page).getByTestId("problem").innerText(), /account changed/u);
  assert.equal(world.mutations().length, before);
  assert.equal(
    world.entries.some((entry) => entry.userId === "user-2" && entry.timeInterval.end === null),
    false,
  );
  await switchAccount(managing, SYNTHETIC_KEY);
  await managing.close();
  await page.close();
});

test("a disconnect during a write waits for it, so the write stays on its own account", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").waitFor();
  const managing = await popup();
  await managing.getByTestId("disconnect").waitFor();
  world.failNext({
    method: "GET",
    pathPattern: /time-entries/u,
    status: 200,
    applyWrite: true,
    delayMs: 800,
  });
  const posts = () => world.mutations().filter((request) => request.method === "POST");
  const before = posts().length;
  await widget(page).getByTestId("start").click();
  await managing.getByTestId("disconnect").click();
  await managing.getByTestId("connect").waitFor();
  assert.equal(posts().length - before, 1);
  assert.equal(posts().at(-1)?.apiKey, SYNTHETIC_KEY);
  assert.equal(await storedKey(), undefined);
  await managing.getByTestId("api-key").fill(SYNTHETIC_KEY);
  await managing.getByTestId("connect").click();
  await managing.getByTestId("stop").waitFor();
  const running = world.entries.find((entry) => entry.timeInterval.end === null);
  assert.ok(running);
  running.timeInterval.end = new Date().toISOString();
  await managing.close();
  await page.close();
});

test("discard asks for confirmation before deleting", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").click();
  await widget(page).getByTestId("discard").click();
  assert.equal(
    world.entries.some((entry) => entry.timeInterval.end === null),
    true,
  );
  await widget(page).getByTestId("discard-cancel").click();
  await widget(page).getByTestId("discard").click();
  await widget(page).getByTestId("discard-confirm").click();
  await widget(page).getByTestId("start").waitFor();
  assert.equal(
    world.entries.some((entry) => entry.timeInterval.end === null),
    false,
  );
  await page.close();
});

test("an outage keeps the last known timer and disables writes", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").click();
  await widget(page).getByTestId("stop").waitFor();
  world.failNext({ method: "GET", pathPattern: /time-entries/u, status: 503, applyWrite: false });
  await page.evaluate(() => undefined);
  await widget(page).getByTestId("minimize").click();
  await widget(page).getByTestId("expand").click();
  world.failNext({ method: "GET", pathPattern: /time-entries/u, status: 503, applyWrite: false });
  await widget(page).getByTestId("stop").click();
  await widget(page).getByTestId("problem").waitFor();
  assert.equal(await widget(page).getByTestId("stop").count(), 1);
  assert.equal(
    world.entries.some((entry) => entry.timeInterval.end === null),
    true,
  );
  await page.close();
});

test("the key survives a browser restart and nothing leaves the fake network", async () => {
  await context.close();
  await launch();
  assert.equal(await storedKey(), SYNTHETIC_KEY);
  assert.deepEqual(
    world.blockedConnections.filter((target) => /clockify|linear/u.test(target)),
    [],
  );
  assert.ok(
    world.requests.every(
      (request) =>
        request.apiKey === SYNTHETIC_KEY ||
        request.apiKey === SECOND_KEY ||
        request.path.includes("/user"),
    ),
  );
});

test("a draft typed under one account is never reused by the next connected account", async () => {
  const managing = await popup();
  await managing.getByTestId("description").fill("account A private draft");
  await switchAccount(managing, SECOND_KEY);
  assert.equal(await managing.getByTestId("description").inputValue(), "");
  const posts = () => world.mutations().filter((request) => request.method === "POST");
  const before = posts().length;
  await managing.getByTestId("start").click();
  await managing.getByTestId("stop").waitFor();
  assert.equal(posts().length - before, 1);
  assert.equal(posts().at(-1)?.apiKey, SECOND_KEY);
  assert.equal(posts().at(-1)?.body?.description, "");
  await managing.getByTestId("stop").click();
  await managing.getByTestId("start").waitFor();
  await switchAccount(managing, SYNTHETIC_KEY);
  await managing.close();
});

test("a slow read for a superseded account cannot supply the current account's cached timer", async () => {
  world.seedRunning("account A secret timer", null, "user-1");
  const managing = await popup();
  await managing.getByTestId("stop").waitFor();
  world.failNext({
    method: "GET",
    pathPattern: /time-entries/u,
    status: 200,
    applyWrite: true,
    delayMs: 1500,
  });
  const slowRead = managing.evaluate(() => chrome.runtime.sendMessage({ type: "state" }));
  await waitUntil(() => world.requests.at(-1)?.path.includes("time-entries") === true);
  await switchAccount(managing, SECOND_KEY);
  await slowRead;
  world.failNext({
    method: "GET",
    pathPattern: /time-entries/u,
    status: 500,
    applyWrite: false,
    times: 3,
  });
  const reply = await managing.evaluate(() => chrome.runtime.sendMessage({ type: "state" }));
  world.clearFaults();
  assert.equal(reply.snapshot.accountId, "ws-2/user-2");
  assert.notEqual(reply.snapshot.timer.kind, "running");
  assert.doesNotMatch(JSON.stringify(reply), /account A secret timer/u);
  await switchAccount(managing, SYNTHETIC_KEY);
  await managing.close();
});
