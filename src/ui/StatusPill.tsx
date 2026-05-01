import { TransportStatus } from "@/transport/ITransport";

const labels: Record<TransportStatus, string> = {
  connected: "Online",
  connecting: "Connecting…",
  disconnected: "Offline",
  error: "Connection error",
};

const StatusPill = ({ status }: { status: TransportStatus }) => (
  <span className={`status-pill ${status === "disconnected" ? "offline" : status}`}>
    {labels[status]}
  </span>
);

export default StatusPill;
