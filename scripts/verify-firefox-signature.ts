import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { firefox, type BrowserContext } from "playwright-core";
import { z } from "zod";

import { assertMarionettePortFree, installAddon } from "../tests/e2e/marionette.ts";

const input = process.argv[2];

if (input === undefined) {
  throw new Error("Usage: node scripts/verify-firefox-signature.ts <signed.xpi|--self-test>");
}

const build = resolve("dist/firefox");

const manifest = z
  .object({ browser_specific_settings: z.object({ gecko: z.object({ id: z.string() }) }) })
  .parse(JSON.parse(readFileSync(join(build, "manifest.json"), "utf8")));

const work = mkdtempSync(join(tmpdir(), "firefox-signature-"));
const unsigned = join(work, "unsigned.xpi");
let context: BrowserContext | undefined;

try {
  execFileSync("zip", ["-q", "-r", "-X", "-D", unsigned, "."], { cwd: build });
  await assertMarionettePortFree();
  context = await firefox.launchPersistentContext(join(work, "profile"), {
    headless: true,
    proxy: { server: "http://127.0.0.1:9" },
    firefoxUserPrefs: { "xpinstall.signatures.required": true },
    args: ["-marionette"],
  });

  await assert.rejects(installAddon(unsigned, false), /ERROR_SIGNEDSTATE_REQUIRED/u);
  console.log("Firefox rejected the unsigned control with signature enforcement enabled.");

  if (input !== "--self-test") {
    assert.equal(
      await installAddon(resolve(input), false),
      manifest.browser_specific_settings.gecko.id,
    );
    console.log("Firefox accepted the Mozilla-signed add-on.");
  }
} finally {
  if (context !== undefined) await context.close();
  rmSync(work, { recursive: true, force: true });
}
