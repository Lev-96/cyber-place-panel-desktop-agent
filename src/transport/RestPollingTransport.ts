import { logger } from "@/infrastructure/Logger";
import { TypedEventEmitter } from "@/infrastructure/TypedEventEmitter";
import { AgentEvent, AgentHeartbeatPayload, PROTOCOL_VERSION, ServerCommand } from "@/protocol/Messages";
import { ITransport, TransportStatus } from "./ITransport";

interface Events {
  command: ServerCommand;
  status: TransportStatus;
}

export interface RestPollingOptions {
  baseUrl: string;
  pairingToken: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxBackoffMs?: number;
}

/**
 * REST polling transport. Talks to Laravel backend over plain HTTP:
 *   GET  /agent/poll-commands       — fetch queued commands
 *   POST /agent/heartbeat           — report state
 *   POST /agent/commands/{id}/ack   — acknowledge a delivered command
 *
 * Heartbeats are buffered: the latest one wins. Acks are best-effort fire-and-forget.
 * Used when no WebSocket server is available — agent stays functional with ~2s latency.
 */
export class RestPollingTransport implements ITransport {
  private emitter = new TypedEventEmitter<Events>();
  private state: TransportStatus = "disconnected";
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private running = false;
  private latestHeartbeat: AgentHeartbeatPayload | null = null;
  private deliveredIds = new Set<string>();

  constructor(private opts: RestPollingOptions) {}

  async connect(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.setStatus("connecting");
    try {
      const ok = await this.fetch("/agent/hello", { method: "GET" });
      if (ok) this.setStatus("connected");
      else this.setStatus("error");
    } catch {
      this.setStatus("error");
    }
    this.scheduleNextPoll(0);
    this.scheduleNextHeartbeat(0);
  }

  close(): void {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.pollTimer = this.heartbeatTimer = null;
    this.setStatus("disconnected");
  }

  send<T>(event: AgentEvent<T>): void {
    if (event.kind === "agent.heartbeat") {
      this.latestHeartbeat = event.payload as unknown as AgentHeartbeatPayload;
      return;
    }
    // Other events (hello/pong/ack) we don't currently push as separate REST calls —
    // hello is implicit via /hello on connect; acks are sent inside the poll loop.
  }

  onCommand(handler: (cmd: ServerCommand) => void) { return this.emitter.on("command", handler); }
  onStatus(handler: (s: TransportStatus) => void) { return this.emitter.on("status", handler); }
  status(): TransportStatus { return this.state; }

  private scheduleNextPoll(delay: number) {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.pollOnce(), delay);
  }

  private scheduleNextHeartbeat(delay: number) {
    if (!this.running) return;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => void this.heartbeatOnce(), delay);
  }

  private async pollOnce() {
    if (!this.running) return;
    try {
      const res = await this.fetch("/agent/poll-commands", { method: "GET" });
      if (res && Array.isArray(res.commands)) {
        for (const c of res.commands as ServerCommand[]) {
          if (this.deliveredIds.has(c.id)) continue;
          this.deliveredIds.add(c.id);
          this.emitter.emit("command", { ...c, v: PROTOCOL_VERSION });
          void this.fetch(`/agent/commands/${encodeURIComponent(c.id)}/ack`, { method: "POST" });
        }
        if (this.deliveredIds.size > 500) {
          // Trim to keep memory bounded.
          this.deliveredIds = new Set(Array.from(this.deliveredIds).slice(-200));
        }
      }
      if (this.state !== "connected") this.setStatus("connected");
      this.failures = 0;
    } catch (e) {
      this.failures += 1;
      if (this.state !== "error") this.setStatus("error");
      logger.warn("poll failed", e);
    }
    this.scheduleNextPoll(this.nextDelay(this.opts.pollIntervalMs ?? 2_000));
  }

  private async heartbeatOnce() {
    if (!this.running) return;
    if (this.latestHeartbeat) {
      try {
        await this.fetch("/agent/heartbeat", { method: "POST", body: this.latestHeartbeat });
      } catch (e) {
        logger.warn("heartbeat failed", e);
      }
    }
    this.scheduleNextHeartbeat(this.opts.heartbeatIntervalMs ?? 5_000);
  }

  private nextDelay(base: number): number {
    if (this.failures === 0) return base;
    const max = this.opts.maxBackoffMs ?? 30_000;
    return Math.min(base * 2 ** this.failures, max);
  }

  private async fetch(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<any> {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Authorization": `Bearer ${this.opts.pairingToken}`,
      // Bypass ngrok-free.app browser-warning interstitial when backend is tunneled via ngrok.
      "ngrok-skip-browser-warning": "1",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  private setStatus(s: TransportStatus) {
    if (this.state === s) return;
    this.state = s;
    this.emitter.emit("status", s);
  }
}
