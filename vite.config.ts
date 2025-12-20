import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./public/manifest.json";

// Plugin to add Firefox-compatible background.scripts after build
function firefoxCompatPlugin(): Plugin {
  return {
    name: "firefox-compat",
    closeBundle() {
      const manifestPath = path.resolve(__dirname, "dist/manifest.json");
      const builtManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      // Add scripts array pointing to the same file as service_worker
      if (builtManifest.background?.service_worker) {
        builtManifest.background.scripts = [builtManifest.background.service_worker];
      }

      fs.writeFileSync(manifestPath, JSON.stringify(builtManifest, null, 2));
    },
  };
}

// Add content.html to web_accessible_resources in manifest
const extendedManifest = {
  ...manifest,
  web_accessible_resources: [
    {
      resources: ["content.html", "assets/*"],
      matches: ["https://linear.app/*"],
    },
  ],
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    crx({ manifest: extendedManifest }),
    firefoxCompatPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "",
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: path.resolve(__dirname, "content.html"),
      },
    },
  },
}));
