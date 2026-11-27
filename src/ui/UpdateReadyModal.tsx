import { AgentRuntimeConfig, AgentUpdateState } from "@/infrastructure/AgentBridge";
import { verifyPinOffline, verifyPinOnline } from "@/services/UnlockPinService";
import { TransportStatus } from "@/transport/ITransport";
import { FormEvent, useEffect, useState } from "react";
import { ATTEMPT_WINDOW_MS, LOCKOUT_MS, loadGuard, saveGuard } from "./pinGuard";

interface Props {
  /** Present once the PC is paired: then the restart asks for the staff PIN (2026-11-28). */
  config?: AgentRuntimeConfig | null;
  status?: TransportStatus;
}

const MAX_ATTEMPTS = 5;

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
 * process — and on a paired PC it asks the staff PIN first
 * (2026-11-28, security audit): the modal sits on the player's lock
 * screen, and the PC is unlocked while the agent reinstalls.
 */
const UpdateReadyModal = ({ config = null, status }: Props) => {
  const [state, setState] = useState<AgentUpdateState | null>(null);
  const [restarting, setRestarting] = useState(false);
  // The restart is staff-only (2026-11-28, security audit): it is shown on
  // the player's lock screen, and while the agent reinstalls the PC is not
  // locked. The same PIN as the pad (branch PIN online, this PC's code
  // offline) and the same shared lockout.
  const [asking, setAsking] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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

  const install = () => {
    if (restarting) return;
    setRestarting(true);
    // No await — main process calls quitAndInstall and the agent
    // dies immediately. The flag just disables the button so an
    // accidental double-click doesn't fire two install calls.
    void window.cyberplaceUpdates?.install();
  };

  const onRestart = () => {
    if (restarting) return;
    if (!config) { install(); return; } // not paired yet: nobody to keep out
    setAsking(true);
  };

  const confirmPin = async (e: FormEvent) => {
    e.preventDefault();
    if (!config || checking) return;
    const guard = loadGuard();
    if (guard.until !== null) { setPinError("Слишком много попыток. Подождите минуту."); return; }
    if (pin.length < 4) { setPinError("Введите PIN персонала"); return; }
    setChecking(true);
    try {
      let ok: boolean | null;
      if (status === "connected") {
        try { ok = await verifyPinOnline(config, pin); } catch { ok = await verifyPinOffline(config, pin); }
      } else {
        ok = await verifyPinOffline(config, pin);
      }
      if (ok) { saveGuard(null, []); install(); return; }
      const now = Date.now();
      const tries = [...guard.tries.filter((t) => now - t < ATTEMPT_WINDOW_MS), now];
      if (tries.length >= MAX_ATTEMPTS) { saveGuard(now + LOCKOUT_MS, []); setPinError("Слишком много попыток. Подождите минуту."); }
      else { saveGuard(null, tries); setPinError(ok === null ? "Нет сети, а PIN ещё не сохранён на этом ПК." : "Неверный PIN"); }
      setPin("");
    } finally {
      setChecking(false);
    }
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
        {asking ? (
          <form onSubmit={confirmPin} style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <input
              className="input"
              value={pin}
              placeholder="PIN персонала"
              onChange={(ev) => { setPinError(null); setPin(ev.target.value.replace(/\D/g, "").slice(0, 8)); }}
              inputMode="numeric"
              type="password"
              autoComplete="off"
              autoFocus
              disabled={checking || restarting}
              data-testid="update-restart-pin"
            />
            <button type="submit" className="btn" disabled={checking || restarting || pin.length < 4}>
              {checking ? "Проверка…" : "Подтвердить и перезапустить"}
            </button>
            {pinError && <div className="error" style={{ textAlign: "center" }}>{pinError}</div>}
          </form>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={onRestart}
            disabled={restarting}
            style={{ marginTop: 8 }}
          >
            Перезапустить приложение
          </button>
        )}
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
