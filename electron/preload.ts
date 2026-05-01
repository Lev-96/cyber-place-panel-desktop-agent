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
