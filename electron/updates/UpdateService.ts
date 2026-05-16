import { app, BrowserWindow } from "electron";
import log from "electron-log";
import { autoUpdater, type UpdateInfo, type ProgressInfo } from "electron-updater";

/**
 * Agent's auto-update lifecycle. Mirrors the panel's UpdateService in
 * shape (same status codes, same state object) so any reporting tool
 * can read both products with one schema. The behavioural difference
 * is the install-timing policy: a kiosk that's currently driving a
 * paid gaming session MUST NOT quitAndInstall — that would yank the
 * player off the seat mid-game. So the service buffers a downloaded
 * update and only installs it during the idle/locked window.
 *
 * As of v1.0.4 the install timing is operator-driven: the renderer
 * shows a non-closeable "update ready" modal on the lock screen and
 * the cashier clicks "Restart" to apply. Auto-install on lock was
 * removed so the UX matches the panel exactly. Safety net:
 * `autoInstallOnAppQuit = true` still applies the update on the next
 * power cycle / reboot if the cashier never gets to the modal.
 *
 * Renderer surface: state transitions are fanned out via the
 * `onState()` subscription so the preload bridge can mirror them to
 * `window.cyberplaceUpdates`. Same shape as the panel UpdateService
 * on purpose — a future shared package can be lifted out of both.
 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "deferred"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  error: string | null;
}

export class AgentUpdateService {
  private state: UpdateState;
  private listeners = new Set<(state: UpdateState) => void>();
  /**
   * Backstop polling cadence. `electron-updater`'s GitHub provider
   * does NOT auto-poll; calling `checkForUpdates()` is up to us. Ten
   * minutes is long enough to avoid hammering GitHub's anonymous rate
   * limit (60/hr) even across hundreds of partner kiosks, and short
   * enough that a missed Reverb broadcast (which agents currently
   * don't subscribe to) still surfaces a promote within ~10 min.
   */
  private static readonly POLL_INTERVAL_MS = 10 * 60 * 1000;
  /**
   * Initial check delay after boot so app startup is not blocked by
   * network IO. Same heuristic as the panel.
   */
  private static readonly BOOT_CHECK_DELAY_MS = 5_000;

  private pollHandle: NodeJS.Timeout | null = null;

  constructor() {
    this.state = {
      status: "idle",
      currentVersion: app.getVersion(),
      availableVersion: null,
      progressPercent: null,
      error: null,
    };
    this.configure();
    this.bindAutoUpdaterEvents();
  }

  /**
   * Wire boot + periodic checks. Called once from `app.whenReady`.
   * No-op in dev (no published artifacts to fetch).
   */
  startPolling(): void {
    if (!app.isPackaged) {
      log.info("[agent-updater] dev mode — auto-update disabled");
      return;
    }
    setTimeout(() => { void this.check(); }, AgentUpdateService.BOOT_CHECK_DELAY_MS);
    this.pollHandle = setInterval(
      () => { void this.check(); },
      AgentUpdateService.POLL_INTERVAL_MS,
    );
  }

  /**
   * Stop the periodic poll. Used on app quit so the timer doesn't
   * keep an unreffed handle alive during shutdown.
   */
  stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /**
   * Install the previously downloaded update and restart the agent.
   * Operator-driven: called from the renderer's modal "Restart"
   * button via the `updates:install` IPC channel. No-op when the
   * state is anything other than `downloaded` — protects against a
   * double-click while the install is already underway.
   */
  installAndRestart(): void {
    if (this.state.status !== "downloaded") {
      log.warn(`[agent-updater] installAndRestart called in status=${this.state.status}; ignoring`);
      return;
    }
    log.info(`[agent-updater] operator clicked Restart → quitAndInstall into v${this.state.availableVersion}`);
    autoUpdater.quitAndInstall(false, true);
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  /**
   * Subscribe to every state transition. Returns the unsubscribe fn
   * so callers can clean up on shutdown. Used by main.ts to forward
   * state to renderer windows over the `updates:state` IPC channel.
   */
  onState(fn: (state: UpdateState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async check(): Promise<void> {
    if (this.state.status === "checking" || this.state.status === "downloading") return;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e: unknown) {
      this.handleError(e);
    }
  }

  private configure(): void {
    autoUpdater.autoDownload = true;
    // Install timing is now operator-driven via the renderer modal,
    // but keep `autoInstallOnAppQuit = true` as a safety net: if the
    // kiosk PC is restarted (power cycle, scheduled reboot) between
    // download and the operator clicking "Restart", the new version
    // installs on next start without intervention.
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = log;
    log.transports.file.level = "info";
  }

  private bindAutoUpdaterEvents(): void {
    autoUpdater.on("checking-for-update", () => {
      this.update({ status: "checking", error: null });
    });
    autoUpdater.on("update-available", (info: UpdateInfo) => {
      this.update({
        status: "available",
        availableVersion: info.version,
        progressPercent: 0,
      });
    });
    autoUpdater.on("update-not-available", () => {
      this.update({ status: "not-available", availableVersion: null });
    });
    autoUpdater.on("download-progress", (info: ProgressInfo) => {
      this.update({ status: "downloading", progressPercent: Math.round(info.percent) });
    });
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      this.update({ status: "downloaded", availableVersion: info.version, progressPercent: 100 });
      // No auto-install. The renderer modal shows up on the next
      // lock screen render (window is invisible during gameplay
      // anyway) and the operator clicks Restart to apply.
    });
    autoUpdater.on("error", (err: Error) => this.handleError(err));
  }

  private update(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    log.info("[agent-updater] state →", this.state);
    for (const fn of this.listeners) {
      try { fn(this.state); } catch (e) { log.error("AgentUpdateService listener threw", e); }
    }
  }

  private handleError(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    log.error("[agent-updater] error:", message);
    this.update({ status: "error", error: message });
  }
}

/**
 * Broadcast the given state to every BrowserWindow's webContents.
 * Kept outside the class so tests can wire a different transport
 * without monkey-patching the service. Mirror of the panel helper.
 */
export const broadcastUpdateState = (state: UpdateState): void => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send("updates:state", state);
    }
  }
};
