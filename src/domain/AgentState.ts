/**
 * Discriminated union representing what the agent is doing.
 *
 * `active.endsAt` is nullable because open-mode (pay-by-hour)
 * sessions have no fixed end — the cashier stops them manually.
 * The UI branches on `endsAt === null` to show "Open session"
 * instead of a countdown.
 *
 * `expiring` is reserved for fixed-end sessions whose end is
 * close — so it keeps a non-null `endsAt` and the agent never
 * transitions an open session into it.
 */
export type AgentState =
  | { kind: "boot" }
  | { kind: "setup" }
  | { kind: "connecting" }
  | { kind: "locked" }
  | { kind: "active"; sessionId: number; endsAt: Date | null; userDisplayName?: string }
  | { kind: "expiring"; sessionId: number; endsAt: Date }
  | { kind: "offline" };
