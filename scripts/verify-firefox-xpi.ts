import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const archive = process.argv[2];
const source = process.argv[3];

if (archive === undefined || source === undefined) {
  throw new Error("Usage: node scripts/verify-firefox-xpi.ts <signed.xpi> <build directory>");
}

function files(directory: string, prefix = ""): string[] {
  const result: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;

    if (entry.isDirectory()) result.push(...files(join(directory, entry.name), `${name}/`));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`Unsupported build entry: ${name}`);
  }

  return result.sort();
}

const metadata = new Set([
  "META-INF/manifest.mf",
  "META-INF/mozilla.sf",
  "META-INF/mozilla.rsa",
  "META-INF/cose.manifest",
  "META-INF/cose.sig",
]);

const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
  .split("\n")
  .filter((entry) => entry !== "");

assert.equal(new Set(entries).size, entries.length, "The XPI contains duplicate paths.");

for (const entry of entries) {
  assert.match(entry, /^[A-Za-z0-9_./-]+$/u, `Unsupported XPI path: ${entry}`);
  assert.ok(!entry.startsWith("/") && !entry.split("/").includes(".."), `Unsafe path: ${entry}`);
}

assert.ok(entries.includes("META-INF/mozilla.rsa"), "The Mozilla signature file is missing.");

const payload = entries.filter((entry) => !entry.endsWith("/") && !metadata.has(entry)).sort();
const expected = files(source);

assert.deepEqual(payload, expected, "The signed XPI has a different file inventory.");

for (const name of expected) {
  const actual: Buffer = execFileSync("unzip", ["-p", archive, name]);
  assert.deepEqual(actual, readFileSync(join(source, name)), `The signed file differs: ${name}`);
}

console.log("The XPI payload matches the Firefox build. Firefox must still verify its signature.");
