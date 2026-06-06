import { AgentRuntimeConfig } from "@/infrastructure/AgentBridge";
import { pinCache } from "@/infrastructure/PinCache";
import bcrypt from "bcryptjs";

/**
 * Emergency-unlock PIN verification with an online/offline split.
 *
 * Online (kiosk has network): the server DB is the source of truth —
 * we POST the candidate to /agent/verify-pin and trust its boolean.
 * The server never returns the hash, so this path can't leak it.
 *
 * Offline (no network, or the online call failed): bcrypt-compare the
 * candidate against the hash cached locally the last time we were
 * online. Returns null when there is nothing cached to compare against
 * (a kiosk that has never reached the server) so the caller can show a
 * precise "no network and no cached PIN" message instead of a generic
 * "wrong PIN".
 */

/**
 * Verify against the server. Resolves to the server's verdict.
 *
 * Throws ONLY on a network-level failure (fetch rejects) — that's the
 * signal for the caller to fall back to the offline path. A response
 * that arrives but isn't ok (e.g. 422 on a malformed PIN) is NOT a
 * network failure: it means we reached the server and the PIN is not
 * valid, so we resolve false rather than masking it as "offline".
 */
export const verifyPinOnline = async (
  config: AgentRuntimeConfig,
  candidate: string,
): Promise<boolean> => {
  const res = await fetch(`${config.serverUrl.replace(/\/$/, "")}/agent/verify-pin`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.pairingToken}`,
      "ngrok-skip-browser-warning": "1",
    },
    body: JSON.stringify({ pin: candidate }),
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { valid?: boolean };
  return json.valid === true;
};

/**
 * Verify against the locally-cached hash. Returns null when no hash is
 * cached (and none is in the in-memory config either) — i.e. we can't
 * verify offline at all.
 */
export const verifyPinOffline = async (
  config: AgentRuntimeConfig,
  candidate: string,
): Promise<boolean | null> => {
  const hash = config.unlockPinHash ?? pinCache.load();
  if (!hash) return null;
  return bcrypt.compare(candidate, hash);
};
