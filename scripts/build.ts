import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const BROWSERS = ["chrome", "firefox"] as const;
const GECKO_ID = "clockify-for-linear@and-solution.de";
const OUT = new URL("../dist/", import.meta.url);

function manifest(browser: (typeof BROWSERS)[number]) {
  const icons = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };

  const common = {
    manifest_version: 3,
    name: "Clockify Tracker for Linear",
    description: "Track the Linear issue you are viewing with Clockify.",
    version: "2.0.0",
    icons,
    action: { default_popup: "popup.html", default_icon: icons },
    permissions: ["storage"],
    host_permissions: ["https://api.clockify.me/*"],
    web_accessible_resources: [{ resources: ["widget.html"], matches: ["https://linear.app/*"] }],
    content_scripts: [
      { matches: ["https://linear.app/*"], js: ["content.js"], run_at: "document_idle" },
    ],
  };

  if (browser === "chrome") return { ...common, background: { service_worker: "background.js" } };

  return {
    ...common,
    background: { scripts: ["background.js"] },
    browser_specific_settings: { gecko: { id: GECKO_ID, strict_min_version: "121.0" } },
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
