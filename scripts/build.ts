import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

import pkg from "../package.json" with { type: "json" };

const BROWSERS = ["chrome", "firefox"] as const;
const GECKO_ID = "clockify-for-linear@and-solution.de";
const OUT = new URL("../dist/", import.meta.url);

function manifest(browser: (typeof BROWSERS)[number]) {
  const icons = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };

  const common = {
    manifest_version: 3,
    name: "Clockify Tracker for Linear",
    description: "Track the Linear issue you are viewing with Clockify.",
    version: pkg.version,
    icons,
    action: { default_popup: "popup.html", default_icon: icons },
    permissions: ["storage"],
    // app.clockify.me serves only the undocumented favorites read; without it favorites show as unavailable.
    host_permissions: ["https://api.clockify.me/*", "https://app.clockify.me/*"],
    web_accessible_resources: [{ resources: ["widget.html"], matches: ["https://linear.app/*"] }],
    content_scripts: [
      { matches: ["https://linear.app/*"], js: ["content.js"], run_at: "document_idle" },
    ],
  };

  if (browser === "chrome") return { ...common, background: { service_worker: "background.js" } };

  return {
    ...common,
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: "140.0",
        data_collection_permissions: {
          required: [
            "authenticationInfo",
            "personallyIdentifyingInfo",
            "browsingActivity",
            "websiteContent",
          ],
        },
      },
      gecko_android: { strict_min_version: "142.0" },
    },
  };
}

await rm(OUT, { recursive: true, force: true });

for (const browser of BROWSERS) {
  const outdir = new URL(`${browser}/`, OUT).pathname;
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/background.ts", "src/content.ts", "src/popup.ts", "src/widget.ts"],
    outdir,
    bundle: true,
    format: "iife",
    target: browser === "chrome" ? "chrome120" : "firefox121",
    logLevel: "warning",
  });
  await cp("src/popup.html", `${outdir}/popup.html`);
  await cp("src/widget.html", `${outdir}/widget.html`);
  await cp("public/icons", `${outdir}/icons`, { recursive: true });
  await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest(browser), null, 2)}\n`);
}
