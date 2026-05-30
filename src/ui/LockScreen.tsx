import { agentBridge, AgentRuntimeConfig } from "@/infrastructure/AgentBridge";
import { TransportStatus } from "@/transport/ITransport";
import bcrypt from "bcryptjs";
import { FormEvent, useEffect, useRef, useState } from "react";
import BrandMark from "./BrandMark";
import StatusPill from "./StatusPill";

interface Props {
  config: AgentRuntimeConfig;
  status: TransportStatus;
}

/**
 * Lock screen between paid sessions. Numeric keypad doubles as the
 * emergency-unlock PIN pad: digits typed into the input are bcrypt-
 * compared against the branch's PIN hash (shipped via /agent/hello,
 * refreshed every 60s by AgentApp). Match → agentBridge.unlock() lifts
 * the kiosk overlay locally; no backend round-trip required, which is
 * the entire point of the feature ("network is down and we still need
 * to rescue this PC").
 *
 * "Подтвердить" is the single primary action. The button is always
 * rendered (so the cashier never wonders where the submit affordance
 * lives); it's disabled when no digits are entered, when a request
 * is in flight, when the pad is rate-limited, OR when the agent
 * hasn't yet received a PIN hash — and shows a clear status message
 * in each of those cases.
 *
 * Rate limit: 5 failed attempts within 60s freezes the pad for 60s.
 * Successful PIN clears the counter immediately.
 */

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60_000;
const LOCKOUT_MS = 60_000;

const LockScreen = ({ config, status }: Props) => {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedOutUntil, setLockedOutUntil] = useState<number | null>(null);
  const attemptTimestamps = useRef<number[]>([]);

  // Tick to re-render countdown while the pad is locked out — purely
  // cosmetic, every 1s.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (lockedOutUntil === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedOutUntil]);

  const hasPin = typeof config.unlockPinHash === "string" && config.unlockPinHash.length > 0;
  const isLockedOut = lockedOutUntil !== null && Date.now() < lockedOutUntil;
  const padDisabled = busy || isLockedOut;

  const press = (k: string) => {
    if (padDisabled) return;
    setError(null);
    setCode((c) => (c + k).slice(0, 8));
  };
  const del = () => {
    if (padDisabled) return;
    setError(null);
    setCode((c) => c.slice(0, -1));
  };
  const clear = () => {
    if (padDisabled) return;
    setError(null);
    setCode("");
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (padDisabled) return;
    if (!hasPin) {
      setError("PIN ещё не настроен. Попросите менеджера установить его в панели.");
      return;
    }
    const candidate = code.trim();
    if (candidate.length < 4) {
      setError("Введите 4–6 цифр");
      return;
    }
    setBusy(true);
    try {
      const ok = await bcrypt.compare(candidate, config.unlockPinHash as string);
      if (!ok) {
        // Slide-window rate limit: keep only timestamps within the
        // last minute; if 5+ have piled up, freeze the pad.
        const now = Date.now();
        attemptTimestamps.current = [
          ...attemptTimestamps.current.filter((t) => now - t < ATTEMPT_WINDOW_MS),
          now,
        ];
        if (attemptTimestamps.current.length >= MAX_ATTEMPTS) {
          setLockedOutUntil(now + LOCKOUT_MS);
          attemptTimestamps.current = [];
          setError("Слишком много попыток. Подождите минуту.");
        } else {
          setError("Неверный PIN");
        }
        setCode("");
        return;
      }

      // Success — wipe attempt history, call into Electron to lift the
      // overlay, and best-effort log the audit on the backend (don't
      // block unlock on audit failure — the whole point is "works
      // when the network is broken").
      attemptTimestamps.current = [];
      setError(null);
      setCode("");
      await agentBridge?.unlock();
      void fetch(`${config.serverUrl.replace(/\/$/, "")}/agent/unlock-emergency`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.pairingToken}`,
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify({ reason: "lock-screen pin entry" }),
      }).catch(() => { /* offline is the expected case; ignore */ });
    } finally {
      setBusy(false);
    }
  };

  const lockoutSeconds = isLockedOut && lockedOutUntil
    ? Math.max(0, Math.ceil((lockedOutUntil - Date.now()) / 1000))
    : 0;

  const submitDisabled = padDisabled || code.length < 4 || !hasPin;

  return (
    <div className="full">
      <StatusPill status={status} />
      <BrandMark />
      <svg
        className="lock-badge"
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="url(#cp-lock-grad)"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <defs>
          <linearGradient id="cp-lock-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#07ddf1" />
            <stop offset="1" stopColor="#d152fa" />
          </linearGradient>
        </defs>
        <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />
        <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
        <circle cx="12" cy="15.4" r="1.4" fill="url(#cp-lock-grad)" stroke="none" />
        <path d="M12 16.8v2" />
      </svg>
      <form className="card" onSubmit={submit}>
        <h1>{config.pcLabel}</h1>
        <p className="hint">Попросите кассира начать сессию для этого ПК.</p>
        <input
          className="input"
          value={code}
          placeholder={hasPin ? "PIN экстренного разблокирования" : "Код или PIN (необязательно)"}
          onChange={(e) => {
            setError(null);
            setCode(e.target.value.replace(/\D/g, "").slice(0, 8));
          }}
          inputMode="numeric"
          disabled={padDisabled}
          type="password"
          autoComplete="off"
        />
        <div className="kbd">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
            <button key={k} type="button" onClick={() => press(k)} disabled={padDisabled}>{k}</button>
          ))}
          <button type="button" className="del" onClick={clear} disabled={padDisabled}>C</button>
          <button type="button" onClick={() => press("0")} disabled={padDisabled}>0</button>
          <button type="button" className="del" onClick={del} disabled={padDisabled}>⌫</button>
        </div>
        <button
          type="submit"
          className="btn"
          disabled={submitDisabled}
          style={{ marginTop: 12, width: "100%", fontSize: 16, padding: "12px 16px" }}
        >
          {busy ? "Проверка…" : "Подтвердить"}
        </button>
        {isLockedOut && (
          <div className="muted" style={{ marginTop: 8, textAlign: "center" }}>
            Подождите ещё {lockoutSeconds} сек.
          </div>
        )}
        {error && !isLockedOut && (
          <div className="error" style={{ marginTop: 8, textAlign: "center" }}>{error}</div>
        )}
      </form>
    </div>
  );
};

export default LockScreen;
