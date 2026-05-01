import { AgentConfigJson } from "@/infrastructure/AgentBridge";
import { TransportStatus } from "@/transport/ITransport";
import StatusPill from "./StatusPill";

interface Props {
  config: AgentConfigJson;
  status: TransportStatus;
  remainingMs: number;
  userDisplayName?: string;
  expiring: boolean;
}

const fmt = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

const ActiveScreen = ({ config, status, remainingMs, userDisplayName, expiring }: Props) => {
  const cls = remainingMs <= 30_000 ? "timer crit" : expiring ? "timer warn" : "timer";
  return (
    <div className="full">
      <StatusPill status={status} />
      <div className="brand">CYBER PLACE</div>
      <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <div className="muted">{userDisplayName ? `Welcome, ${userDisplayName}` : "Session in progress"}</div>
        <div className={cls}>{fmt(remainingMs)}</div>
        <div className="muted">{config.pcLabel} · ask cashier to extend before time ends</div>
      </div>
    </div>
  );
};

export default ActiveScreen;
