import { BrowserWindow, app, globalShortcut, ipcMain, screen, session, shell } from "electron";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { FileStore } from "./storage";
import { AgentUpdateService, broadcastUpdateState } from "./updates/UpdateService";
import { bundledIconPath, ensureLinuxDesktopIntegration } from "./linuxIntegration";

// On-disk shape — only the pairing token. Everything else (server URL,
// branch/PC ID, PC label, emergency PIN hash) is either compile-time
// or resolved at boot via /agent/hello. Renderer never sees the
// numeric IDs in setup; the cashier just pastes one token.
interface AgentStoredConfig {
  pairingToken: string;
}

const DEV_URL = process.env.ELECTRON_DEV_URL ?? "";
const isDev = DEV_URL.length > 0 || !app.isPackaged;
const KIOSK = !isDev; // never kiosk in dev so we can debug

// Silence Chromium diagnostic chatter for end users.
app.commandLine.appendSwitch("log-level", "3");
app.commandLine.appendSwitch("disable-logging");
app.commandLine.appendSwitch("disable-features", "Autofill");

// Cap Chromium's HTTP disk cache at 50 MB. The agent runs 24/7 on
// kiosk gaming PCs and rarely restarts — without a hard cap the
// userData dir would steadily accumulate hundreds of MB of HTTP +
// shader cache over the months between updates, slowing the PC down.
// Combined with the boot-time clear + hourly purge (below), the
// kiosk PC stays at near-empty cache across its entire lifecycle.
app.commandLine.appendSwitch("disk-cache-size", String(50 * 1024 * 1024));

let mainWindow: BrowserWindow | null = null;
let store: FileStore<AgentStoredConfig> | null = null;
let unlocked = false;
let updateService: AgentUpdateService | null = null;

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

const setAutoLaunch = (enabled: boolean) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: false,
      args: [],
    });
  } catch { /* ignore */ }
};

const installKioskGuards = (win: BrowserWindow) => {
  if (!KIOSK) return;

  win.on("close", (e) => {
    if (!unlocked) e.preventDefault();
  });

  win.on("blur", () => {
    if (!unlocked) win.focus();
  });

  win.on("minimize", () => {
    if (!unlocked) win.restore();
  });

  // Block common escape shortcuts at the app level:
  const blocked = ["Alt+F4", "Alt+Tab", "Super", "CommandOrControl+W", "CommandOrControl+R", "CommandOrControl+Shift+I", "F11", "F12"];
  for (const accel of blocked) {
    try { globalShortcut.register(accel, () => {}); } catch { /* ignore */ }
  }
};

const createWindow = async () => {
  const display = screen.getPrimaryDisplay();
  mainWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    fullscreen: KIOSK,
    kiosk: KIOSK,
    frame: !KIOSK,
    skipTaskbar: KIOSK,
    alwaysOnTop: KIOSK,
    autoHideMenuBar: true,
    backgroundColor: "#020514",
    title: "Cyberplace Client",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "preload.js"),
      devTools: isDev,
      // Keep timers running while window is hidden during an active session —
      // otherwise Chromium throttles setInterval to ~1/min and the polling
      // never picks up `session.stop`, so the lock screen never reappears.
      backgroundThrottling: false,
    },
  });

  if (KIOSK && mainWindow.setAlwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, "screen-saver");
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url);
    return { action: "deny" as const };
  });

  if (isDev && DEV_URL) {
    await mainWindow.loadURL(DEV_URL);
  } else {
    const indexPath = join(__dirname, "..", "..", "dist", "web", "index.html");
    if (existsSync(indexPath)) await mainWindow.loadFile(indexPath);
  }

  installKioskGuards(mainWindow);

  mainWindow.on("closed", () => { mainWindow = null; });
};

