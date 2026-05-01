import { AgentConfigJson } from "@/infrastructure/AgentBridge";
import { TransportStatus } from "@/transport/ITransport";
import { useState } from "react";
import StatusPill from "./StatusPill";

interface Props {
  config: AgentConfigJson;
  status: TransportStatus;
}

const LockScreen = ({ config, status }: Props) => {
  const [code, setCode] = useState("");

  const press = (k: string) => setCode((c) => (c + k).slice(0, 8));
  const del = () => setCode((c) => c.slice(0, -1));
  const clear = () => setCode("");

  return (
    <div className="full">
      <StatusPill status={status} />
      <div className="brand">CYBER PLACE</div>
      <div className="card">
        <h1>{config.pcLabel}</h1>
        <p className="hint">Ask the cashier to start a session for this PC.</p>
        <input className="input" value={code} placeholder="Code or PIN (optional)" onChange={(e) => setCode(e.target.value)} />
        <div className="kbd">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
            <button key={k} type="button" onClick={() => press(k)}>{k}</button>
          ))}
          <button type="button" className="del" onClick={clear}>C</button>
          <button type="button" onClick={() => press("0")}>0</button>
          <button type="button" className="del" onClick={del}>⌫</button>
        </div>
        <p className="muted">PC #{config.pcId} · branch #{config.branchId}</p>
      </div>
    </div>
  );
};

export default LockScreen;
