import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { z } from "zod";

import pkg from "../package.json" with { type: "json" };
import { createAmoClient } from "./amo.ts";
import { obtainSignedXpi } from "./firefox-signed-xpi.ts";

const [mode, tag, buildDirectory, sourceArchive, outputXpi] = process.argv.slice(2);

if (
  (mode !== "submit" && mode !== "recover") ||
  tag === undefined ||
  buildDirectory === undefined ||
  sourceArchive === undefined ||
  outputXpi === undefined
) {
  throw new Error(
    "Usage: node scripts/obtain-firefox-xpi.ts <submit|recover> <tag> <build directory> <source.zip> <output.xpi>",
  );
}

if (tag !== `v${pkg.version}`) throw new Error(`Tag ${tag} does not match ${pkg.version}.`);

const manifest = z
  .object({
    version: z.string(),
    browser_specific_settings: z.object({ gecko: z.object({ id: z.string() }) }),
  })
  .parse(JSON.parse(readFileSync(join(buildDirectory, "manifest.json"), "utf8")));

if (manifest.version !== pkg.version) throw new Error("The Firefox build has another version.");

const issuer = process.env["WEB_EXT_API_KEY"];
const secret = process.env["WEB_EXT_API_SECRET"];

if (!issuer || !secret) throw new Error("AMO credentials are missing.");

const webExt = resolve(import.meta.dirname, "../tools/firefox-signing/node_modules/.bin/web-ext");
const work = mkdtempSync(join(tmpdir(), "firefox-xpi-"));

await obtainSignedXpi({
  client: createAmoClient({ issuer, secret }),
  guid: manifest.browser_specific_settings.gecko.id,
  version: pkg.version,
  mode,
  buildDirectory,
  artifactsDirectory: join(work, "artifacts"),
  outputXpi,
  submit: async (artifactsDirectory) => {
    // web-ext writes upload state into its source directory, so it gets a copy.
    const submission = join(work, "submission");

    await run("cp", ["-a", buildDirectory, submission]);
    await run(webExt, [
      "sign",
      "--no-config-discovery",
      "--source-dir",
      submission,
      "--artifacts-dir",
      artifactsDirectory,
      "--channel",
      "unlisted",
      "--upload-source-code",
      sourceArchive,
      "--approval-timeout",
      "1200000",
    ]);
  },
});

function run(command: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${command} exited with ${code}.`)),
    );
  });
}
