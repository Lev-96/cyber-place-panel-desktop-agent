/**
 * The PIN pad's lockout and recent failures outlive a reload or a restart of
 * the agent (2026-11-28, security audit): they lived only in React state, so
 * a reload handed out five fresh tries. Local only; an unreadable or
 * implausible value is ignored rather than locking the cashier out.
 */
export const ATTEMPT_WINDOW_MS = 60_000;
export const LOCKOUT_MS = 60_000;
const GUARD_KEY = "cp.agent.pinGuard";

export interface PinGuard { until: number | null; tries: number[] }

export const loadGuard = (now: number = Date.now()): PinGuard => {
  try {
    const raw = JSON.parse(localStorage.getItem(GUARD_KEY) ?? "null") as { until?: unknown; tries?: unknown } | null;
    const until = typeof raw?.until === "number" && raw.until > now && raw.until - now <= LOCKOUT_MS ? raw.until : null;
    const tries = Array.isArray(raw?.tries) ? raw.tries.filter((t): t is number => typeof t === "number" && now - t < ATTEMPT_WINDOW_MS && t <= now) : [];
    return { until, tries };
  } catch {
    return { until: null, tries: [] };
  }
};

export const saveGuard = (until: number | null, tries: number[]): void => {
  try {
    if (until === null && tries.length === 0) localStorage.removeItem(GUARD_KEY);
    else localStorage.setItem(GUARD_KEY, JSON.stringify({ until, tries }));
  } catch { /* storage unavailable: the in-memory guard still holds */ }
};
