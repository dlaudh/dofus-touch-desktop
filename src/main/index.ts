import { app, BrowserWindow, ipcMain, Notification } from "electron";
import { ensureGameBase, provisionClientBuild, fetchAppVersion } from "./gameBase";
import { startServer } from "./server";
import { initAnalytics } from "./analytics";
import { openGameWindow, openAuthWindow, setServerPort, partitionOf } from "./windows";
import { buildMenu } from "./menu";
import { FALLBACK_APP_VERSION } from "./constants";
import { loadSettings, Settings } from "./settings";

// The live App Store version, reported to the login server to avoid
// INCOMPATIBLE_APP_VERSION. Fetched at startup; preload reads it synchronously.
let appVersion = FALLBACK_APP_VERSION;
ipcMain.on("dtd:app-version", (e) => {
  e.returnValue = appVersion;
});

// Render settings (fps/pixelRatio/antialias); preload reads synchronously.
let settings: Settings = {
  fps: 60,
  pixelRatio: 1,
  antialias: true,
  deeplinkScheme: "dofustouch",
};
ipcMain.on("dtd:settings", (e) => {
  e.returnValue = settings;
});

// --- IPC: the window.__dtd bridge (defined in preload) talks to these -------
ipcMain.handle("dtd:open-auth", (e, url: string) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  if (parent) openAuthWindow(parent, url);
});

ipcMain.handle("dtd:new-window", () => {
  openGameWindow();
});

ipcMain.handle("dtd:notify", (_e, payload: { title: string; body: string }) => {
  if (Notification.isSupported()) new Notification(payload).show();
});

/**
 * Auto-repair for the client's fatal "Error IDB01" (its ui.fatal.idb string).
 *
 * The client aborts when the IndexedDB open() behind its disk cache fails.
 * That store is per-window (<userData>/Partitions/account-N/IndexedDB) and the
 * usual cause is a copy left half-written by a hard kill — or, before the
 * single-instance lock below, a second process fighting over the same profile.
 * game-base/index.html catches the failing request and calls in here; we drop
 * this window's IndexedDB (nothing else: the Haapi key lives in localStorage,
 * so the session survives) and reload.
 *
 * Once per window. A client that fails again on a store we just emptied is not
 * failing because of the store, and a reload loop would bury the real error.
 */
const idbRepaired = new WeakSet<BrowserWindow>();
ipcMain.handle("dtd:idb-failed", async (e, reason: string) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  const account = partitionOf(win) ?? "default";
  if (idbRepaired.has(win)) {
    console.error(`[dtd] IndexedDB still failing after repair (${account}): ${reason}`);
    return false;
  }
  idbRepaired.add(win);
  console.warn(`[dtd] IndexedDB failed (${account}): ${reason} — clearing store and reloading`);
  try {
    // "indexdb" — Electron's spelling of the storage key, not a typo here.
    await e.sender.session.clearStorageData({ storages: ["indexdb"] });
  } catch (err) {
    console.error("[dtd] IndexedDB clear failed:", (err as Error).message);
    return false;
  }
  if (!win.isDestroyed()) win.webContents.reload();
  return true;
});

// --- Lifecycle --------------------------------------------------------------

/**
 * One process per profile. Every window's storage lives under this profile's
 * <userData>/Partitions, and a second process opening those stores loses the
 * LevelDB lock — which surfaced as the client's "Error IDB01". Launching the
 * app again raises the window that is already running; extra game windows come
 * from File > New Window (Ctrl/Cmd+N), which is what actually gives an
 * isolated account.
 */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    openGameWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return; // losing instance: quitting, do nothing
  ensureGameBase();
  settings = loadSettings();
  appVersion = await fetchAppVersion();
  const port = await startServer();
  setServerPort(port);
  initAnalytics(port);

  // Download + patch the client bundle in the background; when it lands, reload
  // any game window that opened before it was ready (first run only).
  provisionClientBuild()
    .then(() => {
      const base = `http://127.0.0.1:${port}`;
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.webContents.getURL().startsWith(base)) w.webContents.reload();
      }
    })
    .catch((e: Error) => console.error("[dtd] provision failed:", e.message));

  buildMenu();
  openGameWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openGameWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
