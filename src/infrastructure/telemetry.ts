import { logger } from "@/infrastructure/Logger";

/**
 * Kiosk-side telemetry reporter.
 *
 * Feeds the admin panel's "Мониторинг · Десктоп-агент" section, which is the
 * only window anyone has into a machine sitting in a venue with nobody looking
 * at it. That makes the reliability contract stricter here than anywhere else:
 *
 *  - A kiosk in a paid session must never be slowed, blocked or crashed by
 *    reporting. Every path is wrapped and nothing is ever awaited by the
 *    caller.
 *  - A backend outage must not accumulate. The queue is capped and drops the
 *    OLDEST events, and a failed flush is discarded rather than retried — an
 *    agent that runs for weeks would otherwise turn one bad hour into an
 *    ever-growing backlog and a thundering herd on reconnect.
 *  - The install id is random and local. It identifies a machine's
 *    installation, never a player.
 */

const STORAGE_KEY = "cyberplace.agent.install_id";
const FLUSH_INTERVAL_MS = 60_000; // kiosks are chatty; report on a slow clock
const MAX_QUEUE = 60;
const MAX_BATCH = 25;

interface QueuedEvent {
  event: string;
  name?: string;
  level: "info" | "warn" | "error";
  app_version: string;
  platform: string;
  occurred_at: string;
  payload?: Record<string, unknown>;
}

let queue: QueuedEvent[] = [];
let serverUrl: string | null = null;
let branchId: number | null = null;
let started = false;

const version = (): string => {
  try { return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"; } catch { return "dev"; }
};

const platform = (): string => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(ua)) return "win32";
  if (/Mac OS/i.test(ua)) return "darwin";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
};

const installId = (): string => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;

    const minted =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    localStorage.setItem(STORAGE_KEY, minted);
    return minted;
  } catch {
    // Storage unavailable: report under a per-run id rather than not at all.
    return `a-ephemeral-${Math.random().toString(36).slice(2, 10)}`;
  }
};

export const trackAgent = (
  event: string,
  options: { name?: string; level?: "info" | "warn" | "error"; payload?: Record<string, unknown> } = {},
): void => {
  try {
    queue.push({
      event,
      name: options.name,
      level: options.level ?? "info",
      app_version: version(),
      platform: platform(),
      occurred_at: new Date().toISOString(),
      payload: options.payload,
    });

    if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
  } catch { /* never throw into a caller */ }
};

export const trackAgentError = (name: string, message: string): void => {
  trackAgent("error", { name, level: "error", payload: { message: message.slice(0, 500) } });
};

const flush = async (): Promise<void> => {
  if (queue.length === 0 || !serverUrl) return;

  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);
  const id = installId();

  try {
    await fetch(`${serverUrl.replace(/\/$/, "")}/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        app: "agent",
        branch_id: branchId ?? undefined,
        events: batch.map((e) => ({ ...e, install_id: id })),
      }),
      keepalive: true,
    });
  } catch (e) {
    // Dropped deliberately — see the note at the top of this file.
    logger.warn("telemetry flush failed", e);
  }
};

/**
 * Begin reporting once the agent knows which backend it belongs to.
 * Idempotent; safe to call again after a re-pair (it just refreshes context).
 */
export const startAgentTelemetry = (url: string, branch: number | null): void => {
  serverUrl = url;
  branchId = branch;

  if (started) return;
  started = true;

  trackAgent("app.launch");

  const timer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
  (timer as unknown as { unref?: () => void }).unref?.();

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => { void flush(); });
    window.addEventListener("error", (e) => {
      trackAgentError(e.error?.name ?? "Error", e.message ?? "unknown");
    });
    window.addEventListener("unhandledrejection", (e) => {
      const reason = e.reason as { name?: string; message?: string } | undefined;
      trackAgentError(reason?.name ?? "UnhandledRejection", reason?.message ?? String(e.reason ?? "unknown"));
    });
  }
};
