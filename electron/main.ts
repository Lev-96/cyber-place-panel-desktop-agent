import { BrowserWindow, app, globalShortcut, ipcMain, screen, session, shell } from "electron";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { FileStore } from "./storage";

interface AgentConfigJson {
  serverUrl: string;
  branchId: number;
  pcId: number;
  pcLabel: string;
  pairingToken?: string;
}

const DEV_URL = process.env.ELECTRON_DEV_URL ?? "";
const isDev = DEV_URL.length > 0 || !app.isPackaged;
const KIOSK = !isDev; // never kiosk in dev so we can debug

// Silence Chromium diagnostic chatter for end users.
app.commandLine.appendSwitch("log-level", "3");
app.commandLine.appendSwitch("disable-logging");
app.commandLine.appendSwitch("disable-features", "Autofill");

let mainWindow: BrowserWindow | null = null;
let store: FileStore<AgentConfigJson> | null = null;
let unlocked = false;

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
  store = new FileStore<AgentConfigJson>(join(app.getPath("userData"), "agent.config.json"));
  await store.load();

  // Auto-clear non-essential caches on each startup so the kiosk PC doesn't
  // accumulate junk (HTTP cache, shader cache, code cache) over months of
  // uptime. Config file (pairing token / branch / pc id) is preserved.
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ["shadercache", "cachestorage"],
    });
    await session.defaultSession.clearCodeCaches({});
  } catch { /* best-effort */ }

  ipcMain.handle("agent:getConfig", async () => (await store?.load()) ?? null);
  ipcMain.handle("agent:saveConfig", async (_e: unknown, c: AgentConfigJson) => {
    await store?.save(c);
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

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("will-quit", () => globalShortcut.unregisterAll());

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
