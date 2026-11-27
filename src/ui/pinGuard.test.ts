import { beforeEach, describe, expect, it } from "vitest";

// The agent's tests run in node: a Storage of our own stands in for the renderer's.
const memory = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)); },
  removeItem: (k: string) => { memory.delete(k); },
  clear: () => memory.clear(),
};
import { LOCKOUT_MS, loadGuard, saveGuard } from "./pinGuard";

/** The PIN pad's lockout survives a reload (2026-11-28, security audit). */
describe("pinGuard", () => {
  beforeEach(() => localStorage.clear());

  it("a lockout set before a reload is still there after it", () => {
    const now = 1_000_000;
    saveGuard(now + LOCKOUT_MS, []);
    expect(loadGuard(now + 1).until).toBe(now + LOCKOUT_MS);
  });

  it("failed tries within the last minute come back; older ones are dropped", () => {
    const now = 5_000_000;
    saveGuard(null, [now - 70_000, now - 30_000, now - 1_000]);
    expect(loadGuard(now).tries).toEqual([now - 30_000, now - 1_000]);
  });

  it("an expired, implausible or broken value never locks the cashier out", () => {
    const now = 9_000_000;
    saveGuard(now - 1, []);
    expect(loadGuard(now).until).toBeNull();
    localStorage.setItem("cp.agent.pinGuard", JSON.stringify({ until: now + 10 * LOCKOUT_MS, tries: ["x"] }));
    expect(loadGuard(now)).toEqual({ until: null, tries: [] });
    localStorage.setItem("cp.agent.pinGuard", "{not json");
    expect(loadGuard(now)).toEqual({ until: null, tries: [] });
  });

  it("a success clears it", () => {
    saveGuard(Date.now() + LOCKOUT_MS, [Date.now()]);
    saveGuard(null, []);
    expect(localStorage.getItem("cp.agent.pinGuard")).toBeNull();
  });
});
