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
      getConfig(): Promise<AgentConfigJson | null>;
      saveConfig(c: AgentConfigJson): Promise<void>;

      lock(): Promise<void>;
      unlock(): Promise<void>;
      shutdown(): Promise<void>;

      getMachineId(): Promise<string>;
      getAppVersion(): Promise<string>;
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

export interface AgentConfigJson {
  serverUrl: string;
  branchId: number;
  pcId: number;
  pcLabel: string;
  pairingToken?: string;
}

export const agentBridge = (() => {
  if (typeof window !== "undefined" && window.agentAPI) return window.agentAPI;
  return null;
})();
