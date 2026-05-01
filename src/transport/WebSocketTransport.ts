import { logger } from "@/infrastructure/Logger";
import { TypedEventEmitter } from "@/infrastructure/TypedEventEmitter";
import { AgentEvent, PROTOCOL_VERSION, ServerCommand } from "@/protocol/Messages";
import { ITransport, TransportStatus } from "./ITransport";

interface Events {
  command: ServerCommand;
  status: TransportStatus;
}

export interface WSOptions {
  url: string;
  authToken?: string;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  heartbeatMs?: number;
}

export class WebSocketTransport implements ITransport {
  private ws: WebSocket | null = null;
  private emitter = new TypedEventEmitter<Events>();
  private state: TransportStatus = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionallyClosed = false;
  private outboundQueue: AgentEvent[] = [];

  constructor(private opts: WSOptions) {}

  async connect(): Promise<void> {
    this.intentionallyClosed = false;
    this.openSocket();
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  send<T>(event: AgentEvent<T>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    } else {
      this.outboundQueue.push(event as AgentEvent);
      if (this.outboundQueue.length > 100) this.outboundQueue.shift();
    }
  }

  onCommand(handler: (cmd: ServerCommand) => void) { return this.emitter.on("command", handler); }
  onStatus(handler: (s: TransportStatus) => void) { return this.emitter.on("status", handler); }
  status(): TransportStatus { return this.state; }

  private openSocket() {
    this.setStatus("connecting");
    const url = this.buildUrl();
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      logger.warn("ws construction failed", e);
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.flushQueue();
      this.startHeartbeat();
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerCommand;
        if (msg.v !== PROTOCOL_VERSION) {
          logger.warn("protocol version mismatch", msg.v);
          return;
        }
        this.emitter.emit("command", msg);
      } catch (e) {
        logger.warn("ws parse error", e);
      }
    };
    this.ws.onerror = () => { this.setStatus("error"); };
    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      if (!this.intentionallyClosed) this.scheduleReconnect();
      else this.setStatus("disconnected");
    };
  }

  private buildUrl(): string {
    if (!this.opts.authToken) return this.opts.url;
    const sep = this.opts.url.includes("?") ? "&" : "?";
    return `${this.opts.url}${sep}token=${encodeURIComponent(this.opts.authToken)}`;
  }

  private scheduleReconnect() {
    this.setStatus("disconnected");
    const base = this.opts.initialBackoffMs ?? 1_000;
    const max = this.opts.maxBackoffMs ?? 30_000;
    const delay = Math.min(base * 2 ** this.reconnectAttempts, max);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    const interval = this.opts.heartbeatMs ?? 5_000;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id: "ka", kind: "agent.heartbeat", ts: Date.now(), payload: { keepalive: true } })); }
        catch { /* ignore */ }
      }
    }, interval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const queue = this.outboundQueue;
    this.outboundQueue = [];
    for (const ev of queue) this.ws.send(JSON.stringify(ev));
  }

  private setStatus(s: TransportStatus) {
    if (this.state === s) return;
    this.state = s;
    this.emitter.emit("status", s);
  }
}
