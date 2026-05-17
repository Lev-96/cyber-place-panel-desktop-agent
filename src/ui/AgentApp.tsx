import { AgentState } from "@/domain/AgentState";
import { AgentRuntimeConfig, AgentStoredConfig } from "@/infrastructure/AgentBridge";
import { agentConfig } from "@/infrastructure/AgentConfig";
import { bootstrapAgent } from "@/services/AgentBootstrap";
import { SessionManager } from "@/services/SessionManager";
import { TransportStatus } from "@/transport/ITransport";
import { useEffect, useState } from "react";
import ActiveScreen from "./ActiveScreen";
import LockScreen from "./LockScreen";
import OfflineScreen from "./OfflineScreen";
import SetupScreen from "./SetupScreen";
import UpdateReadyModal from "./UpdateReadyModal";

const AgentApp = () => {
  // Stored = what's on disk (just the pairing token).
  // Runtime = identity (branch/PC/PIN hash) resolved via /agent/hello on boot.
  const [stored, setStored] = useState<AgentStoredConfig | null>(null);
  const [runtime, setRuntime] = useState<AgentRuntimeConfig | null>(null);
  const [state, setState] = useState<AgentState>({ kind: "boot" });
  const [status, setStatus] = useState<TransportStatus>("disconnected");
  // null = open-mode session with no countdown; 0 = no session at all;
  // positive = ms left on a fixed-tariff session.
  const [remaining, setRemaining] = useState<number | null>(0);

  useEffect(() => {
    void agentConfig.load().then((c) => {
      if (!c) { setState({ kind: "setup" }); return; }
      setStored(c);
    });
  }, []);

  useEffect(() => {
    if (!stored) return;
    let manager: SessionManager | null = null;
    let detachers: Array<() => void> = [];

    void (async () => {
      const boot = await bootstrapAgent(stored);
      manager = boot.manager;
      setRuntime(boot.config);
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
  }, [stored]);

  const screen = (() => {
    if (state.kind === "setup" || (!stored && state.kind === "boot")) {
      return <SetupScreen onSubmit={(c) => { setStored(c); setState({ kind: "connecting" }); }} initial={stored} />;
    }
    if (!runtime) return <div className="full"><div className="muted">Starting…</div></div>;

    if (state.kind === "active" || state.kind === "expiring") {
      return (
        <ActiveScreen
          config={runtime}
          status={status}
          remainingMs={remaining}
          userDisplayName={state.kind === "active" ? state.userDisplayName : undefined}
          expiring={state.kind === "expiring"}
        />
      );
    }
    if (state.kind === "offline") return <OfflineScreen config={runtime} />;
    return <LockScreen config={runtime} status={status} />;
  })();

  // Modal mounted as a sibling so it overlays whichever screen is
  // active. During an active session the agent window is opacity-0
  // + click-through so the modal is invisible to the player; when
  // the session ends and the lock screen comes back, the modal
  // surfaces on top of it.
  return (
    <>
      {screen}
      <UpdateReadyModal />
    </>
  );
};

export default AgentApp;
