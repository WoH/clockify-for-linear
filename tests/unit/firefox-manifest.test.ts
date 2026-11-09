import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";

test("the Firefox build declares the data it sends and requires supported Firefox versions", () => {
  execFileSync(process.execPath, ["scripts/build.ts"]);

  const manifest = z
    .object({
      browser_specific_settings: z.object({
        gecko: z.object({
          id: z.string(),
          strict_min_version: z.string(),
          data_collection_permissions: z.object({ required: z.array(z.string()) }),
        }),
        gecko_android: z.object({ strict_min_version: z.string() }),
      }),
    })
    .parse(JSON.parse(readFileSync("dist/firefox/manifest.json", "utf8")));

  const { gecko, gecko_android: android } = manifest.browser_specific_settings;

  assert.equal(gecko.id, "clockify-for-linear@and-solution.de");
  assert.equal(gecko.strict_min_version, "140.0");
  assert.equal(android.strict_min_version, "142.0");
  assert.deepEqual(gecko.data_collection_permissions.required, [
    "authenticationInfo",
    "personallyIdentifyingInfo",
    "browsingActivity",
    "websiteContent",
  ]);
});
