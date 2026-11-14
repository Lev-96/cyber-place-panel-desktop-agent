import { useSyncExternalStore } from "react";
import { agentBridge } from "@/infrastructure/AgentBridge";

/**
 * The installed agent version, shown under the brand on every screen
 * (2026-11-14) so staff can read off a PC which build it runs.
 *
 * Source of truth: the main process's `app.getVersion()` (package.json of the
 * installed app), read through the existing `agentAPI.getAppVersion()` bridge
 * that `AgentBootstrap` already uses. No new IPC. The compile-time
 * `__APP_VERSION__` is deliberately NOT used: it describes the renderer
 * bundle, not what Electron says is installed.
 *
 * Same shape as `networkBlock` (subscribe/current for useSyncExternalStore).
 * Read once, lazily on the first subscriber, and never again: the version of
 * a running process does not change. Anything unexpected (no bridge, a failed
 * call, an empty or non-string answer) leaves it null, and the line is simply
 * not drawn.
 */

type Listener = () => void;

export interface AppVersionStore {
  load(): Promise<void>;
  current(): string | null;
  subscribe(l: Listener): () => void;
}

const normalize = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length > 0 ? v : null;
};

export const createAppVersionStore = (read: (() => Promise<unknown>) | undefined): AppVersionStore => {
  let current: string | null = null;
  let loading: Promise<void> | null = null;
  const listeners = new Set<Listener>();

  const load = (): Promise<void> => {
    if (loading) return loading;
    loading = (async () => {
      if (!read) return;
      let next: string | null = null;
      try { next = normalize(await read()); } catch { /* no version is a valid state */ }
      if (next === current) return;
      current = next;
      for (const l of listeners) {
        try { l(); } catch { /* ignore */ }
      }
    })();
    return loading;
  };

  return {
    load,
    current: () => current,
    subscribe: (l) => {
      listeners.add(l);
      void load();
      return () => { listeners.delete(l); };
    },
  };
};

const bridge = agentBridge;
export const appVersion = createAppVersionStore(bridge ? () => bridge.getAppVersion() : undefined);

/** The installed version, or null while unknown / unavailable. */
export const useAppVersion = (): string | null =>
  useSyncExternalStore(appVersion.subscribe, appVersion.current, appVersion.current);
