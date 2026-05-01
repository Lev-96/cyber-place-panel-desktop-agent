import { AgentConfigJson } from "@/infrastructure/AgentBridge";
import { ITransport } from "./ITransport";
import { MockTransport } from "./MockTransport";
import { RestPollingTransport } from "./RestPollingTransport";

const isMockMode = (): boolean => {
  const flag = import.meta.env.VITE_DEV_MOCK_BACKEND;
  return flag === "true" || flag === "1";
};

/**
 * Default production transport is REST polling because we do not assume a
 * WebSocket server is running on Laravel. To switch to real WebSocket later,
 * import WebSocketTransport here and select it based on server capabilities.
 */
export const createTransport = (config: AgentConfigJson): ITransport => {
  if (isMockMode() || !config.pairingToken) return new MockTransport();
  return new RestPollingTransport({
    baseUrl: config.serverUrl.replace(/\/$/, ""),
    pairingToken: config.pairingToken,
    pollIntervalMs: 2_000,
    heartbeatIntervalMs: 5_000,
    maxBackoffMs: 30_000,
  });
};
