import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEvent, ServerCommand } from "@/protocol/Messages";
import { ITransport, TransportStatus } from "@/transport/ITransport";
import { SessionManager } from "@/services/SessionManager";

/**
 * "Your gaming session ends in N minutes" on the kiosk (2026-10-12). The
 * backend sends `session.ending_soon` once per session end; the agent shows it
 * once, only for the session it is running, only while that session still has
 * an end ahead — never for a stale, foreign or repeated command.
 */

class FakeTransport implements ITransport {
  private commandHandlers: Array<(c: ServerCommand) => void> = [];
  private statusHandlers: Array<(s: TransportStatus) => void> = [];
  readonly sent: AgentEvent<unknown>[] = [];
  async connect(): Promise<void> { this.statusHandlers.forEach((h) => h("connected")); }
  close(): void {}
  send<T>(event: AgentEvent<T>): void { this.sent.push(event as AgentEvent<unknown>); }
  onCommand(handler: (cmd: ServerCommand) => void): () => void { this.commandHandlers.push(handler); return () => {}; }
  onStatus(handler: (s: TransportStatus) => void): () => void { this.statusHandlers.push(handler); return () => {}; }
  status(): TransportStatus { return "connected"; }
  deliver(cmd: ServerCommand): void { this.commandHandlers.forEach((h) => h(cmd)); }
}

const command = (kind: string, payload: unknown): ServerCommand =>
  ({ id: `c-${Math.random()}`, kind, payload }) as unknown as ServerCommand;

const END = "2026-10-12T18:00:00.000Z";

describe("the session ending-soon message", () => {
  let transport: FakeTransport;
  let manager: SessionManager;
  let shown: number[];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T17:00:00.000Z"));
    transport = new FakeTransport();
    manager = new SessionManager(transport, { branchId: 1, pcId: 1, pcLabel: "№1" } as never, "machine-1", "1.0.0");
    shown = [];
    manager.on("warning", (m) => shown.push(m));
    await manager.start();
    transport.deliver(command("session.start", {
      sessionId: 7, startedAt: "2026-10-12T17:00:00.000Z", endsAt: END, user: null, packageName: "Hour", mode: "fixed",
    }));
  });
  afterEach(() => { manager.stop(); vi.useRealTimers(); });

  const warn = (over: Record<string, unknown> = {}) =>
    transport.deliver(command("session.ending_soon", { sessionId: 7, endsAt: END, minutesLeft: 15, ...over }));

  it("is shown once for the running session", () => {
    vi.setSystemTime(new Date("2026-10-12T17:45:00.000Z"));
    warn();
    expect(shown).toEqual([15]);
  });

  it("a re-delivered command (reconnect, retry) is not shown again", () => {
    vi.setSystemTime(new Date("2026-10-12T17:45:00.000Z"));
    warn(); warn(); warn();
    expect(shown).toEqual([15]);
  });

  it("is shown again for a new end after an extension", () => {
    vi.setSystemTime(new Date("2026-10-12T17:45:00.000Z"));
    warn();
    transport.deliver(command("session.update", { sessionId: 7, endsAt: "2026-10-12T18:30:00.000Z" }));
    vi.setSystemTime(new Date("2026-10-12T18:15:00.000Z"));
    warn({ endsAt: "2026-10-12T18:30:00.000Z" });
    expect(shown).toEqual([15, 15]);
  });

  it("says the minutes left on this machine, never more than were sent", () => {
    vi.setSystemTime(new Date("2026-10-12T17:52:30.000Z")); // delivered late: 7.5 min left
    warn();
    expect(shown).toEqual([8]);
  });

  it("another session's command shows nothing", () => {
    vi.setSystemTime(new Date("2026-10-12T17:45:00.000Z"));
    warn({ sessionId: 99 });
    expect(shown).toEqual([]);
  });

  it("a stale command after the session ended shows nothing", () => {
    transport.deliver(command("session.stop", { sessionId: 7, reason: "manual" }));
    warn();
    expect(shown).toEqual([]);
  });

  it("a session that became open-ended shows nothing", () => {
    transport.deliver(command("session.update", { sessionId: 7, endsAt: null }));
    warn();
    expect(shown).toEqual([]);
  });

  it("a malformed minute count shows nothing", () => {
    vi.setSystemTime(new Date("2026-10-12T17:45:00.000Z"));
    for (const bad of [0, -1, 61, 1.5, "15", null]) warn({ minutesLeft: bad });
    expect(shown).toEqual([]);
  });

  it("leaves the session running: no lock, no state change", () => {
    vi.setSystemTime(new Date("2026-10-12T17:45:00.000Z"));
    const before = manager.current();
    warn();
    expect(manager.current()).toEqual(before);
    expect(manager.current().kind).toBe("active");
  });

  // ---- 15 and 5 minutes (2026-10-18) -------------------------------------

  it("the 5-minute warning after the 15-minute one is shown, not taken for a repeat", () => {
    vi.setSystemTime(new Date("2026-10-12T17:45:00.000Z"));
    warn();
    vi.setSystemTime(new Date("2026-10-12T17:55:00.000Z"));
    warn({ minutesLeft: 5 });
    expect(shown).toEqual([15, 5]);
  });

  it("each of the two is shown once however often it is redelivered", () => {
    vi.setSystemTime(new Date("2026-10-12T17:45:00.000Z"));
    warn(); warn();
    vi.setSystemTime(new Date("2026-10-12T17:55:00.000Z"));
    warn({ minutesLeft: 5 }); warn({ minutesLeft: 5 }); warn();
    expect(shown).toEqual([15, 5]);
  });

  it("a warning for the end before an extension is stale and shows nothing", () => {
    transport.deliver(command("session.update", { sessionId: 7, endsAt: "2026-10-12T18:10:00.000Z" }));
    vi.setSystemTime(new Date("2026-10-12T17:56:00.000Z"));
    // Sent for the old 18:00 end, arriving after the extension to 18:10.
    warn({ minutesLeft: 5 });
    expect(shown).toEqual([]);
  });

  it("a warning for a later end whose extension has not arrived yet is shown, with the minutes to that end", () => {
    // This machine still holds 18:00; the backend already moved it to 18:10.
    vi.setSystemTime(new Date("2026-10-12T17:58:00.000Z"));
    warn({ endsAt: "2026-10-12T18:10:00.000Z", minutesLeft: 12 });
    expect(shown).toEqual([12]);
  });
});
