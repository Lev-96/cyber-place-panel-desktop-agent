import { AgentConfigJson } from "@/infrastructure/AgentBridge";

const OfflineScreen = ({ config }: { config: AgentConfigJson }) => (
  <div className="full">
    <div className="brand">CYBER PLACE</div>
    <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
      <h1>Connection lost</h1>
      <p className="hint">Trying to reconnect to the server. Please ask the cashier if this PC is configured correctly.</p>
      <p className="muted">{config.pcLabel} · branch #{config.branchId}</p>
    </div>
  </div>
);

export default OfflineScreen;
