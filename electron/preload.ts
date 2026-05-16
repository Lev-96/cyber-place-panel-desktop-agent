import { contextBridge, ipcRenderer } from "electron";

interface AgentConfigJson {
  serverUrl: string;
  branchId: number;
  pcId: number;
  pcLabel: string;
  pairingToken?: string;
}

contextBridge.exposeInMainWorld("agentAPI", {
  getConfig: (): Promise<AgentConfigJson | null> => ipcRenderer.invoke("agent:getConfig"),
  saveConfig: (c: AgentConfigJson): Promise<void> => ipcRenderer.invoke("agent:saveConfig", c),
  lock: (): Promise<void> => ipcRenderer.invoke("agent:lock"),
  unlock: (): Promise<void> => ipcRenderer.invoke("agent:unlock"),
  shutdown: (): Promise<void> => ipcRenderer.invoke("agent:shutdown"),
  getMachineId: (): Promise<string> => ipcRenderer.invoke("agent:getMachineId"),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("agent:getAppVersion"),
});

// Auto-update bridge — same shape as panel's `window.cyberplaceUpdates`
// so the renderer code is portable. `getState()` pulls the current
// state on mount; `onState(cb)` subscribes to the push stream and
// returns the unsubscribe fn; `install()` triggers quitAndInstall.
contextBridge.exposeInMainWorld("cyberplaceUpdates", {
  check: () => ipcRenderer.invoke("updates:check"),
  install: () => ipcRenderer.invoke("updates:install"),
  getState: () => ipcRenderer.invoke("updates:getState"),
  onState: (cb: (state: unknown) => void) => {
    const listener = (_e: unknown, state: unknown) => cb(state);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },
});
