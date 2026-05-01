import { TypedEventEmitter } from "@/infrastructure/TypedEventEmitter";
import { AgentEvent, PROTOCOL_VERSION, ServerCommand, SessionStartPayload } from "@/protocol/Messages";
import { ITransport, TransportStatus, newId } from "./ITransport";

interface Events { command: ServerCommand; status: TransportStatus; }

/**
 * Local-only transport for development before backend session endpoints exist.
 * The renderer can still drive the full state machine end-to-end against this.
 */
export class MockTransport implements ITransport {
  private emitter = new TypedEventEmitter<Events>();
  private state: TransportStatus = "disconnected";

  async connect(): Promise<void> {
    this.setStatus("connecting");
    setTimeout(() => this.setStatus("connected"), 300);
  }

  close(): void { this.setStatus("disconnected"); }

  send<T>(_event: AgentEvent<T>): void { /* swallow */ }

  onCommand(handler: (cmd: ServerCommand) => void) { return this.emitter.on("command", handler); }
  onStatus(handler: (s: TransportStatus) => void) { return this.emitter.on("status", handler); }
  status(): TransportStatus { return this.state; }

  /** Test helpers for the dev console / setup screen. */
  simulateStart(minutes: number, displayName = "Demo user") {
    const now = new Date();
    const payload: SessionStartPayload = {
      sessionId: Math.floor(Math.random() * 1_000_000),
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
      user: { id: 0, displayName },
      packageName: `${minutes} min demo`,
    };
    this.emitter.emit("command", { v: PROTOCOL_VERSION, id: newId(), kind: "session.start", ts: Date.now(), payload });
  }

  simulateStop(sessionId: number) {
    this.emitter.emit("command", {
      v: PROTOCOL_VERSION, id: newId(), kind: "session.stop", ts: Date.now(),
      payload: { sessionId, reason: "stopped_by_cashier" as const },
    });
  }

  private setStatus(s: TransportStatus) {
    if (this.state === s) return;
    this.state = s;
    this.emitter.emit("status", s);
  }
}
