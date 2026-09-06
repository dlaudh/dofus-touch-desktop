import { app, BrowserWindow, ipcMain, Notification } from "electron";
import { ensureGameBase, provisionClientBuild, fetchAppVersion } from "./gameBase";
import { startServer } from "./server";
import { openGameWindow, openAuthWindow, setServerPort } from "./windows";
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

// --- Lifecycle --------------------------------------------------------------
app.whenReady().then(async () => {
  ensureGameBase();
  settings = loadSettings();
  appVersion = await fetchAppVersion();
  const port = await startServer();
  setServerPort(port);

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
