import { agentBridge, AgentStoredConfig } from "./AgentBridge";

/**
 * Thin persistence wrapper around the Electron-managed config file.
 * Only stores the pairing token — every other identity field is
 * resolved from the server at boot via /agent/hello, so we never need
 * to read them back from disk and never need to keep them in sync.
 *
 * Legacy on-disk configs may still contain `serverUrl`, `branchId`,
 * `pcId`, `pcLabel`. The reader tolerates those keys (we only pluck
 * `pairingToken`); the writer never emits them, so a single save call
 * naturally migrates the file to the new shape.
 */
export class AgentConfig {
  private cached: AgentStoredConfig | null = null;

  async load(): Promise<AgentStoredConfig | null> {
    if (this.cached) return this.cached;
    if (!agentBridge) {
      const raw = window.localStorage.getItem("agent.config");
      this.cached = raw ? this.normalize(JSON.parse(raw)) : null;
      return this.cached;
    }
    const stored = await agentBridge.getConfig();
    this.cached = this.normalize(stored);
    return this.cached;
  }

  async save(c: AgentStoredConfig): Promise<void> {
    this.cached = { pairingToken: c.pairingToken };
    if (!agentBridge) {
      window.localStorage.setItem("agent.config", JSON.stringify(this.cached));
      return;
    }
    await agentBridge.saveConfig(this.cached);
  }

  isConfigured(c: AgentStoredConfig | null): c is AgentStoredConfig {
    return !!c && typeof c.pairingToken === "string" && c.pairingToken.length > 0;
  }

  /**
   * Defensive read — old configs had `branchId/pcId/serverUrl/pcLabel`
   * fields that we now strip. Anything without a pairing token is
   * treated as "not configured" (will route to SetupScreen).
   */
  private normalize(raw: unknown): AgentStoredConfig | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const token = typeof obj.pairingToken === "string" ? obj.pairingToken : "";
    if (token.length === 0) return null;
    return { pairingToken: token };
  }
}

export const agentConfig = new AgentConfig();
