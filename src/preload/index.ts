import { contextBridge, ipcRenderer } from "electron";

/**
 * The platform bridge the game-base expects as `window.__dtd`. On Tauri this
 * was `window.__TAURI__.core.invoke`; here it's Electron IPC to main.
 */
// Fetched by main at startup; read synchronously so the game-base can set the
// client's appVersion before it connects (avoids INCOMPATIBLE_APP_VERSION).
const appVersion = ipcRenderer.sendSync("dtd:app-version") as string;
const settings = ipcRenderer.sendSync("dtd:settings") as unknown;

// Which host the game-base is running under. Mods that only make sense on one
// platform read this instead of sniffing the user agent — mods/shortcuts.js
// (keyboard + wheel) keys off it, and the Android host sets it to "android".
contextBridge.exposeInMainWorld("__dtdPlatform", "desktop");

contextBridge.exposeInMainWorld("__dtd", {
  /** Live App Store app version to report to the login server. */
  appVersion,
  /**
   * settings.json, verbatim. The wrapper reads the few keys it acts on
   * (fps/pixelRatio/antialias for the render patches, deeplinkScheme for the
   * auth window); everything else is a mod's own configuration and is passed
   * through for the mod to read, not mirrored into named fields here.
   */
  settings,
  /** Open the Ankama OAuth URL in a dedicated auth window (browsertab shim). */
  openAuth: (url: string) => ipcRenderer.invoke("dtd:open-auth", url),
  /** The auth window closes itself on redirect; no-op for API parity. */
  closeAuth: () => {},
  /**
   * Report a failed IndexedDB open. The host clears this window's store and
   * reloads; it resolves false when it declines (already repaired once), and
   * the client is left to show its own "Error IDB01".
   */
  idbFailed: (reason: string) => ipcRenderer.invoke("dtd:idb-failed", reason),
  /** Open another isolated game window (one account per window). */
  newWindow: () => ipcRenderer.invoke("dtd:new-window"),
  /** Native desktop notification from a game event. */
  notify: (kind: string, detail: string) => {
    const title = "Dofus Touch";
    const body =
      kind === "turn"
        ? `Combat: ${detail}`
        : kind === "pm"
          ? `Message — ${detail}`
          : String(detail);
    return ipcRenderer.invoke("dtd:notify", { title, body });
  },
});
