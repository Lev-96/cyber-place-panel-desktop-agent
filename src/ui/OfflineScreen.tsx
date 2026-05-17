import { AgentRuntimeConfig } from "@/infrastructure/AgentBridge";
import BrandMark from "./BrandMark";

const OfflineScreen = ({ config }: { config: AgentRuntimeConfig }) => (
  <div className="full">
    <BrandMark />
    <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
      <h1>Connection lost</h1>
      <p className="hint">Trying to reconnect to the server. Please ask the cashier if this PC is configured correctly.</p>
      <p className="muted">{config.pcLabel} · branch #{config.branchId}</p>
    </div>
  </div>
);

export default OfflineScreen;
