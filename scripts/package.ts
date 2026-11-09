import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import pkg from "../package.json" with { type: "json" };

const ROOT = resolve(import.meta.dirname, "..");
const BROWSERS = ["chrome", "firefox"] as const;
const OUT = join(ROOT, "release");

const tag = process.env["RELEASE_TAG"];

if (tag !== undefined && tag !== `v${pkg.version}`) {
  throw new Error(`Tag ${tag} does not match package.json version ${pkg.version}.`);
}

mkdirSync(OUT, { recursive: true });

for (const browser of BROWSERS) {
  const directory = join(ROOT, "dist", browser);
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));

  if (manifest.version !== pkg.version) {
    throw new Error(`dist/${browser}/manifest.json is ${manifest.version}; run npm run build.`);
  }

  const archive = join(OUT, `clockify-for-linear-${pkg.version}-${browser}.zip`);
  rmSync(archive, { force: true });
  // The working directory puts manifest.json at the archive root.
  execFileSync("zip", ["-q", "-r", "-X", "-D", archive, "."], { cwd: directory });
  const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).split("\n");

  if (!entries.includes("manifest.json")) throw new Error(`${archive} has no root manifest.json.`);

  if (entries.some((entry) => entry.startsWith("dist/") || entry.startsWith("./"))) {
    throw new Error(`${archive} nests its files; the manifest must sit at the archive root.`);
  }

  const packaged = execFileSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8" });

  if (packaged !== readFileSync(join(directory, "manifest.json"), "utf8")) {
    throw new Error(`${archive} manifest differs from dist/${browser}.`);
  }

  console.log(`${archive} (${entries.length - 1} files)`);
}
