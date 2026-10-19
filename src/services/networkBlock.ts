/**
 * "This PC may not use Cyber Place" (2026-10-01): the backend refuses every
 * `/agent/*` request with 403 and a code — `access_blocked` (an
 * administrator's rule) or `access_suspended` (the system blocked the address
 * after suspicious requests). What was blocked is never shown. The transport raises it here
 * and clears it on the next answer the server accepts; the lock screen says
 * so instead of "no connection". Same contract as the desktop panel's
 * `src/auth/networkBlock.ts`.
 *
 * Like a blocked branch, it locks nobody out of a session already running and
 * keeps the local emergency PIN: the kiosk is venue equipment, and the people
 * in front of it are players, not the address the administrator refused.
 */

/** Blocked by an administrator, or suspended by the system. */
export type NetworkBlockCode = "blocked" | "suspended";

const CODES: Readonly<Record<string, NetworkBlockCode>> = {
  access_blocked: "blocked",
  access_suspended: "suspended",
  // Sent by the backend of 2026-10-01 morning; still understood.
  ip_blocked: "blocked",
  country_blocked: "blocked",
};

/** The kind of block a refused response announces, or null when it is any other answer. */
export const networkBlockCodeOf = (status: number | undefined, body: unknown): NetworkBlockCode | null => {
  if (status !== 403 || !body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(CODES, code) ? CODES[code] : null;
};

type Listener = () => void;

let current: NetworkBlockCode | null = null;
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const l of listeners) {
    try { l(); } catch { /* ignore */ }
  }
};

export const networkBlock = {
  raise: (code: NetworkBlockCode): void => {
    if (current === code) return;
    current = code;
    notify();
  },
  clear: (): void => {
    if (current === null) return;
    current = null;
    notify();
  },
  current: (): NetworkBlockCode | null => current,
  subscribe: (l: Listener): (() => void) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};
