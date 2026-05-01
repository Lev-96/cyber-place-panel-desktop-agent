import { agentBridge, AgentConfigJson } from "@/infrastructure/AgentBridge";
import { agentConfig } from "@/infrastructure/AgentConfig";
import { createTransport } from "@/transport/TransportFactory";
import { SessionManager } from "./SessionManager";

export interface BootResult {
  manager: SessionManager;
  config: AgentConfigJson;
}

/** Call when config exists. Wires transport + manager and returns the running manager. */
export const bootstrapAgent = async (config: AgentConfigJson): Promise<BootResult> => {
  await agentConfig.save(config);
  const machineId = (await agentBridge?.getMachineId()) ?? "web-dev";
  const version = (await agentBridge?.getAppVersion()) ?? "0.0.0-dev";
  const transport = createTransport(config);
  const manager = new SessionManager(transport, config, machineId, version);
  await manager.start();
  return { manager, config };
};
