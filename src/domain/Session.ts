export class Session {
  constructor(
    readonly id: number,
    readonly startedAt: Date,
    public endsAt: Date,
    readonly userDisplayName?: string,
    readonly packageName?: string,
  ) {}

  remainingMs(now: Date = new Date()): number {
    return Math.max(0, this.endsAt.getTime() - now.getTime());
  }

  isExpired(now: Date = new Date()): boolean {
    return this.remainingMs(now) === 0;
  }

  isExpiringSoon(now: Date = new Date(), thresholdMs = 60_000): boolean {
    const left = this.remainingMs(now);
    return left > 0 && left <= thresholdMs;
  }

  extend(newEnd: Date) {
    if (newEnd > this.endsAt) this.endsAt = newEnd;
  }
}
