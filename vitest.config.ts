import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Until now this repo had no test runner at all, and its own notes named that
 * as the ceiling on what could be claimed here: typecheck and a build, never
 * proven behaviour. That was accurate and it was expensive — the session
 * lifecycle on a kiosk is exactly the code where "it compiles" is worth least,
 * because the failure mode is a locked workstation with a player behind it.
 *
 * Deliberately minimal: node environment, no DOM, no setup file. What is
 * testable without Electron is the domain and the session state machine, and
 * that is where the bugs have actually been.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // + the pure, Electron-free parts of the main process (sessionToast).
    include: ["src/**/*.test.ts", "electron/**/*.test.ts"],
  },
});
