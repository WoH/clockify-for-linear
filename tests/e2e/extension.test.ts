import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { launchBrowser } from "./browser.ts";
import { FakeWorld, SECOND_KEY, SYNTHETIC_KEY } from "./fake-world.ts";

import type { LaunchedBrowser, Popup } from "./browser.ts";
import type { BrowserContext, FrameLocator, Page } from "playwright-core";

const ISSUE_URL = "https://linear.app/acme/issue/ENG-1/first";

const world = new FakeWorld();
const profile = mkdtempSync(join(tmpdir(), "clockify-for-linear-profile-"));
let context: BrowserContext;
let origin = "";
let runInExtension: LaunchedBrowser["runInExtension"];
let openPopup: LaunchedBrowser["openPopup"];

async function launch(): Promise<void> {
  ({ context, origin, runInExtension, openPopup } = await launchBrowser(profile, world.proxyUrl));
}

function widget(page: Page): FrameLocator {
  return page.frameLocator("#clockify-for-linear-host");
}

/** Picks a project the way a user does: click the field, type, click the row. An empty query picks "No project". */
async function chooseProject(
  view: Pick<Page, "getByTestId" | "getByRole">,
  query: string,
  row: string,
): Promise<void> {
  await view.getByTestId("project").click();
  await view.getByTestId("project").fill(query);
  await view.getByRole("option", { name: row }).click();
}

async function popup(): Promise<Popup> {
  return openPopup();
}

async function connect(page: Popup): Promise<void> {
  await page.getByTestId("api-key").fill(SYNTHETIC_KEY);
  await page.getByTestId("connect").click();
  await page.getByTestId("start").waitFor();
}

async function storedKey(): Promise<string | undefined> {
  const stored = await runInExtension(() => chrome.storage.local.get("clockifyApiKey"));

  const key = stored["clockifyApiKey"];

  return key === undefined ? undefined : String(key);
}

before(async () => {
  await world.start();
  await launch();
});

async function connectedAs(key: string): Promise<void> {
  const page = await popup();
  const disconnect = page.getByTestId("disconnect");
  const apiKey = page.getByTestId("api-key");

  await disconnect.or(apiKey).first().waitFor();

  if (await disconnect.isVisible()) await disconnect.click();
  await apiKey.fill(key);
  await page.getByTestId("connect").click();
  await page.getByTestId("start").waitFor();
  await page.close();
}

beforeEach(async () => {
  const stored = await storedKey();

  if (stored !== SYNTHETIC_KEY) await connectedAs(SYNTHETIC_KEY);

  world.entries = [];
  world.clearFaults();
  await runInExtension(() => chrome.storage.local.remove("unresolvedOperations"));
});

after(async () => {
  try {
    if (context) await context.close();
  } finally {
    world.stop();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("an invalid key is rejected and not stored", async () => {
  await runInExtension(() => chrome.storage.local.clear());
  const page = await popup();
  await page.getByTestId("api-key").fill("not-the-synthetic-key");
  await page.getByTestId("connect").click();
  await page.getByTestId("problem").waitFor();
  assert.match(await page.getByTestId("problem").innerText(), /rejected the API key/u);
  assert.equal(await storedKey(), undefined);
  await page.close();
});

test("connecting stores the key under clockifyApiKey and keeps it away from pages", async () => {
  await runInExtension(() => chrome.storage.local.clear());
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
  assert.match(await widget(page).getByTestId("issue").innerText(), /ENG-1\s+First issue/u);
  await page.locator("#go-eng-2").click();
  await widget(page).getByText("ENG-2 AU1002440: Second issue").waitFor();
  assert.equal(await widget(page).getByTestId("description").inputValue(), "ENG-2");
  assert.equal(await widget(page).getByTestId("project").inputValue(), "AU1002440");
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
    // Chromium replays a reset PUT once per warm keep-alive socket, so every replay must drop too.
    times: 5,
  });
  await widget(page).getByTestId("stop").click();
  await widget(page).getByTestId("unresolved").waitFor();
  world.clearFaults();
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
    times: 5,
  });
  await widget(page).getByTestId("stop").click();
  await widget(page).getByTestId("unresolved").waitFor();
  const dispatched = puts();
  // Chromium's network stack replays a reset PUT on each reused keep-alive socket; the extension itself sends one.
  assert.ok(dispatched - before >= 1);
  world.clearFaults();
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
  await chooseProject(widget(page), "", "No project");
  await widget(page).getByTestId("save").click();
  await widget(page).getByTestId("problem").waitFor();
  assert.match(
    await widget(page).getByTestId("problem").innerText(),
    /Removing a project is not supported/u,
  );
  assert.equal(world.mutations().length, before);
  assert.equal(running.projectId, "proj-other");
  await chooseProject(widget(page), "au10", "AU1002440");
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
    // Chromium replays a reset PUT once per warm keep-alive socket, so every replay must drop too.
    times: 5,
  });
  await widget(page).getByTestId("stop").click();
  await widget(page).getByTestId("unresolved").waitFor();
  world.clearFaults();
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

