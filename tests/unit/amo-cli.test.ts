import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("recovery validates the tag against the supplied build, not the current package", () => {
  const work = mkdtempSync(join(tmpdir(), "amo-cli-test-"));

  try {
    writeFileSync(
      join(work, "manifest.json"),
      JSON.stringify({
        version: "1.2.3",
        browser_specific_settings: { gecko: { id: "fake@example.test" } },
      }),
    );

    const result = spawnSync(
      process.execPath,
      ["scripts/obtain-firefox-xpi.ts", "recover", "v1.2.3", work, "unused.zip", "unused.xpi"],
      {
        encoding: "utf8",
        env: { ...process.env, WEB_EXT_API_KEY: "", WEB_EXT_API_SECRET: "" },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AMO credentials are missing/u);
    assert.doesNotMatch(result.stderr, /does not match/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
