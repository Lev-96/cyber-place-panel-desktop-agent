import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Version reported by telemetry, read from the one file CI already matches the
// release tag against — so what the kiosk reports can never drift from what was
// actually installed on it.
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  base: "./",
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  server: { port: 5174, strictPort: true },
});
