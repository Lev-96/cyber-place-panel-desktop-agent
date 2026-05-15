import { app } from "electron";
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
 * Lock convention (decided by `main.ts`):
 *   - `locked === true`  → no active session, safe to swap binaries.
 *   - `locked === false` → cashier unlocked for a player; the agent
 *                          window is hidden behind the kiosk overlay
 *                          and the player is currently using the PC.
 *
 * `tryInstallIfLocked()` is the single chokepoint. It's called:
 *   - immediately on `update-downloaded` if locked already, and
 *   - again whenever main.ts sees a lock transition.
 *
 * No renderer surface — agent renderer is a 1×1 hidden overlay during
 * gameplay; we don't expose IPC to it. Reporting back to the operator
 * happens via electron-log file (~/userData/logs/agent.log).
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

  constructor(private isLocked: () => boolean) {
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
   * Re-evaluate the install gate. Called by main.ts whenever the lock
   * state transitions, AND inside the `update-downloaded` handler.
   * Idempotent: when not in `downloaded` or `deferred`, this is a no-op.
   */
  tryInstallIfLocked(): void {
    if (this.state.status !== "downloaded" && this.state.status !== "deferred") return;
    if (!this.isLocked()) {
      // Cashier has the kiosk unlocked — a player is on the seat.
      // Park the update; the next lock transition will retry.
      if (this.state.status !== "deferred") {
        this.update({ status: "deferred" });
      }
      return;
    }
    log.info(`[agent-updater] kiosk locked → quitAndInstall into v${this.state.availableVersion}`);
    autoUpdater.quitAndInstall(false, true);
  }

  getState(): UpdateState {
    return { ...this.state };
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
    // We override default `quitAndInstall` behavior via
    // `tryInstallIfLocked`. Keep `autoInstallOnAppQuit = true` as a
    // safety net: if the kiosk PC happens to be restarted (power
    // cycle, scheduled reboot) between download and install, the new
    // version comes up on next start without our intervention.
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
      // Try the install gate right away — if the kiosk is already
      // locked at download time we install immediately; otherwise the
      // state transitions to `deferred` and waits for the lock event.
      this.tryInstallIfLocked();
    });
    autoUpdater.on("error", (err: Error) => this.handleError(err));
  }

  private update(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    log.info("[agent-updater] state →", this.state);
  }

  private handleError(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    log.error("[agent-updater] error:", message);
    this.update({ status: "error", error: message });
  }
}
