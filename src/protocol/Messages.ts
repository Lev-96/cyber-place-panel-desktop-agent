/**
 * Wire protocol between the client agent and the server (and indirectly cashier).
 * Stable contract — bump `protocolVersion` on breaking changes.
 */
export const PROTOCOL_VERSION = 1 as const;

export type ServerCommandKind =
  | "session.start"
  | "session.update"
  | "session.stop"
  | "agent.lock"
  | "agent.unlock"
  | "agent.reboot"
  | "agent.shutdown"
  | "ping";

export type AgentEventKind =
  | "agent.hello"
  | "agent.heartbeat"
  | "agent.session.ack"
  | "agent.error"
  | "pong";

export interface ServerCommand<T = unknown> {
  v: typeof PROTOCOL_VERSION;
  id: string;
  kind: ServerCommandKind;
  ts: number;
  payload: T;
}

export interface AgentEvent<T = unknown> {
  v: typeof PROTOCOL_VERSION;
  id: string;
  kind: AgentEventKind;
  ts: number;
  payload: T;
}

export interface SessionStartPayload {
  sessionId: number;
  startedAt: string; // ISO
  endsAt: string;    // ISO
  user?: { id: number; displayName: string };
  packageName?: string;
}

export interface SessionUpdatePayload {
  sessionId: number;
  endsAt: string;
}

export interface SessionStopPayload {
  sessionId: number;
  reason: "expired" | "stopped_by_cashier" | "stopped_by_user";
}

export interface AgentHelloPayload {
  branchId: number;
  pcId: number;
  pcLabel: string;
  agentVersion: string;
  machineId: string;
}

export interface AgentHeartbeatPayload {
  branchId: number;
  pcId: number;
  ts: number;
  state: "locked" | "active" | "idle";
  sessionId?: number;
  remainingSec?: number;
}
