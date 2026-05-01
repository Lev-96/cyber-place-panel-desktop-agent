import { AgentState } from "@/domain/AgentState";
import { Session } from "@/domain/Session";
import { agentBridge, AgentConfigJson } from "@/infrastructure/AgentBridge";
import { logger } from "@/infrastructure/Logger";
import { TypedEventEmitter } from "@/infrastructure/TypedEventEmitter";
import {
  AgentEvent,
  AgentHeartbeatPayload,
  AgentHelloPayload,
  PROTOCOL_VERSION,
  ServerCommand,
  SessionStartPayload,
  SessionStopPayload,
  SessionUpdatePayload,
} from "@/protocol/Messages";
import { ITransport, newId } from "@/transport/ITransport";

interface Events {
  state: AgentState;
  remaining: number; // ms
}

const HEARTBEAT_MS = 5_000;
const TICK_MS = 1_000;
const EXPIRING_THRESHOLD_MS = 60_000;

export class SessionManager {
  private emitter = new TypedEventEmitter<Events>();
  private state: AgentState = { kind: "boot" };
  private session: Session | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private detachers: Array<() => void> = [];

  constructor(
    private transport: ITransport,
    private config: AgentConfigJson,
    private machineId: string,
    private agentVersion: string,
  ) {}

  async start(): Promise<void> {
    this.setState({ kind: "connecting" });

    this.detachers.push(this.transport.onStatus((s) => {
      if (s === "connected") {
        this.sendHello();
        if (!this.session) this.setState({ kind: "locked" });
      } else if (s === "disconnected" || s === "error") {
        this.setState({ kind: "offline" });
      }
    }));

    this.detachers.push(this.transport.onCommand((cmd) => this.handleCommand(cmd)));

    await this.transport.connect();
    this.startHeartbeat();
    this.startTick();
  }

  stop(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.tick) clearInterval(this.tick);
    this.heartbeat = null;
    this.tick = null;
    this.transport.close();
  }

  on<K extends keyof Events>(e: K, l: (p: Events[K]) => void) { return this.emitter.on(e, l); }
  current(): AgentState { return this.state; }
  remainingMs(): number { return this.session?.remainingMs() ?? 0; }

  private handleCommand(cmd: ServerCommand) {
    switch (cmd.kind) {
      case "session.start": return this.onSessionStart(cmd.payload as SessionStartPayload);
      case "session.update": return this.onSessionUpdate(cmd.payload as SessionUpdatePayload);
      case "session.stop": return this.onSessionStop(cmd.payload as SessionStopPayload);
      case "agent.lock": return this.forceLock();
      case "agent.unlock": return this.allowUnlock();
      case "agent.shutdown": return void agentBridge?.shutdown();
      case "ping": return this.sendPong(cmd.id);
      default: logger.warn("unknown command", cmd.kind);
    }
  }

  private onSessionStart(p: SessionStartPayload) {
    this.session = new Session(
      p.sessionId,
      new Date(p.startedAt),
      new Date(p.endsAt),
      p.user?.displayName,
      p.packageName,
    );
    this.setState({
      kind: "active",
      sessionId: p.sessionId,
      endsAt: this.session.endsAt,
      userDisplayName: p.user?.displayName,
    });
    void agentBridge?.unlock();
    this.ack("agent.session.ack", { sessionId: p.sessionId, started: true });
  }

  private onSessionUpdate(p: SessionUpdatePayload) {
    if (!this.session || this.session.id !== p.sessionId) return;
    this.session.extend(new Date(p.endsAt));
    if (this.state.kind === "active" || this.state.kind === "expiring") {
      this.setState({
        kind: this.session.isExpiringSoon(new Date(), EXPIRING_THRESHOLD_MS) ? "expiring" : "active",
        sessionId: this.session.id,
        endsAt: this.session.endsAt,
      });
    }
  }

  private onSessionStop(p: SessionStopPayload) {
    this.session = null;
    this.setState({ kind: "locked" });
    void agentBridge?.lock();
    this.ack("agent.session.ack", { sessionId: p.sessionId, stopped: true });
  }

  private forceLock() {
    this.session = null;
    this.setState({ kind: "locked" });
    void agentBridge?.lock();
  }

  private allowUnlock() {
    if (this.session) {
      this.setState({
        kind: "active",
        sessionId: this.session.id,
        endsAt: this.session.endsAt,
        userDisplayName: this.session.userDisplayName,
      });
      void agentBridge?.unlock();
    }
  }

  private startHeartbeat() {
    this.heartbeat = setInterval(() => {
      const payload: AgentHeartbeatPayload = {
        branchId: this.config.branchId,
        pcId: this.config.pcId,
        ts: Date.now(),
        state: this.heartbeatState(),
        sessionId: this.session?.id,
        remainingSec: this.session ? Math.floor(this.session.remainingMs() / 1_000) : undefined,
      };
      this.send("agent.heartbeat", payload);
    }, HEARTBEAT_MS);
  }

  private startTick() {
    this.tick = setInterval(() => {
      if (!this.session) return;
      const remaining = this.session.remainingMs();
      this.emitter.emit("remaining", remaining);
      if (remaining <= 0) {
        this.onSessionStop({ sessionId: this.session.id, reason: "expired" });
      } else if (remaining <= EXPIRING_THRESHOLD_MS && this.state.kind === "active") {
        this.setState({ kind: "expiring", sessionId: this.session.id, endsAt: this.session.endsAt });
      }
    }, TICK_MS);
  }

  private heartbeatState(): AgentHeartbeatPayload["state"] {
    if (this.state.kind === "active" || this.state.kind === "expiring") return "active";
    if (this.state.kind === "locked") return "locked";
    return "idle";
  }

  private sendHello() {
    const payload: AgentHelloPayload = {
      branchId: this.config.branchId,
      pcId: this.config.pcId,
      pcLabel: this.config.pcLabel,
      agentVersion: this.agentVersion,
      machineId: this.machineId,
    };
    this.send("agent.hello", payload);
  }

  private sendPong(originalId: string) {
    this.send("pong", { ackOf: originalId });
  }

  private ack<T>(kind: AgentEvent["kind"], payload: T) { this.send(kind, payload); }

  private send<T>(kind: AgentEvent["kind"], payload: T) {
    this.transport.send<T>({ v: PROTOCOL_VERSION, id: newId(), kind, ts: Date.now(), payload });
  }

  private setState(next: AgentState) {
    this.state = next;
    this.emitter.emit("state", next);
  }
}
