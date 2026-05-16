import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import log from "electron-log";

/**
 * First-run Linux desktop integration. Same idea as the panel's
 * linuxIntegration.ts (kept duplicated rather than shared because
 * the agent has no monorepo / shared-package setup yet) — writes a
 * .desktop entry into the user's per-user applications dir so the
 * AppImage shows up in GNOME / KDE / XFCE menus with the brand icon.
 *
 * Idempotent — safe to run on every launch.
 */

interface IntegrationConfig {
  appId: string;
  displayName: string;
  comment: string;
  iconSourcePath: string;
}

const isAppImage = (): boolean => !!process.env.APPIMAGE;

export const ensureLinuxDesktopIntegration = (config: IntegrationConfig): void => {
  if (process.platform !== "linux") return;
  if (!isAppImage()) {
    log.info("[linux-integration] not an AppImage launch, skipping");
    return;
  }

  const appImagePath = process.env.APPIMAGE;
  if (!appImagePath || !existsSync(appImagePath)) {
    log.warn("[linux-integration] APPIMAGE env points at missing file", { appImagePath });
    return;
  }

  try {
    const home = homedir();
    const appsDir = join(home, ".local", "share", "applications");
    const iconsDir = join(home, ".local", "share", "icons", "hicolor", "512x512", "apps");
    mkdirSync(appsDir, { recursive: true });
    mkdirSync(iconsDir, { recursive: true });

    const iconTarget = join(iconsDir, `${config.appId}.png`);
    if (existsSync(config.iconSourcePath)) {
      copyFileSync(config.iconSourcePath, iconTarget);
    } else {
      log.warn("[linux-integration] icon source missing", { iconSourcePath: config.iconSourcePath });
    }

    const desktopPath = join(appsDir, `${config.appId}.desktop`);
    const desktopBody = [
      "[Desktop Entry]",
      "Type=Application",
      `Name=${config.displayName}`,
      `Comment=${config.comment}`,
      `Exec="${appImagePath}" %U`,
      `Icon=${config.appId}`,
      "Terminal=false",
      "Categories=Utility;",
      "StartupNotify=true",
      `StartupWMClass=${config.displayName}`,
      "",
    ].join("\n");
    writeFileSync(desktopPath, desktopBody, { mode: 0o644 });

    log.info("[linux-integration] registered", { desktopPath, iconTarget, appImagePath });
  } catch (e) {
    log.error("[linux-integration] failed", e);
  }
};

export const bundledIconPath = (): string =>
  resolve(process.resourcesPath, "build", "icon.png");
