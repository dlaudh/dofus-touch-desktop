import { app, screen } from "electron";
import * as fs from "fs";
import * as path from "path";

/**
 * Settings the wrapper itself acts on, read from <userData>/settings.json.
 *
 * Only keys this process actually consumes are declared. Anything else in the
 * file is carried through untouched to `window.__dtd.settings`, where a mod can
 * read it — so a mod's configuration never has to be described here. The
 * wrapper is a shell: what it does not use, it does not name.
 */
export interface Settings {
  /** Target FPS. 0 = use the monitor's refresh rate. */
  fps: number;
  /** devicePixelRatio cap for the render resolution (higher = sharper). */
  pixelRatio: number;
  /** WebGL anti-aliasing (smoother edges). */
  antialias: boolean;
  /**
   * Width/height ratio at or below which the menu docks along the bottom
   * instead of down the right — the shape where a bottom dock reads as a
   * tablet and a side dock would crowd the map. Above it, the menu goes to
   * the right. 0 pins the right dock; a huge number pins the bottom one.
   *
   * The client's own threshold is IPAD_SCREEN_RATIO = 1.5, which is an iPad
   * rule: it calls a 1368x996 desktop window portrait and docks the whole
   * interface along the bottom.
   */
  menuDockRatio: number;
  /**
   * URL scheme the auth window intercepts to complete a login. The client asks
   * for `dofustouch://` because that is baked into its bundle, but nothing
   * checks that what comes back matches.
   */
  deeplinkScheme: string;
  /** Load mods/mods.local.js (see game-base/mods.js). */
  localMods?: boolean;
  /** Directory of extra mod files to stage alongside the game-base. */
  localModsDir?: string;
  /**
   * Report one launch event (the app version, nothing else) so the project can
   * see how many people run it. Set to false to send nothing at all.
   */
  analytics?: boolean;
  /** Keys the wrapper does not consume, passed through to the renderer. */
  [key: string]: unknown;
}

const DEFAULTS: Settings = {
  fps: 0,
  pixelRatio: 2,
  antialias: true,
  menuDockRatio: 1.2,
  deeplinkScheme: "dofustouch",
};

/**
 * Load settings from <userData>/settings.json (merged over defaults), then
 * resolve fps: 0 means "use the monitor's refresh rate". Never throws.
 */
export function loadSettings(): Settings {
  let s: Settings = { ...DEFAULTS };
  try {
    const file = path.join(app.getPath("userData"), "settings.json");
    if (fs.existsSync(file)) {
      s = {
        ...s,
        ...(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Settings>),
      };
    }
  } catch (e) {
    console.warn("[dtd] settings.json load failed:", (e as Error).message);
  }
  if (!s.fps || s.fps <= 0) {
    try {
      s.fps = Math.round(screen.getPrimaryDisplay().displayFrequency) || 60;
    } catch {
      s.fps = 60;
    }
  }
  // Log only what this process acts on: the file may hold mod configuration
  // that is none of the wrapper's business, and console output travels.
  console.log(
    "[dtd] settings:",
    JSON.stringify({
      fps: s.fps,
      pixelRatio: s.pixelRatio,
      antialias: s.antialias,
      menuDockRatio: s.menuDockRatio,
      deeplinkScheme: s.deeplinkScheme,
    })
  );
  return s;
}