app.whenReady().then(async () => {
  store = new FileStore<AgentStoredConfig>(join(app.getPath("userData"), "agent.config.json"));
  await store.load();

  // Linux .desktop integration — same idea as the panel: an AppImage
  // doesn't register itself with freedesktop, so we write a per-user
  // .desktop entry so the agent shows up in the application menu
  // with its icon. No-op on Windows/macOS.
  ensureLinuxDesktopIntegration({
    appId: "cyberplace-client-agent",
    displayName: "Cyberplace Client",
    comment: "Cyber Place kiosk agent — gaming PC lock/unlock controller",
    iconSourcePath: bundledIconPath(),
  });

  // Auto-clear non-essential caches on each startup so the kiosk PC doesn't
  // accumulate junk (HTTP cache, shader cache, code cache) over months of
  // uptime. Config file (pairing token / branch / pc id) is preserved.
  const purgeThrowawayCaches = async () => {
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({
        storages: ["shadercache", "cachestorage"],
      });
      await session.defaultSession.clearCodeCaches({});
    } catch { /* best-effort */ }
  };
  await purgeThrowawayCaches();

  // Hourly housekeeping. Agent processes restart very rarely (only when
  // the operator installs an update or reboots the gaming PC), so a
  // startup-only clear isn't enough — gigabytes of shader/code cache
  // would still creep in between restarts on a busy venue.
  //
  // Skipped while `unlocked` is true: the PC is in a paid session and
  // we honour the same kiosk-respect contract the auto-installer does —
  // no background I/O that could perceptibly slow the player's game.
  // The next idle hour reclaims everything once they lock out.
  const ONE_HOUR_MS = 60 * 60 * 1000;
  setInterval(() => {
    if (unlocked) return;
    void purgeThrowawayCaches();
  }, ONE_HOUR_MS);

  ipcMain.handle("agent:getConfig", async () => (await store?.load()) ?? null);
  ipcMain.handle("agent:saveConfig", async (_e: unknown, c: AgentStoredConfig) => {
    // Strip anything other than the pairing token. Legacy configs on
    // disk (with branchId/pcId/serverUrl/pcLabel) get naturally
    // migrated to the narrow shape on the first save call from the
    // new SetupScreen.
    const narrow: AgentStoredConfig = { pairingToken: c.pairingToken };
    await store?.save(narrow);
    setAutoLaunch(true);
  });

  ipcMain.handle("agent:lock", () => {
    unlocked = false;
    if (mainWindow && KIOSK) showLockOverlay(mainWindow);
  });
  ipcMain.handle("agent:unlock", () => {
    unlocked = true;
    if (mainWindow && KIOSK) hideLockOverlay(mainWindow);
  });
  ipcMain.handle("agent:shutdown", () => { unlocked = true; app.quit(); });

  ipcMain.handle("agent:getMachineId", () => safeMachineId());
  ipcMain.handle("agent:getAppVersion", () => app.getVersion());

  // Auto-update — operator-driven. The renderer mounts a non-closeable
  // modal when status === "downloaded"; the cashier clicks Restart to
  // apply. Player-safety still holds because the agent window is
  // opacity-0 + click-through during an active session, so the modal
  // is in the DOM but invisible until the next lock-screen render.
  updateService = new AgentUpdateService();
  updateService.onState(broadcastUpdateState);
  // Renderer-side caller is the AgentCommand router — when the panel
  // dispatches `agent.check-updates`, the SessionManager forwards it
  // here. We actually run a check (electron-updater downloads on hit
  // because autoDownload=true) instead of just returning current state.
  ipcMain.handle("updates:check", async () => {
    if (!updateService) return null;
    return await updateService.checkNow();
  });
  ipcMain.handle("updates:install", () => {
    updateService?.installAndRestart();
  });
  ipcMain.handle("updates:getState", () => updateService?.getState() ?? null);
  updateService.startPolling();

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  updateService?.stopPolling();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const safeMachineId = (): string => {
  try { return `${process.platform}-${hostname()}`; }
  catch { return `${process.platform}-unknown`; }
};

/**
 * Make the kiosk window invisible without hide()/minimize() — those put the
 * renderer to sleep on most Linux WMs even with backgroundThrottling: false,
 * so the timer that reopens the lock screen on session-end never fires.
 *
 * Trick: keep the window technically visible (1×1 px, off-screen, opacity 0,
 * click-through). The renderer keeps running at full speed; the user sees
 * and interacts with their desktop normally.
 */
const hideLockOverlay = (win: BrowserWindow) => {
  try { win.setKiosk(false); } catch { /* ignore */ }
  try { win.setAlwaysOnTop(false); } catch { /* ignore */ }
  try { win.setFullScreen(false); } catch { /* ignore */ }
  try { win.setSkipTaskbar(true); } catch { /* ignore */ }
  try { win.setIgnoreMouseEvents(true, { forward: true }); } catch { /* ignore */ }
  try { win.setOpacity(0); } catch { /* ignore */ }
  try { win.setBounds({ x: -2000, y: -2000, width: 1, height: 1 }); } catch { /* ignore */ }
  try { win.blur(); } catch { /* ignore */ }
};

const showLockOverlay = (win: BrowserWindow) => {
  try { win.setIgnoreMouseEvents(false); } catch { /* ignore */ }
  try { win.setOpacity(1); } catch { /* ignore */ }
  try {
    const display = screen.getPrimaryDisplay();
    win.setBounds(display.bounds);
  } catch { /* ignore */ }
  try { win.setSkipTaskbar(true); } catch { /* ignore */ }
  if (!win.isVisible()) {
    try { win.show(); } catch { /* ignore */ }
  }
  try { win.setAlwaysOnTop(true, "screen-saver"); } catch { /* ignore */ }
  try { win.setKiosk(true); } catch { /* ignore */ }
  try { win.setFullScreen(true); } catch { /* ignore */ }
  try { win.moveTop(); } catch { /* ignore */ }
  try { win.focus(); } catch { /* ignore */ }
  // Some WMs (X11/Wayland) need a second focus/moveTop after a fullscreen
  // toggle settles in — schedule a follow-up tick.
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    try { win.moveTop(); } catch { /* ignore */ }
    try { win.focus(); } catch { /* ignore */ }
    try { win.setAlwaysOnTop(true, "screen-saver"); } catch { /* ignore */ }
  }, 250);
};
