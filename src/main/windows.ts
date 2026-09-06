import { BrowserWindow } from "electron";
import * as path from "path";
import { loadSettings } from "./settings";
import { MOBILE_UA } from "./constants";

let serverPort = 0;
let sessionCounter = 0;

/** Track each game window's session partition, for its auth child window. */
const partitions = new WeakMap<BrowserWindow, string>();

export function setServerPort(port: number): void {
  serverPort = port;
}

const PRELOAD = path.join(__dirname, "..", "preload", "index.js");

/** Open a fresh, isolated game window (one account per window). */
export function openGameWindow(): BrowserWindow {
  const n = sessionCounter++;
  const partition = `persist:account-${n}`;
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    title: "Dofus Touch Desktop",
    webPreferences: {
      preload: PRELOAD,
      partition,
      webSecurity: false, // native cross-origin requests (no CORS)
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  partitions.set(win, partition);
  win.webContents.setUserAgent(MOBILE_UA);
  // Ankama can block requests that carry a Referer; strip it.
  win.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    if (/ankama|dofus/i.test(details.url))
      delete details.requestHeaders["Referer"];
    cb({ requestHeaders: details.requestHeaders });
  });
  win.loadURL(`http://127.0.0.1:${serverPort}/index.html`);
  if (!require("electron").app.isPackaged) win.webContents.openDevTools();

  // Drive the client re-layout after the OS window settles. The 'resize' event
  // fires repeatedly during a maximize/fullscreen animation; wait until it
  // stops, then run _resizeUi a few times so the map fits (no black bars).
  let resizeDebounce: ReturnType<typeof setTimeout> | undefined;
  const relayout = (): void => {
    if (resizeDebounce) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      if (win.isDestroyed()) return;
      win.webContents
        .executeJavaScript(
          "window.__dtd_resize&&(window.__dtd_resize(),setTimeout(window.__dtd_resize,300),setTimeout(window.__dtd_resize,700));",
        )
        .catch(() => {});
    }, 350);
  };
  win.on("resize", relayout);
  win.on("maximize", relayout);
  win.on("unmaximize", relayout);
  win.on("enter-full-screen", relayout);
  win.on("leave-full-screen", relayout);
  return win;
}

/**
 * Open the Ankama OAuth URL in a dedicated auth window. When it redirects to
 * `dofustouch://authorized?code=...`, deliver the code-carrying URL back to
 * the parent game window's deeplink handler (window.__dtd_onAuthRedirect,
 * defined in game-base/index.html) and close the auth window.
 */
export function openAuthWindow(
  parent: BrowserWindow,
  url: string,
): BrowserWindow {
  const auth = new BrowserWindow({
    width: 520,
    height: 720,
    title: "Ankama Login",
    parent,
    webPreferences: { partition: partitions.get(parent) },
  });
  auth.webContents.setUserAgent(MOBILE_UA);

  const scheme = `${loadSettings().deeplinkScheme || "dofustouch"}://`;

  const onNav = (e: Electron.Event, navUrl: string): void => {
    if (!navUrl.startsWith(scheme)) return;
    e.preventDefault();
    console.log("[dtd] captured auth redirect:", navUrl);
    if (!parent.isDestroyed()) {
      void parent.webContents.executeJavaScript(
        `window.__dtd_onAuthRedirect && window.__dtd_onAuthRedirect(${JSON.stringify(navUrl)});`,
      );
    }
    if (!auth.isDestroyed()) auth.close();
  };
  auth.webContents.on("will-navigate", onNav);
  auth.webContents.on("will-redirect", onNav);
  auth.loadURL(url);
  return auth;
}
