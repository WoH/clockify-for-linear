import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, firefox } from "playwright-core";

import { installTemporaryAddon, assertMarionettePortFree } from "./marionette.ts";

import type { BrowserContext, Frame, Page } from "playwright-core";

const GECKO_ID = "clockify-for-linear@and-solution.de";
const FIREFOX_UUID = "5d1a9a4e-6d1e-4c53-9a53-3f1b2c7d8e90";

export type BrowserName = "chromium" | "firefox";

const requested = process.env["E2E_BROWSER"];

if (requested !== "chromium" && requested !== "firefox") {
  throw new Error("Set E2E_BROWSER to chromium or firefox (use npm run test:e2e).");
}

export const BROWSER: BrowserName = requested;

export type LaunchedBrowser = {
  context: BrowserContext;
  /** scheme://host of the installed extension, e.g. chrome-extension://abc. */
  origin: string;
  /** Opens the toolbar popup as a page-like handle. */
  openPopup: (options?: { clock?: boolean }) => Promise<Popup>;
  runInExtension: <T>(fn: () => Promise<T> | T) => Promise<T>;
};

/** What the scenarios use of a popup: a Chromium popup page, or on Firefox a handle on the popup iframe and its host page. */
export type Popup = Pick<
  Page,
  | "getByTestId"
  | "getByRole"
  | "getByText"
  | "locator"
  | "content"
  | "reload"
  | "close"
  | "clock"
  | "waitForTimeout"
> & { evaluate: <T>(fn: () => Promise<T> | T) => Promise<T> };

/** Uses the Playwright-managed browser unless CHROME_BIN / FIREFOX_BIN points at another executable. */
export async function launchBrowser(profile: string, proxy: string): Promise<LaunchedBrowser> {
  return BROWSER === "chromium" ? launchChromium(profile, proxy) : launchFirefox(profile, proxy);
}

async function launchChromium(profile: string, proxy: string): Promise<LaunchedBrowser> {
  const extension = join(import.meta.dirname, "../../dist/chrome");

  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env["CHROME_BIN"],
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      `--proxy-server=http://${proxy}`,
      "--ignore-certificate-errors",
    ],
  });

  context.setDefaultTimeout(5_000);
  let worker = context.serviceWorkers()[0];

  if (worker === undefined) {
    try {
      worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  const origin = `chrome-extension://${new URL(worker.url()).host}`;

  return {
    context,
    origin,
    openPopup: async ({ clock = false } = {}) => {
      const page = await context.newPage();

      if (clock) await page.clock.install();
      await page.goto(`${origin}/popup.html`);

      return page;
    },
    runInExtension: async (fn) => {
      const current = context.serviceWorkers()[0];
      assert.ok(current);

      return current.evaluate(fn);
    },
  };
}

/**
 * Juggler never attaches Playwright to top-level moz-extension:// pages, so the popup is framed inside a
 * fake Linear page. That needs popup.html to be web-accessible, which the shipped manifest does not allow;
 * the only difference from dist/firefox is that one test-copy manifest entry.
 */
async function prepareFirefoxExtension(profile: string): Promise<string> {
  const directory = join(profile, "test-addon");
  await cp(join(import.meta.dirname, "../../dist/firefox"), directory, { recursive: true });
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.web_accessible_resources[0].resources.push("popup.html");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return directory;
}

async function waitForFrame(find: () => Frame | undefined): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (find() === undefined) {
    assert.ok(Date.now() < deadline, "popup frame never attached");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function launchFirefox(profile: string, proxy: string): Promise<LaunchedBrowser> {
  const extension = await prepareFirefoxExtension(profile);
  await assertMarionettePortFree();

  const context = await firefox.launchPersistentContext(profile, {
    executablePath: process.env["FIREFOX_BIN"],
    headless: true,
    proxy: { server: `http://${proxy}` },
    ignoreHTTPSErrors: true,
    firefoxUserPrefs: {
      "xpinstall.signatures.required": false,
      // A fixed moz-extension:// host lets tests frame the popup, since Playwright cannot list Firefox add-ons.
      "extensions.webextensions.uuids": JSON.stringify({ [GECKO_ID]: FIREFOX_UUID }),
    },
    args: ["-marionette"],
  });

  context.setDefaultTimeout(5_000);

  try {
    assert.equal(await installTemporaryAddon(extension), GECKO_ID);
  } catch (error) {
    await context.close();
    throw error;
  }

  const origin = `moz-extension://${FIREFOX_UUID}`;

  const openPopup: LaunchedBrowser["openPopup"] = async ({ clock = false } = {}) => {
    const host = await context.newPage();

    if (clock) await host.clock.install();
    await host.goto("https://linear.app/popup-host");
    await host.evaluate((src) => {
      const frame = document.createElement("iframe");
      frame.id = "popup-under-test";
      frame.src = src;
      document.body.append(frame);
    }, `${origin}/popup.html`);

    const popupFrame = () => host.frames().find((frame) => frame.url().endsWith("/popup.html"));
    await host.locator("#popup-under-test").waitFor();
    await waitForFrame(popupFrame);
    const locators = host.frameLocator("#popup-under-test");

    const inFrame = () => {
      const frame = popupFrame();
      assert.ok(frame, "popup frame is gone");

      return frame;
    };

    return {
      getByTestId: (id) => locators.getByTestId(id),
      getByRole: (role, options) => locators.getByRole(role, options),
      getByText: (text, options) => locators.getByText(text, options),
      locator: (selector, options) => locators.locator(selector, options),
      evaluate: (fn) => inFrame().evaluate(fn),
      content: () => inFrame().content(),
      reload: async () => {
        await inFrame().evaluate(() => location.reload());
        await new Promise((resolve) => setTimeout(resolve, 250));
        await waitForFrame(popupFrame);

        return null;
      },
      close: () => host.close(),
      clock: host.clock,
      waitForTimeout: (ms) => host.waitForTimeout(ms),
    };
  };

  return {
    context,
    origin,
    openPopup,
    runInExtension: async (fn) => {
      const popup = await openPopup();

      try {
        return await popup.evaluate(fn);
      } finally {
        await popup.close();
      }
    },
  };
}

export type { Page };
