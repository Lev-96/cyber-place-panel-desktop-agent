import { AgentRuntimeConfig } from "@/infrastructure/AgentBridge";
import { TransportStatus } from "@/transport/ITransport";
import BrandMark from "./BrandMark";
import StatusPill from "./StatusPill";

interface Props {
  config: AgentRuntimeConfig;
  status: TransportStatus;
  /**
   * Milliseconds left on a fixed-tariff session, or `null` for
   * open-mode (pay-by-hour) sessions where the cashier stops
   * the session manually and there's no countdown to render.
   */
  remainingMs: number | null;
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
  const isOpenSession = remainingMs === null;
  // Countdown classes are only meaningful for fixed sessions;
  // open sessions get a neutral pill (`timer` baseline) since
  // they never approach "critical" or "warning" — the cashier
  // is the one tracking time, not the agent.
  const cls =
    isOpenSession
      ? "timer"
      : remainingMs <= 30_000
        ? "timer crit"
        : expiring
          ? "timer warn"
          : "timer";
  return (
    <div className="full">
      <StatusPill status={status} />
      <BrandMark />
      <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <div className="muted">{userDisplayName ? `Welcome, ${userDisplayName}` : "Session in progress"}</div>
        {/* Fixed → countdown; open → static "Open" label so the
            player still gets the "session is running" signal but
            isn't shown a misleading 00:00 stuck timer (which is
            what the epoch-on-null bug used to render before the
            domain-level fix). */}
        <div className={cls}>{isOpenSession ? "Open" : fmt(remainingMs)}</div>
        <div className="muted">
          {isOpenSession
            ? `${config.pcLabel} · pay-by-hour, cashier stops the session`
            : `${config.pcLabel} · ask cashier to extend before time ends`}
        </div>
      </div>
    </div>
  );
};

export default ActiveScreen;
