/**
 * Bridge to the Electron main process.
 * Renderer cannot read/write disk, lock screen, or auto-launch directly —
 * it goes through preload's contextBridge.
 */
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