async function clockedPopup(): Promise<Popup> {
  return openPopup({ clock: true });
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
  await chooseProject(second, "AU1", "AU1002440");
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
  const frames = page.frames().filter((frame) => frame.url().startsWith(origin));
  assert.equal(frames.length, 1);
  assert.equal(new URL(frames[0]?.url() ?? "").pathname, "/widget.html");

  const rejected = await frames[0]?.evaluate(() =>
    chrome.runtime.sendMessage({ type: "connect", apiKey: "x" }),
  );

  assert.deepEqual(rejected, { rejected: true });
  assert.equal(await storedKey(), SYNTHETIC_KEY);
  await page.close();
});

async function switchAccount(managing: Popup, key: string): Promise<void> {
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
  await waitUntil(
    async () => (await widget(page).getByTestId("description").inputValue()) !== "account A draft",
  );
  const before = world.mutations().length;
  const frame = page.frames().find((candidate) => candidate.url().endsWith("/widget.html"));
  assert.ok(frame);

  const stale = await frame.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "start",
      accountId: "ws-1/user-1",
      description: "account A draft",
      projectId: null,
    }),
  );

  assert.match(stale.error.message, /account changed/u);
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
  const before = world.mutations().length;
  world.failNext({
    method: "GET",
    pathPattern: /time-entries/u,
    status: 503,
    applyWrite: false,
    times: 100,
  });
  await widget(page).getByTestId("stale").waitFor({ timeout: 8_000 });
  assert.equal(await widget(page).getByTestId("stop").isDisabled(), true);
  assert.match(await widget(page).getByTestId("elapsed").innerText(), /^\d\d:\d\d:\d\d$/u);
  world.clearFaults();
  await widget(page).getByTestId("stale").waitFor({ state: "detached", timeout: 15_000 });
  assert.equal(await widget(page).getByTestId("stop").isEnabled(), true);
  assert.equal(world.mutations().length, before);
  assert.equal(
    world.entries.some((entry) => entry.timeInterval.end === null),
    true,
  );
  await page.close();
});

test("a timer started or stopped in Clockify reaches an open widget within seconds and keeps the draft", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").waitFor();
  const external = world.seedRunning("Started in Clockify", "proj-au");
  await widget(page).getByTestId("stop").waitFor({ timeout: 8_000 });
  assert.equal(await widget(page).getByTestId("description").inputValue(), "Started in Clockify");
  await widget(page).getByTestId("description").fill("my unsaved edit");
  await widget(page).getByTestId("minimize").click();
  await widget(page).getByTestId("expand").click();
  assert.equal(await widget(page).getByTestId("description").inputValue(), "my unsaved edit");
  external.timeInterval.end = new Date().toISOString();
  await widget(page).getByTestId("start").waitFor({ timeout: 8_000 });
  assert.equal(await widget(page).getByTestId("description").inputValue(), "ENG-1");
  await page.close();
});

test("connecting in the popup updates an open widget without a reload", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await widget(page).getByTestId("start").waitFor();
  const managing = await popup();
  await managing.getByTestId("disconnect").click();
  await widget(page).getByTestId("connect-hint").waitFor({ timeout: 2_000 });
  await managing.getByTestId("api-key").fill(SYNTHETIC_KEY);
  await managing.getByTestId("connect").click();
  await widget(page).getByTestId("start").waitFor({ timeout: 2_000 });
  await managing.close();
  await page.close();
});

test("the widget frame resists page CSS and sits above a bar docked to the bottom edge", async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(ISSUE_URL);

  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent =
      "iframe { background: white !important; bottom: 0 !important; width: 900px !important; }";
    document.head.append(style);
    const bar = document.createElement("div");
    bar.id = "agent-bar";
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;height:36px;z-index:10;background:#333";
    document.body.append(bar);
  });

  await widget(page).getByTestId("start").waitFor();
  const host = page.locator("#clockify-for-linear-host");

  const placement = async () =>
    page.evaluate(() => {
      const frame = document.querySelector("#clockify-for-linear-host");
      const bar = document.querySelector("#agent-bar");
      assert(frame && bar);
      const box = frame.getBoundingClientRect();

      return {
        background: getComputedStyle(frame).backgroundColor,
        clearsBar: box.bottom <= bar.getBoundingClientRect().top,
        fits: box.left >= 0 && box.right <= innerWidth,
      };

      function assert(value: unknown): asserts value {
        if (!value) throw new Error("missing element");
      }
    });

  await waitUntil(async () => (await placement()).clearsBar);
  assert.deepEqual(await placement(), {
    background: "rgba(0, 0, 0, 0)",
    clearsBar: true,
    fits: true,
  });
  await widget(page).getByTestId("minimize").click();
  await widget(page).getByTestId("expand").waitFor();
  await waitUntil(async () => ((await host.boundingBox())?.height ?? 0) < 100);
  assert.equal((await placement()).clearsBar, true);
  await page.close();
});

