import { AgentConfigJson } from "@/infrastructure/AgentBridge";
import { FormEvent, useState } from "react";

interface Props {
  initial?: AgentConfigJson | null;
  onSubmit: (c: AgentConfigJson) => void;
}

const SetupScreen = ({ initial, onSubmit }: Props) => {
  const [serverUrl, setServerUrl] = useState(initial?.serverUrl ?? import.meta.env.VITE_BACKEND_URL ?? "https://cyber-place-server-staging-production.up.railway.app");
  const [branchId, setBranchId] = useState(String(initial?.branchId ?? ""));
  const [pcId, setPcId] = useState(String(initial?.pcId ?? ""));
  const [pcLabel, setPcLabel] = useState(initial?.pcLabel ?? "");
  const [pairingToken, setPairingToken] = useState(initial?.pairingToken ?? "");
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const branch = Number(branchId);
    const pc = Number(pcId);
    if (!serverUrl) return setErr("Server URL is required");
    if (!Number.isFinite(branch) || branch <= 0) return setErr("Invalid branch id");
    if (!Number.isFinite(pc) || pc <= 0) return setErr("Invalid PC id");
    if (!pcLabel) return setErr("PC label is required");
    setErr(null);
    onSubmit({ serverUrl, branchId: branch, pcId: pc, pcLabel, pairingToken: pairingToken || undefined });
  };

  return (
    <div className="full full-setup">
      <div className="brand">CYBER PLACE · CLIENT</div>
      <form className="card" onSubmit={submit}>
        <h1>First-time setup</h1>
        <p className="hint">Configure this PC. Get the branch ID, PC ID and pairing token from the cashier panel.</p>
        <input className="input" placeholder="Server URL" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
        <input className="input" placeholder="Branch ID" value={branchId} inputMode="numeric" onChange={(e) => setBranchId(e.target.value)} />
        <input className="input" placeholder="PC ID" value={pcId} inputMode="numeric" onChange={(e) => setPcId(e.target.value)} />
        <input className="input" placeholder="PC label (e.g. PC #5)" value={pcLabel} onChange={(e) => setPcLabel(e.target.value)} />
        <input className="input" placeholder="Pairing token (optional)" value={pairingToken} onChange={(e) => setPairingToken(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <button className="btn" type="submit">Save and start</button>
      </form>
    </div>
  );
};

export default SetupScreen;
