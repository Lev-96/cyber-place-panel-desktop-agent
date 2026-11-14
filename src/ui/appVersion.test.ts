import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeConfig } from "@/infrastructure/AgentBridge";
import { createAppVersionStore } from "./appVersion";

/**
 * The version line under the brand (2026-11-14). The version is the one the
 * main process reports (`app.getVersion()`, i.e. package.json) through the
 * existing `agentAPI.getAppVersion()` bridge. When the bridge is missing or
 * fails, the line disappears and nothing else on the screen changes: this is
 * a lock screen with a PIN pad on it.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createAppVersionStore", () => {
  it("reads the version from the bridge once and exposes it", async () => {
    const read = vi.fn(async () => "1.0.27-staging.1");
    const store = createAppVersionStore(read);
    expect(store.current()).toBeNull();
    await Promise.all([store.load(), store.load()]);
    expect(store.current()).toBe("1.0.27-staging.1");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("starts loading on the first subscriber and tells it when the version arrives", async () => {
    const store = createAppVersionStore(async () => "2.3.4");
    const listener = vi.fn();
    const off = store.subscribe(listener);
    await flush();
    expect(store.current()).toBe("2.3.4");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("stays empty when there is no bridge, the call fails, or the answer is not a version", async () => {
    const none = createAppVersionStore(undefined);
    await none.load();
    expect(none.current()).toBeNull();

    const failing = createAppVersionStore(async () => { throw new Error("no handler"); });
    await failing.load();
    expect(failing.current()).toBeNull();

    for (const bad of ["", "   ", null, 42, undefined]) {
      const s = createAppVersionStore(async () => bad);
      await s.load();
      expect(s.current()).toBeNull();
    }
  });
});

const config: AgentRuntimeConfig = {
  serverUrl: "http://127.0.0.1:9",
  pairingToken: "t",
  branchId: 1,
  pcId: 7,
  pcLabel: "PC-07",
  unlockPinHash: null,
  unlockPinUpdatedAt: null,
  branchBlocked: false,
};

/** Render a screen with the real bridge → store → BrandMark path, bridge faked. */
const renderWithBridge = async (
  bridge: { getAppVersion(): Promise<string> } | null,
  screen: "BrandMark" | "LockScreen",
): Promise<string> => {
  vi.resetModules();
  vi.doMock("@/infrastructure/AgentBridge", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/infrastructure/AgentBridge")>()),
    agentBridge: bridge,
  }));
  const { appVersion } = await import("./appVersion");
  await appVersion.load();
  if (screen === "BrandMark") {
    const { default: BrandMark } = await import("./BrandMark");
    return renderToStaticMarkup(createElement(BrandMark));
  }
  const { default: LockScreen } = await import("./LockScreen");
  return renderToStaticMarkup(createElement(LockScreen, { config, status: "connected" }));
};

describe("BrandMark version line", () => {
  afterEach(() => {
    vi.doUnmock("@/infrastructure/AgentBridge");
    vi.resetModules();
  });

  it("shows the version Electron reports, under the logo and the name", async () => {
    const html = await renderWithBridge({ getAppVersion: async () => "1.0.27-staging.1" }, "BrandMark");
    expect(html).toContain('<div class="brand-version">Версия 1.0.27-staging.1</div>');
    // Logo and name come first, the version line after them.
    expect(html.indexOf("brand-logo")).toBeLessThan(html.indexOf("brand-version"));
    expect(html.indexOf("CYBER PLACE")).toBeLessThan(html.indexOf("brand-version"));
  });

  it("renders no version line at all when the version is unavailable", async () => {
    const html = await renderWithBridge(null, "BrandMark");
    expect(html).not.toContain("brand-version");
    expect(html).not.toContain("Версия");
    expect(html).toContain("CYBER PLACE");
  });

  it("puts the version on the lock screen and leaves the PIN pad intact", async () => {
    const html = await renderWithBridge({ getAppVersion: async () => "1.0.27-staging.1" }, "LockScreen");
    expect(html).toContain("Версия 1.0.27-staging.1");
    expect(html).toContain("PC-07");
    expect(html).toContain('class="kbd"');
    expect(html).toContain("Подтвердить");
  });

  it("keeps the lock screen whole when reading the version fails", async () => {
    const html = await renderWithBridge(
      { getAppVersion: () => Promise.reject(new Error("No handler registered")) },
      "LockScreen",
    );
    expect(html).not.toContain("brand-version");
    expect(html).toContain("CYBER PLACE");
    expect(html).toContain('class="kbd"');
    expect(html).toContain("Подтвердить");
  });
});