test("a dark Linear page gets a dark widget whose project list is dark too", async () => {
  const page = await context.newPage();
  await page.goto(ISSUE_URL);
  await page.evaluate(() => {
    document.documentElement.className = "dark";
  });
  await widget(page).locator('html[data-theme="dark"]').waitFor();
  await widget(page).getByTestId("project").click();

  const colors = await widget(page)
    .getByTestId("project-list")
    .evaluate((list) => {
      const option = list.querySelector('[role="option"]:not(.none)');

      if (option === null) throw new Error("no option");

      return {
        scheme: getComputedStyle(list).colorScheme,
        panel: getComputedStyle(list.parentElement ?? list).backgroundColor,
        text: getComputedStyle(option).color,
      };
    });

  assert.deepEqual(colors, {
    scheme: "dark",
    panel: "rgb(28, 29, 34)",
    text: "rgb(238, 239, 242)",
  });
  assert.equal(
    await page
      .locator("#clockify-for-linear-host")
      .evaluate((frame) => getComputedStyle(frame).colorScheme),
    "dark",
  );
  await page.close();
});

const PICKER_PROJECTS = [
  { id: "proj-au", name: "AU1002440", color: "#0ea5e9", clientName: "Acme" },
  { id: "proj-other", name: "Internal", color: "#f97316", clientName: null },
  { id: "proj-zeta", name: "Zeta research", color: "#22c55e", clientName: "Globex" },
  { id: "proj-dup-a", name: "Support", color: "#a855f7", clientName: "Acme" },
  { id: "proj-dup-b", name: "Support", color: "#ef4444", clientName: "Globex" },
];

/** Re-reads Clockify's projects by reconnecting; projects are cached per session. */
async function withProjects(
  projects: typeof PICKER_PROJECTS,
  favoriteIds: string[],
  run: () => Promise<void>,
): Promise<void> {
  const saved = { projects: world.projects, favoriteIds: world.favoriteIds };
  world.projects = projects;
  world.favoriteIds = favoriteIds;
  await connectedAs(SYNTHETIC_KEY);

  try {
    await run();
  } finally {
    world.projects = saved.projects;
    world.favoriteIds = saved.favoriteIds;
    world.entries = [];
    world.clearFaults();
    await connectedAs(SYNTHETIC_KEY);
  }
}

async function optionNames(view: Pick<Page, "getByRole">): Promise<string[]> {
  return view
    .getByRole("option")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent ?? ""),
    );
}

test("Clockify favorites from the favorites endpoint are listed first and marked", async () => {
  await withProjects(PICKER_PROJECTS, ["proj-zeta", "proj-dup-b"], async () => {
    const favoriteReads = world.requests.filter(
      (request) =>
        request.host === "app.clockify.me" &&
        request.path.startsWith("/api/workspaces/ws-1/project-picker/projects?favorites=true"),
    );

    assert.ok(favoriteReads.length > 0);
    assert.ok(favoriteReads.every((request) => request.apiKey === SYNTHETIC_KEY));
    const page = await context.newPage();
    await page.goto(ISSUE_URL);
    const view = widget(page);
    await view.getByTestId("start").waitFor();
    await view.getByTestId("project").click();
    assert.equal(await view.getByTestId("project").getAttribute("aria-expanded"), "true");
    assert.deepEqual(await optionNames(view), [
      "No project",
      "Support, Globex",
      "Zeta research, Globex",
      "AU1002440, Acme",
      "Internal",
      "Support, Acme",
    ]);
    await view.getByRole("group", { name: "Favorites" }).waitFor();
    assert.equal(await view.locator(".picker-option .mark.star").count(), 2);
    await page.close();
  });
});

