import { agentBridge, AgentRuntimeConfig } from "@/infrastructure/AgentBridge";
import { TransportStatus } from "@/transport/ITransport";
import bcrypt from "bcryptjs";
import { useEffect, useRef, useState } from "react";
import BrandMark from "./BrandMark";
import StatusPill from "./StatusPill";

interface Props {
  config: AgentRuntimeConfig;
  status: TransportStatus;
}

/**
 * Lock screen the player sees between sessions. Renders the PC label
 * + a numeric keypad. The keypad doubles as the emergency-unlock PIN
 * pad: if the operator types digits and the entered value matches the
 * branch's bcrypt-hashed PIN (shipped to us via /agent/hello), we
 * call `agentBridge.unlock()` to bypass the panel-driven flow.
 *
 * Why local (offline-capable) verification:
 *   - Network/panel may be exactly what's broken; the whole point of
 *     "emergency unlock" is to keep working without them.
 *   - Hash is bcrypt, so a disk image alone doesn't trivially recover
 *     the PIN. Brute-forcing 4-6 digits against bcrypt is slow enough
 *     that the cashier would notice 1000+ failed presses, and we add
 *     rate-limiting on top.
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

  const submit = async () => {
    if (padDisabled || !hasPin) return;
    const candidate = code.trim();
    if (candidate.length < 4) {
      setError("PIN слишком короткий");
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

  return (
    <div className="full">
      <StatusPill status={status} />
      <BrandMark />
      <div className="card">
        <h1>{config.pcLabel}</h1>
        <p className="hint">Попросите кассира начать сессию для этого ПК.</p>
        <input
          className="input"
          value={code}
          placeholder={hasPin ? "PIN экстренного разблокирования" : "Код или PIN (необязательно)"}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
          inputMode="numeric"
          disabled={padDisabled}
          type="password"
        />
        <div className="kbd">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
            <button key={k} type="button" onClick={() => press(k)} disabled={padDisabled}>{k}</button>
          ))}
          <button type="button" className="del" onClick={clear} disabled={padDisabled}>C</button>
          <button type="button" onClick={() => press("0")} disabled={padDisabled}>0</button>
          <button type="button" className="del" onClick={del} disabled={padDisabled}>⌫</button>
        </div>
        {hasPin && (
          <button
            type="button"
            className="btn"
            onClick={() => void submit()}
            disabled={padDisabled || code.length < 4}
            style={{ marginTop: 8 }}
          >
            {busy ? "Проверка…" : "Экстренный разблок"}
          </button>
        )}
        {isLockedOut && (
          <div className="muted" style={{ marginTop: 8 }}>
            Подождите ещё {lockoutSeconds} сек.
          </div>
        )}
        {error && !isLockedOut && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
      </div>
    </div>
  );
};

export default LockScreen;
