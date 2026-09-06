import { app } from "electron";
import * as path from "path";
import * as fs from "fs";

/** Mobile user-agent so Ankama serves the touch client. */
export const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/** Confirmed client bundle endpoint (v3.2.13). CORS-open, ~5.3 MB. */
export const DEFAULT_CLIENT_BUILD_URL =
  "https://dt-proxy-production-login.ankama-games.com/build/script.js";

/** The server rejects a mismatched appVersion (INCOMPATIBLE_APP_VERSION), so
 *  we report the live App Store version. Looked up at startup; this is the
 *  fallback if the lookup fails. */
export const ITUNES_LOOKUP = "https://itunes.apple.com/lookup?id=1041406978";
export const FALLBACK_APP_VERSION = "3.11.0";

/** Static game-base source: packaged resources, or ./game-base in dev. */
export function gameBaseSrc(): string {
  const packaged = path.join(process.resourcesPath || "", "game-base");
  return fs.existsSync(packaged) ? packaged : path.join(app.getAppPath(), "game-base");
}

/** Writable, served game-base cache: <userData>/game-base. */
export function gameBaseDir(): string {
  return path.join(app.getPath("userData"), "game-base");
}
