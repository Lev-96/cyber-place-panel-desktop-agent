import { AgentUpdateState } from "@/infrastructure/AgentBridge";
import { useEffect, useState } from "react";

/**
 * Non-closeable "update ready" modal — same UX shape as the panel.
 * Renders inside AgentApp. When the agent is locked the window is
 * fully visible and the cashier sees this overlay; when the agent
 * is unlocked (active session) the whole renderer window runs at
 * opacity-0 + click-through, so this DOM tree is still present but
 * invisible to the player. As soon as the session ends and the
 * kiosk-overlay shows the lock screen again, this modal becomes
 * the topmost surface — exactly when the operator can act on it.
 *
 * Non-closeable means: no ESC handler, no backdrop dismiss, no
 * close X, no `onClose` prop. The only way forward is the Restart
 * button — which invokes `quitAndInstall(false, true)` in the main
 * process.
 */
const UpdateReadyModal = () => {
  const [state, setState] = useState<AgentUpdateState | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.cyberplaceUpdates) return;
    let mounted = true;

    window.cyberplaceUpdates
      .getState()
      .then((s) => { if (mounted && s) setState(s); })
      .catch(() => { /* bridge gone */ });

    const unsub = window.cyberplaceUpdates.onState((s) => {
      if (mounted) setState(s);
    });

    return () => { mounted = false; unsub?.(); };
  }, []);

  if (state?.status !== "downloaded") return null;

  const version = state.availableVersion ?? "?";

  const onRestart = () => {
    if (restarting) return;
    setRestarting(true);
    // No await — main process calls quitAndInstall and the agent
    // dies immediately. The flag just disables the button so an
    // accidental double-click doesn't fire two install calls.
    void window.cyberplaceUpdates?.install();
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cp-agent-update-title"
      style={backdropStyle}
    >
      <div className="card" style={{ textAlign: "center", maxWidth: 440 }}>
        <div style={{ fontSize: 64, lineHeight: 1 }}>🎉</div>
        <h1 id="cp-agent-update-title" style={{ margin: 0, fontSize: 22 }}>
          Установлено новое обновление
        </h1>
        <p className="hint" style={{ margin: 0, lineHeight: 1.5 }}>
          Версия {version} загружена. Перезапустите приложение,
          чтобы завершить обновление.
        </p>
        <button
          type="button"
          className="btn"
          onClick={onRestart}
          disabled={restarting}
          style={{ marginTop: 8 }}
        >
          Перезапустить приложение
        </button>
      </div>
    </div>
  );
};

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 5, 20, 0.85)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 32,
  zIndex: 1000,
};

export default UpdateReadyModal;
