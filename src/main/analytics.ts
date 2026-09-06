import { app, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import { gameBaseDir } from "./constants";
import { loadSettings } from "./settings";

/**
 * Firebase Web App configuration. These identifiers are public by design — the
 * landing page ships the same values in its bundle — and grant nothing beyond
 * writing events into this project's Analytics property.
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAxWZIZhFV9wJF0-j6fiHo33ON1Xd5UazE",
  authDomain: "dt-desktop-4f40b.firebaseapp.com",
  projectId: "dt-desktop-4f40b",
  storageBucket: "dt-desktop-4f40b.firebasestorage.app",
  messagingSenderId: "544601068732",
  appId: "1:544601068732:web:ba3dc62b115239d7d06cb9",
  measurementId: "G-ZB74M3EM1R",
};

/** Pinned SDK build; the hidden page imports it from Google's CDN. */
const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

/** The generated page, written into the served game-base dir on each launch. */
const PAGE = "__analytics.html";

let win: BrowserWindow | null = null;

/**
 * What this reports is one event per launch, carrying the app version. How
 * many people run it and roughly where from is what Analytics derives on its
 * own (a user count, and a country off the request IP) — the app sends no
 * identifier, no account, no machine detail of its own.
 */
const LAUNCH_EVENT = "app_launch";

/**
 * The SDK needs a browser origin — storage, cookies, a document — and the main
 * process has none. So it runs in a window nobody sees, served off the same
 * loopback origin as the game, with its own session partition so its storage
 * stays away from the per-account game sessions.
 */
function pageSource(): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>analytics</title>
<script type="module">
  import { initializeApp } from "${SDK}/firebase-app.js";
  import { getAnalytics, isSupported, logEvent } from "${SDK}/firebase-analytics.js";
  try {
    // No network, a blocked CDN or storage turned off all end the same way:
    // the event is never logged and the app carries on unaware.
    if (await isSupported()) {
      const analytics = getAnalytics(initializeApp(${JSON.stringify(FIREBASE_CONFIG)}));
      logEvent(analytics, ${JSON.stringify(LAUNCH_EVENT)}, {
        app_version: ${JSON.stringify(app.getVersion())},
      });
    }
  } catch (e) {
    console.warn("[dtd] analytics failed:", e && e.message);
  }
</script>`;
}

/**
 * Whether the user left analytics on: `"analytics": false` in settings.json
 * turns it off for good, DTD_ANALYTICS=0 for a single run.
 */
function isEnabled(): boolean {
  if (process.env.DTD_ANALYTICS === "0") return false;
  return loadSettings().analytics !== false;
}

/**
 * Open the hidden window that logs the launch. Everything here is
 * best-effort: a failure to write the page, to load it, or to reach the CDN
 * costs the app nothing, so none of it is allowed to throw.
 */
export function initAnalytics(port: number): void {
  if (!isEnabled()) {
    console.log("[dtd] analytics: off");
    return;
  }
  try {
    fs.writeFileSync(path.join(gameBaseDir(), PAGE), pageSource());
  } catch (e) {
    console.warn("[dtd] analytics page write failed:", (e as Error).message);
    return;
  }

  win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: { partition: "persist:analytics" },
  });
  win.on("closed", () => {
    win = null;
  });
  // The page is invisible, so in dev its console is the only way to see the
  // SDK complain (a blocked CDN, storage turned off, a bad config).
  if (!app.isPackaged) {
    win.webContents.on("console-message", (_e, _level, message) =>
      console.log("[dtd] analytics page:", message),
    );
  }
  win.loadURL(`http://127.0.0.1:${port}/${PAGE}`).catch((e: Error) =>
    console.warn("[dtd] analytics load failed:", e.message),
  );
}
