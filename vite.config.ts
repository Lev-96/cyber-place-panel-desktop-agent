import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
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