test("the project field is searched by typing and chosen with arrows, Enter and Escape", async () => {
  await withProjects(PICKER_PROJECTS, ["proj-zeta"], async () => {
    const page = await context.newPage();
    await page.goto(ISSUE_URL);
    const view = widget(page);
    const field = view.getByTestId("project");
    await view.getByTestId("start").waitFor();
    assert.equal(await field.inputValue(), "");
    assert.equal(await field.getAttribute("placeholder"), "No project");

    await field.focus();
    await field.press("s");
    assert.equal(await field.getAttribute("aria-expanded"), "true");
    await field.pressSequentially("upport");
    assert.deepEqual(await optionNames(view), ["Support, Acme", "Support, Globex"]);
    await field.press("ArrowDown");
    const active = await field.getAttribute("aria-activedescendant");
    assert.equal(
      await view.locator(`[id="${active}"]`).getAttribute("aria-label"),
      "Support, Globex",
    );
    await field.press("Enter");
    assert.equal(await field.getAttribute("aria-expanded"), "false");
    assert.equal(await field.inputValue(), "Support · Globex");
    await view.getByTestId("start").click();
    await view.getByTestId("stop").waitFor();
    assert.equal(world.entries.at(-1)?.projectId, "proj-dup-b");

    await field.click();
    await field.fill("globex");
    assert.deepEqual(await optionNames(view), ["Zeta research, Globex", "Support, Globex"]);
    await field.press("Escape");
    assert.equal(await field.inputValue(), "Support · Globex");
    assert.equal(await view.getByTestId("save").isDisabled(), true);

    const before = world.mutations().length;
    await field.click();
    await field.fill("nothing like this");
    await view.getByText("No projects match “nothing like this”.").waitFor();
    assert.equal(await view.getByRole("option").count(), 0);
    await field.press("Enter");
    await field.press("Tab");
    assert.equal(await field.inputValue(), "Support · Globex");
    assert.equal(world.mutations().length, before);

    await field.click();
    await view.getByRole("option", { name: "Internal" }).click();
    await view.getByTestId("save").click();
    await waitUntil(() => world.entries.at(-1)?.projectId === "proj-other");
    await view.getByTestId("stop").click();
    await view.getByTestId("start").waitFor();
    await page.close();
  });
});

test("a background refresh keeps the project search, its focus and the list's scroll", async () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    id: `proj-${index}`,
    name: `Project ${String(index).padStart(2, "0")}`,
    color: "#64748b",
    clientName: null,
  }));

  await withProjects(many, [], async () => {
    const running = world.seedRunning("syncing", "proj-3");
    const before = world.mutations().length;
    const page = await clockedPopup();
    const field = page.getByTestId("project");
    await page.getByTestId("stop").waitFor();
    await field.click();
    await field.fill("Project 3");
    await page.getByTestId("project-list").evaluate((list) => {
      list.scrollTop = 0;
    });
    running.description = "renamed in Clockify";
    await page.clock.fastForward(5_000);
    await waitUntil(
      async () => (await page.getByTestId("description").inputValue()) === "renamed in Clockify",
    );
    assert.equal(await field.inputValue(), "Project 3");
    assert.equal(await field.evaluate((node) => node === document.activeElement), true);
    assert.equal(await field.getAttribute("aria-expanded"), "true");
    assert.deepEqual(
      await optionNames(page),
      Array.from({ length: 10 }, (_, digit) => `Project 3${digit}`),
    );

    await field.fill("Project");
    await page.getByTestId("project-list").evaluate((list) => {
      list.scrollTop = 300;
    });
    running.description = "renamed again";
    await page.clock.fastForward(5_000);
    await waitUntil(
      async () => (await page.getByTestId("description").inputValue()) === "renamed again",
    );
    assert.equal(await page.getByTestId("project-list").evaluate((list) => list.scrollTop), 300);
    assert.equal(world.mutations().length, before);
    running.timeInterval.end = new Date().toISOString();
    await page.close();
  });
});

test("projects still load and the list says so when Clockify favorites are unavailable", async () => {
  world.failNext({
    method: "GET",
    pathPattern: /project-picker/u,
    status: 404,
    applyWrite: false,
    times: 10,
  });

  await withProjects(PICKER_PROJECTS, ["proj-zeta"], async () => {
    const page = await popup();
    const field = page.getByTestId("project");
    await page.getByTestId("start").waitFor();
    await field.click();
    await page
      .getByText("Favorites could not be loaded from Clockify, so projects are listed by name.")
      .waitFor();
    assert.equal(await page.getByRole("group", { name: "Favorites" }).count(), 0);
    assert.deepEqual(await optionNames(page), [
      "No project",
      "AU1002440, Acme",
      "Internal",
      "Support, Acme",
      "Support, Globex",
      "Zeta research, Globex",
    ]);
    assert.equal(
      await field.getAttribute("aria-describedby"),
      await page.locator(".picker-note").getAttribute("id"),
    );
    await page.close();
  });
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
