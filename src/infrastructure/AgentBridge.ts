/**
 * Bridge to the Electron main process.
 * Renderer cannot read/write disk, lock screen, or auto-launch directly —
 * it goes through preload's contextBridge.
 */
export type AgentUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "deferred"
  | "error";

export interface AgentUpdateState {
  status: AgentUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  error: string | null;
}

declare global {
  interface Window {
    agentAPI?: {
      getConfig(): Promise<AgentStoredConfig | null>;
      saveConfig(c: AgentStoredConfig): Promise<void>;

      lock(): Promise<void>;
      unlock(): Promise<void>;
      shutdown(): Promise<void>;

      getMachineId(): Promise<string>;
      getAppVersion(): Promise<string>;
      /** Absent on an agent built before 2026-10-12: feature-detect. */
      showSessionWarning?(minutes: number): Promise<void>;
    };
    /**
     * Same bridge name as the panel. Undefined outside the Electron
     * preload (e.g. when running the renderer in a browser tab for
     * dev tooling) — every caller must feature-detect.
     */
    cyberplaceUpdates?: {
      check(): Promise<AgentUpdateState | null>;
      install(): Promise<void>;
      getState(): Promise<AgentUpdateState | null>;
      onState(cb: (state: AgentUpdateState) => void): () => void;
    };
  }
}

/**
 * On-disk persisted config. Intentionally narrow — every other identity
 * field (branch_id, pc_id, label, server URL) is either compile-time
 * (server URL) or resolved at boot from `/agent/hello`. Keeps the setup
 * UI to one field and the kiosk operator from having to know
 * implementation details like numeric IDs.
 *
 * Legacy installations may have additional fields on disk; the bridge
 * tolerates the extras when reading but never writes them back.
 */
export interface AgentStoredConfig {
  pairingToken: string;
}

/**
 * Full runtime config consumed by SessionManager, transport, lock screen,
 * etc. Built once at boot from {@link AgentStoredConfig} + the response
 * of `/agent/hello`. Never written to disk in this shape — that's what
 * {@link AgentStoredConfig} is for.
 *
 * `unlockPinHash` is the bcrypt hash of the branch's emergency unlock
 * PIN (null when the branch hasn't set one). Verified locally on the
 * lock screen so the cashier can rescue a stuck PC even if the network
 * to the panel/server is down.
 */
export interface AgentRuntimeConfig {
  serverUrl: string;
  pairingToken: string;
  branchId: number;
  pcId: number;
  pcLabel: string;
  unlockPinHash: string | null;
  unlockPinUpdatedAt: string | null;
  /**
   * The venue is out of service — an administrator blocked this branch or its
   * company. The kiosk cannot be handed a session while that is true (staff
   * are refused server-side), so this exists to EXPLAIN the closed screen
   * rather than leave a player staring at a PC that looks broken.
   */
  branchBlocked: boolean;
}

export const agentBridge = (() => {
  if (typeof window !== "undefined" && window.agentAPI) return window.agentAPI;
  return null;
})();
