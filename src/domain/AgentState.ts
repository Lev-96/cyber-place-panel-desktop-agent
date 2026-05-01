export type AgentState =
  | { kind: "boot" }
  | { kind: "setup" }
  | { kind: "connecting" }
  | { kind: "locked" }
  | { kind: "active"; sessionId: number; endsAt: Date; userDisplayName?: string }
  | { kind: "expiring"; sessionId: number; endsAt: Date }
  | { kind: "offline" };
