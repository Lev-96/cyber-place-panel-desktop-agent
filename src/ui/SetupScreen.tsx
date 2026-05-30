import { AgentStoredConfig } from "@/infrastructure/AgentBridge";
import { FormEvent, useState } from "react";
import BrandMark from "./BrandMark";

interface Props {
  initial?: AgentStoredConfig | null;
  onSubmit: (c: AgentStoredConfig) => void;
}

/**
 * First-time pairing screen. One input — the pairing token issued by
 * the panel for this physical PC. Everything else (which server,
 * which branch, which PC, the PC label) is either compile-time
 * (server URL) or resolved by the agent itself via `/agent/hello`
 * once the token is known, so the cashier doesn't have to know or
 * type any numeric IDs.
 */
const SetupScreen = ({ initial, onSubmit }: Props) => {
  const [pairingToken, setPairingToken] = useState(initial?.pairingToken ?? "");
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const token = pairingToken.trim();
    if (token.length === 0) return setErr("Введите токен подключения");
    setErr(null);
    onSubmit({ pairingToken: token });
  };

  return (
    <div className="full full-setup">
      <BrandMark />
      <form className="card" onSubmit={submit}>
        <h1>Подключение</h1>
        <p className="hint">Получите токен подключения у кассира в панели и вставьте его сюда.</p>
        <input
          className="input"
          placeholder="Токен подключения"
          value={pairingToken}
          onChange={(e) => setPairingToken(e.target.value)}
          autoFocus
        />
        {err && <div className="error">{err}</div>}
        <button className="btn" type="submit">Подключить</button>
      </form>
    </div>
  );
};

export default SetupScreen;
