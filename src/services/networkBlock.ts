/**
 * "This PC's address may not use Cyber Place" — the administrator blocked the
 * IP address (or the country) the venue connects from (2026-10-01).
 *
 * The backend refuses every `/agent/*` request from such an address with 403
 * and a code (`ip_blocked`, `country_blocked`). The transport raises it here
 * and clears it on the next answer the server accepts; the lock screen says
 * so instead of "no connection". Same contract as the desktop panel's
 * `src/auth/networkBlock.ts`.
 *
 * Like a blocked branch, it locks nobody out of a session already running and
 * keeps the local emergency PIN: the kiosk is venue equipment, and the people
 * in front of it are players, not the address the administrator refused.
 */

export type NetworkBlockCode = "ip_blocked" | "country_blocked";

const CODES: ReadonlySet<string> = new Set<NetworkBlockCode>(["ip_blocked", "country_blocked"]);

/** The block code of a refused response, or null when it is any other answer. */
export const networkBlockCodeOf = (status: number | undefined, body: unknown): NetworkBlockCode | null => {
  if (status !== 403 || !body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && CODES.has(code) ? (code as NetworkBlockCode) : null;
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
