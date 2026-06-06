/**
 * Local cache of the branch's emergency-unlock PIN hash.
 *
 * The kiosk verifies the PIN against the server while it has network
 * (the DB is the source of truth). When the network is down, it falls
 * back to a bcrypt compare against the hash stashed here — so a PC that
 * boots offline, or loses its connection mid-shift, can still be
 * rescued with the PIN the manager set while it was last online.
 *
 * Stored in window.localStorage (persisted per-renderer in Electron's
 * userData partition, so it survives restarts). Only the bcrypt hash is
 * kept — never a plaintext PIN.
 */
const KEY = "agent.unlockPinHash";

export const pinCache = {
  /**
   * Persist the latest hash. Called whenever /agent/hello hands us a
   * non-null hash. We deliberately never clear on a null hash: a null
   * usually means "this /hello didn't include it" (e.g. a transient
   * failure fell back to the placeholder identity), and there is no
   * PIN-removal feature — so wiping a good cache on a flaky response
   * would needlessly break offline rescue.
   */
  save(hash: string | null): void {
    if (!hash) return;
    try {
      window.localStorage.setItem(KEY, hash);
    } catch {
      /* localStorage unavailable / quota — non-fatal, offline rescue
         simply won't have a cache to fall back on. */
    }
  },

  load(): string | null {
    try {
      return window.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
};
