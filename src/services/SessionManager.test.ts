import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentState } from "@/domain/AgentState";
import { AgentEvent, ServerCommand } from "@/protocol/Messages";
import { ITransport, TransportStatus } from "@/transport/ITransport";
import { SessionManager } from "@/services/SessionManager";

/**
 * The session state machine on a kiosk.
 *
 * This is the first test in this repository, and the reason it exists is a bug
 * that shipped past a clean typecheck and a clean build: a session switched to
 * unlimited from the panel arrives as `session.update` with `endsAt: null`, and
 * that case was dismissed as "rare" and returned on. The countdown kept running
 * against the OLD end, expired, and locked the workstation — under a player
 * whose session had explicitly been given no end, on a machine a cashier then
 * had to unlock by hand.
 *
 * Nothing about that is visible to a compiler. It is a branch that does the
 * wrong thing, and only running it says so.
 */

/** A transport that hands commands straight to the manager and records sends. */
class FakeTransport implements ITransport {
  private commandHandlers: Array<(c: ServerCommand) => void> = [];
  private statusHandlers: Array<(s: TransportStatus) => void> = [];
  readonly sent: AgentEvent<unknown>[] = [];

  async connect(): Promise<void> {
    this.statusHandlers.forEach((h) => h("connected"));
  }
  close(): void {}
  send<T>(event: AgentEvent<T>): void {
    this.sent.push(event as AgentEvent<unknown>);
  }
  onCommand(handler: (cmd: ServerCommand) => void): () => void {
    this.commandHandlers.push(handler);
    return () => {};
  }
  onStatus(handler: (s: TransportStatus) => void): () => void {
    this.statusHandlers.push(handler);
    return () => {};
  }
  status(): TransportStatus {
    return "connected";
  }

  /** Deliver a command as the server would. */
  deliver(cmd: ServerCommand): void {
    this.commandHandlers.forEach((h) => h(cmd));
  }
}

const command = (kind: string, payload: unknown): ServerCommand =>
  ({ id: `c-${Math.random()}`, kind, payload }) as unknown as ServerCommand;

describe("a session with no end", () => {
  let transport: FakeTransport;
  let manager: SessionManager;
  let states: AgentState[];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T14:00:00.000Z"));

    transport = new FakeTransport();
    manager = new SessionManager(
      transport,
      { branchId: 1, pcId: 1, pcLabel: "№1" } as never,
      "machine-1",
      "1.0.0",
    );
    states = [];
    manager.on("state", (s) => states.push(s));
    await manager.start();
  });

  const startFixedSession = () => {
    transport.deliver(command("session.start", {
      sessionId: 7,
      startedAt: "2026-09-03T14:00:00.000Z",
      endsAt: "2026-09-03T15:00:00.000Z",
      user: null,
      packageName: "One hour",
      mode: "fixed",
    }));
    // The agent is `locked` before any session — that is the kiosk at rest,
    // not a lock this test caused. Only what happens AFTER the session starts
    // is evidence about the session.
    states.length = 0;
  };

  /**
   * The bug, exactly. Switch to unlimited, then run the clock past the old
   * end: the workstation must still be unlocked.
   */
  it("is not expired when the clock passes the end it used to have", () => {
    startFixedSession();
    expect(manager.current().kind).toBe("active");

    transport.deliver(command("session.update", { sessionId: 7, endsAt: null }));

    // Ten minutes past the hour it was sold.
    vi.setSystemTime(new Date("2026-09-03T15:10:00.000Z"));
    vi.advanceTimersByTime(5_000);

    expect(manager.current().kind).toBe("active");
    expect(states.some((s) => s.kind === "locked")).toBe(false);
  });

  /** …and it stops counting down rather than showing a stale one. */
  it("reports no remaining time instead of the old countdown", () => {
    startFixedSession();
    transport.deliver(command("session.update", { sessionId: 7, endsAt: null }));

    const remaining: Array<number | null> = [];
    manager.on("remaining", (r) => remaining.push(r));
    vi.advanceTimersByTime(1_000);

    expect(remaining.at(-1)).toBeNull();
  });

  /**
   * A session already inside the last minute is in the `expiring` warning
   * state. Lifting the ceiling has to take it out of there — a session with no
   * end can never be about to expire, and the warning would otherwise sit on
   * screen for the rest of the evening.
   */
  it("leaves the expiring warning when the ceiling is lifted", () => {
    transport.deliver(command("session.start", {
      sessionId: 8,
      startedAt: "2026-09-03T14:00:00.000Z",
      endsAt: "2026-09-03T14:00:30.000Z",
      user: null,
      packageName: "Short",
      mode: "fixed",
    }));
    vi.advanceTimersByTime(1_000);
    expect(manager.current().kind).toBe("expiring");

    transport.deliver(command("session.update", { sessionId: 8, endsAt: null }));

    expect(manager.current().kind).toBe("active");
    expect((manager.current() as { endsAt: Date | null }).endsAt).toBeNull();
  });

  /** Extending as usual is untouched by any of the above. */
  it("still moves the end forward on an ordinary extension", () => {
    startFixedSession();

    transport.deliver(command("session.update", {
      sessionId: 7,
      endsAt: "2026-09-03T16:00:00.000Z",
    }));

    const state = manager.current() as { kind: string; endsAt: Date | null };
    expect(state.kind).toBe("active");
    expect(state.endsAt?.toISOString()).toBe("2026-09-03T16:00:00.000Z");
  });

  /** An update for a different session is not this session's business. */
  it("ignores an update addressed to another session", () => {
    startFixedSession();

    transport.deliver(command("session.update", { sessionId: 999, endsAt: null }));

    const state = manager.current() as { endsAt: Date | null };
    expect(state.endsAt?.toISOString()).toBe("2026-09-03T15:00:00.000Z");
  });

  /**
   * The older half of the same contract: a session STARTED with no end (the
   * count-up mode a cashier picks for a console) must not lock instantly.
   * `new Date(null)` is 1970, and that is what it used to do.
   */
  it("does not lock a session that was started with no end at all", () => {
    transport.deliver(command("session.start", {
      sessionId: 9,
      startedAt: "2026-09-03T14:00:00.000Z",
      endsAt: null,
      user: null,
      packageName: "Open",
      mode: "open",
    }));
    states.length = 0;

    vi.advanceTimersByTime(10_000);

    expect(manager.current().kind).toBe("active");
    expect(states.some((s) => s.kind === "locked")).toBe(false);
  });
});
