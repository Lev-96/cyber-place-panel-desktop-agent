import { BrowserWindow, screen, shell } from "electron";
import { PLAYER_TOAST_LANG, TOAST_MS, TOAST_SOUND, toastHtml } from "./sessionToast";
import { TOAST_LOGO_DATA_URI } from "./toastLogo";

/**
 * The player-facing "session ends soon" message (2026-10-12): a small window
 * of its own, top-right, over everything, for {@link TOAST_MS}, then gone.
 *
 * It never takes focus (`focusable: false`, `showInactive`), lets every click
 * through (`setIgnoreMouseEvents`), has no preload and runs sandboxed with no
 * script. The kiosk window, its lock overlay and its kiosk guards are not
 * touched. One at a time: a new message replaces the one on screen, so a
 * reconnect or a second command can never stack windows or timers.
 */
let current: { win: BrowserWindow; timer: ReturnType<typeof setTimeout> } | null = null;

const WIDTH = 400;
const HEIGHT = 196;
const MARGIN = 24;

const close = () => {
  if (!current) return;
  clearTimeout(current.timer);
  try { if (!current.win.isDestroyed()) current.win.destroy(); } catch { /* already gone */ }
  current = null;
};

export const showSessionToast = (minutes: number): void => {
  close();

  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: area.x + area.width - WIDTH - MARGIN,
    y: area.y + MARGIN,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      devTools: false,
    },
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    win.showInactive();
    if (TOAST_SOUND) {
      try { shell.beep(); } catch { /* a machine with no sound is still told */ }
    }
  });

  const timer = setTimeout(close, TOAST_MS);
  current = { win, timer };
  win.on("closed", () => { if (current?.win === win) { clearTimeout(current.timer); current = null; } });

  const html = toastHtml(minutes, PLAYER_TOAST_LANG, TOAST_LOGO_DATA_URI);
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => close());
};
