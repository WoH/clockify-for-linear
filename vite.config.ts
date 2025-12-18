import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./public/manifest.json";

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
