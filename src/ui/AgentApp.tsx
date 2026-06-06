import { AgentState } from "@/domain/AgentState";
import { AgentRuntimeConfig, AgentStoredConfig } from "@/infrastructure/AgentBridge";
import { agentConfig } from "@/infrastructure/AgentConfig";
import { pinCache } from "@/infrastructure/PinCache";
import { bootstrapAgent, refreshIdentity } from "@/services/AgentBootstrap";
import { SessionManager } from "@/services/SessionManager";
import { TransportStatus } from "@/transport/ITransport";
import { useEffect, useState } from "react";
import ActiveScreen from "./ActiveScreen";
import LockScreen from "./LockScreen";
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
      // Stash the hash for offline rescue (no-op when null).
      pinCache.save(boot.config.unlockPinHash);
      detachers.push(manager.on("state", setState));
      detachers.push(manager.on("remaining", setRemaining));
      // Live transport connectivity, re-emitted by the manager. Drives the
      // status pill and the LockScreen's online/offline PIN path.
      detachers.push(manager.on("status", setStatus));
    })();

    return () => {
      for (const d of detachers) d();
      manager?.stop();
    };
  }, [stored]);

  // Periodic /agent/hello refresh. Without this an already-running
  // kiosk would never pick up a PIN set in the panel AFTER it booted —
  // its cached unlock_pin_hash would stay null forever. 60s is the
  // tradeoff between "PIN rotation propagates fast" and "we don't
  // hammer the backend with HTTP calls per kiosk per minute".
  useEffect(() => {
    if (!stored) return;
    const id = setInterval(() => {
      void refreshIdentity(stored.pairingToken).then((fresh) => {
        if (fresh) {
          setRuntime(fresh);
          // Keep the offline-rescue cache current with rotations.
          pinCache.save(fresh.unlockPinHash);
        }
      });
    }, 60_000);
    return () => clearInterval(id);
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
    // "offline" and "locked" both render the lock screen so the emergency
    // PIN pad stays reachable without network — the status pill shows the
    // lost connection, and the PIN is verified against the local cache.
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
