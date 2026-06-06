import { agentBridge, AgentRuntimeConfig, AgentStoredConfig } from "@/infrastructure/AgentBridge";
import { agentConfig } from "@/infrastructure/AgentConfig";
import { logger } from "@/infrastructure/Logger";
import { createTransport } from "@/transport/TransportFactory";
import { SessionManager } from "./SessionManager";

export interface BootResult {
  manager: SessionManager;
  config: AgentRuntimeConfig;
}

/**
 * Compile-time server URL. `VITE_BACKEND_URL` lets the dev build point
 * at a local Laravel; production builds bake in the Railway URL so the
 * end user never has to know or type it.
 */
const SERVER_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  "https://cyber-place-server-staging-production.up.railway.app";

interface HelloResponse {
  pc?: {
    id?: number;
    branch_id?: number;
    label?: string;
  };
  branch?: {
    unlock_pin_hash?: string | null;
    unlock_pin_updated_at?: string | null;
  };
}

/**
 * Fetch this PC's identity (branch_id, pc_id, label) and the branch's
 * emergency PIN hash from the server using the saved pairing token.
 *
 * Falls back to "no PIN" if the server is unreachable AND we have no
 * cached identity — the SessionManager's transport status then flips to
 * offline, and the lock screen shows the "no connection" indicator while
 * still accepting a locally-cached PIN, rather than a stuck "Starting…".
 */
const fetchIdentity = async (
  serverUrl: string,
  pairingToken: string,
): Promise<{
  branchId: number;
  pcId: number;
  pcLabel: string;
  unlockPinHash: string | null;
  unlockPinUpdatedAt: string | null;
}> => {
  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/agent/hello`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${pairingToken}`,
      // ngrok-tunnelled dev backends interpose a browser warning page
      // on first-time hits without this header — same mitigation the
      // transport uses for actual polling.
      "ngrok-skip-browser-warning": "1",
    },
  });
  if (!res.ok) {
    throw new Error(`hello failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as HelloResponse;
  const pcId = json.pc?.id;
  const branchId = json.pc?.branch_id;
  const label = json.pc?.label;
  if (typeof pcId !== "number" || typeof branchId !== "number" || typeof label !== "string") {
    throw new Error("hello returned malformed identity");
  }
  return {
    branchId,
    pcId,
    pcLabel: label,
    unlockPinHash: json.branch?.unlock_pin_hash ?? null,
    unlockPinUpdatedAt: json.branch?.unlock_pin_updated_at ?? null,
  };
};

/**
 * Re-fetch the branch's PIN hash + identity from /agent/hello without
 * touching the transport or session manager. Used by AgentApp's
 * periodic refresh so a freshly-set/rotated PIN in the panel reaches
 * already-running kiosks within a minute, instead of waiting for a
 * full agent restart.
 *
 * Failures are non-fatal — the existing cached config keeps working;
 * the next tick retries.
 */
export const refreshIdentity = async (
  pairingToken: string,
): Promise<AgentRuntimeConfig | null> => {
  try {
    const identity = await fetchIdentity(SERVER_URL, pairingToken);
    return {
      serverUrl: SERVER_URL,
      pairingToken,
      ...identity,
    };
  } catch (e) {
    logger.warn("agent /hello refresh failed", e);
    return null;
  }
};

/** Call when a stored config exists. Resolves identity, wires transport + manager. */
export const bootstrapAgent = async (stored: AgentStoredConfig): Promise<BootResult> => {
  await agentConfig.save(stored);

  let identity: Awaited<ReturnType<typeof fetchIdentity>>;
  try {
    identity = await fetchIdentity(SERVER_URL, stored.pairingToken);
  } catch (e) {
    logger.warn("agent /hello failed during bootstrap; falling back to placeholder identity", e);
    // Placeholder identity so the rest of the pipeline mounts. Transport
    // will surface "error" status, the lock screen shows the offline
    // indicator, and a retry of bootstrap on the next config change (or
    // restart) will swap in real values.
    identity = {
      branchId: 0,
      pcId: 0,
      pcLabel: "...",
      unlockPinHash: null,
      unlockPinUpdatedAt: null,
    };
  }

  const runtime: AgentRuntimeConfig = {
    serverUrl: SERVER_URL,
    pairingToken: stored.pairingToken,
    ...identity,
  };

  const machineId = (await agentBridge?.getMachineId()) ?? "web-dev";
  const version = (await agentBridge?.getAppVersion()) ?? "0.0.0-dev";
  const transport = createTransport(runtime);
  const manager = new SessionManager(transport, runtime, machineId, version);
  await manager.start();
  return { manager, config: runtime };
};
