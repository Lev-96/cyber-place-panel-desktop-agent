/**
 * Player session on this PC. `endsAt === null` represents an
 * open-mode (pay-by-hour) session — the cashier stops it
 * manually; the agent must never auto-expire it. Every helper
 * below treats null as "no fixed end" rather than "ended at
 * epoch", which is the bug the 2026-05-11 fix solves.
 */
export class Session {
  constructor(
    readonly id: number,
    readonly startedAt: Date,
    public endsAt: Date | null,
    readonly userDisplayName?: string,
    readonly packageName?: string,
  ) {}

  /** True when this session has a fixed end to count down to. */
  hasFixedEnd(): boolean {
    return this.endsAt !== null;
  }

  /**
   * Milliseconds left on a fixed-end session. Returns `null` for
   * open-mode sessions so callers can branch on the discriminator
   * rather than special-casing magic numbers (Infinity / -1).
   * Never goes negative for fixed sessions — clamped at 0 so the
   * `<= 0` expiry check fires exactly once.
   */
  remainingMs(now: Date = new Date()): number | null {
    if (this.endsAt === null) return null;
    return Math.max(0, this.endsAt.getTime() - now.getTime());
  }

  isExpired(now: Date = new Date()): boolean {
    return this.remainingMs(now) === 0;
  }

  isExpiringSoon(now: Date = new Date(), thresholdMs = 60_000): boolean {
    const left = this.remainingMs(now);
    if (left === null) return false; // open sessions never "expire soon"
    return left > 0 && left <= thresholdMs;
  }

  /**
   * Bump the end forward (cashier extended the session) or set
   * a previously-null end (open session converted to fixed by
   * an out-of-band cashier action). Null-safe so the
   * `newEnd > this.endsAt` comparison doesn't coerce a null
   * endsAt to NaN and silently drop the update.
   */
  extend(newEnd: Date) {
    if (this.endsAt === null || newEnd > this.endsAt) {
      this.endsAt = newEnd;
    }
  }
}
