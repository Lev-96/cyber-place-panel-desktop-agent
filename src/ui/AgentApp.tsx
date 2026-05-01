import { AgentState } from "@/domain/AgentState";
import { AgentConfigJson } from "@/infrastructure/AgentBridge";
import { agentConfig } from "@/infrastructure/AgentConfig";
import { bootstrapAgent } from "@/services/AgentBootstrap";
import { SessionManager } from "@/services/SessionManager";
import { TransportStatus } from "@/transport/ITransport";
import { useEffect, useState } from "react";
import ActiveScreen from "./ActiveScreen";
import LockScreen from "./LockScreen";
import OfflineScreen from "./OfflineScreen";
import SetupScreen from "./SetupScreen";

const AgentApp = () => {
  const [config, setConfig] = useState<AgentConfigJson | null>(null);
  const [state, setState] = useState<AgentState>({ kind: "boot" });
  const [status, setStatus] = useState<TransportStatus>("disconnected");
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    void agentConfig.load().then((c) => {
      if (!c) { setState({ kind: "setup" }); return; }
      setConfig(c);
    });
  }, []);

  useEffect(() => {
    if (!config) return;
    let manager: SessionManager | null = null;
    let detachers: Array<() => void> = [];

    void (async () => {
      const boot = await bootstrapAgent(config);
      manager = boot.manager;
      detachers.push(manager.on("state", setState));
      detachers.push(manager.on("remaining", setRemaining));
      // Local mirror of transport status — manager re-emits via state but we
      // still want a transport pill regardless of session state:
      const initial = (manager as unknown as { transport?: { status(): TransportStatus; onStatus(h: (s: TransportStatus) => void): () => void } });
      // Falls back to disconnected if internals aren't exposed (they aren't).
      setStatus(initial?.transport?.status?.() ?? "connecting");
    })();

    return () => {
      for (const d of detachers) d();
      manager?.stop();
    };
  }, [config]);

  if (state.kind === "setup" || (!config && state.kind === "boot")) {
    return <SetupScreen onSubmit={(c) => { setConfig(c); setState({ kind: "connecting" }); }} initial={config} />;
  }
  if (!config) return <div className="full"><div className="muted">Starting…</div></div>;

  if (state.kind === "active" || state.kind === "expiring") {
    return (
      <ActiveScreen
        config={config}
        status={status}
        remainingMs={remaining}
        userDisplayName={state.kind === "active" ? state.userDisplayName : undefined}
        expiring={state.kind === "expiring"}
      />
    );
  }
  if (state.kind === "offline") return <OfflineScreen config={config} />;
  return <LockScreen config={config} status={status} />;
};

export default AgentApp;
