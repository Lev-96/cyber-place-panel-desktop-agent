import { agentBridge, AgentConfigJson } from "./AgentBridge";

export class AgentConfig {
  private cached: AgentConfigJson | null = null;

  async load(): Promise<AgentConfigJson | null> {
    if (this.cached) return this.cached;
    if (!agentBridge) {
      const raw = window.localStorage.getItem("agent.config");
      this.cached = raw ? (JSON.parse(raw) as AgentConfigJson) : null;
      return this.cached;
    }
    this.cached = await agentBridge.getConfig();
    return this.cached;
  }

  async save(c: AgentConfigJson): Promise<void> {
    this.cached = c;
    if (!agentBridge) {
      window.localStorage.setItem("agent.config", JSON.stringify(c));
      return;
    }
    await agentBridge.saveConfig(c);
  }

  isConfigured(c: AgentConfigJson | null): c is AgentConfigJson {
    return !!c && !!c.serverUrl && !!c.branchId && !!c.pcId;
  }
}

export const agentConfig = new AgentConfig();
