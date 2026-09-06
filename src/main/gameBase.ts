import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { loadSettings } from "./settings";
import {
  MOBILE_UA,
  DEFAULT_CLIENT_BUILD_URL,
  ITUNES_LOOKUP,
  FALLBACK_APP_VERSION,
  gameBaseSrc,
  gameBaseDir,
} from "./constants";

const STATIC_FILES = [
  "index.html",
  "fixes.js",
  "fixes.css",
  "patches.json",
  "keymaster.js",
  "mods.js",
];

interface Patch {
  file: string;
  find: string;
  replace: string;
  note?: string;
}

/** Copy the bundled static game-base files into the writable cache dir. */
export function ensureGameBase(): void {
  const src = gameBaseSrc();
  const dir = gameBaseDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const name of STATIC_FILES) {
    const from = path.join(src, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, name));
  }
  // Copy the mods/ tree (one .js per QoL mod, plus mods/helpers/) verbatim.
  // Recursive: the shared helpers live in a subdirectory, and a flat readdir
  // silently dropped them, leaving mods.js requesting scripts that 404.
  copyJsTree(path.join(src, "mods"), path.join(dir, "mods"));

  stageLocalMods(dir);
}

/**
 * Stage a directory of mods that live outside the game-base repository.
 *
 * settings.json points `localModsDir` at any folder; its `mods.local.js` lands
 * at the game-base root (that is the file mods.js looks for) and everything
 * else under `local/`, which is where `__dtdMods.loadPath("local/…")` resolves.
 *
 * The point is that those files never enter the game-base working tree. That
 * repository is published; a mod staged through here is only ever a path in
 * this user's settings.
 */
function stageLocalMods(dir: string): void {
  const configured = loadSettings().localModsDir;
  if (typeof configured !== "string" || configured === "") return;
  if (!fs.existsSync(configured)) {
    console.warn("[dtd] localModsDir does not exist:", configured);
    return;
  }

  const localDir = path.join(dir, "local");
  fs.mkdirSync(localDir, { recursive: true });

  let staged = 0;
  for (const entry of fs.readdirSync(configured, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    // Tests sit next to the mods they cover; they have no business shipping.
    if (entry.name.endsWith(".test.js")) continue;
    const from = path.join(configured, entry.name);
    const to =
      entry.name === "mods.local.js"
        ? path.join(dir, entry.name)
        : path.join(localDir, entry.name);
    fs.copyFileSync(from, to);
    staged++;
  }
  console.log(`[dtd] staged ${staged} local mod file(s) from ${configured}`);
}

/** Copy every .js under `from` into `to`, preserving subdirectories. */
function copyJsTree(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) copyJsTree(srcPath, destPath);
    else if (entry.name.endsWith(".js")) fs.copyFileSync(srcPath, destPath);
  }
}

function download(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": MOBILE_UA } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

/**
 * Look up the live Dofus Touch App Store version. The login server rejects a
 * mismatched appVersion with INCOMPATIBLE_APP_VERSION, so we report the current
 * store version. Falls back to a pinned version on any failure.
 */
export async function fetchAppVersion(): Promise<string> {
  try {
    const json = JSON.parse((await download(ITUNES_LOOKUP)).toString("utf8"));
    const version = json?.results?.[0]?.version;
    if (typeof version === "string" && version.length > 0) {
      console.log("[dtd] app version:", version);
      return version;
    }
  } catch (e) {
    console.warn("[dtd] app version lookup failed:", (e as Error).message);
  }
  return FALLBACK_APP_VERSION;
}

/** Apply the regex patches from patches.json to the downloaded bundle text. */
function applyPatches(text: string): string {
  let patches: Patch[] = [];
  try {
    const json = JSON.parse(fs.readFileSync(path.join(gameBaseDir(), "patches.json"), "utf8"));
    patches = (json.patches ?? []) as Patch[];
  } catch (e) {
    console.error("[dtd] patches.json parse failed:", (e as Error).message);
    return text;
  }
  let applied = 0;
  let skipped = 0;
  for (const p of patches.filter((p) => p.file === "build/script.js")) {
    try {
      const re = new RegExp(p.find);
      if (!re.test(text)) {
        skipped++;
        continue;
      }
      text = text.replace(re, p.replace);
      applied++;
    } catch {
      skipped++;
    }
  }
  console.log(`[dtd] patches: ${applied} applied, ${skipped} skipped`);
  return text;
}

/**
 * Ask for the bundle only if it has changed since the copy on disk. A null
 * body means the CDN answered 304: what is cached is what is being served.
 *
 * The bundle carries its own ETag, and that is the honest answer to "is this
 * stale". The signal used before was the version segment of config.json's
 * assetsUrl, which reads 3.2.13 across builds that are not the same build:
 * Ankama shipped buildVersion 1.73.12 over 1.73.10 while moving only the hash
 * that follows it. The cache was declared fresh, the client reported the old
 * number, and the login server answered INCOMPATIBLE_BUILD_VERSION.
 */
function downloadIfChanged(
  url: string,
  etag: string | null,
): Promise<{ body: Buffer | null; etag: string | null }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "User-Agent": MOBILE_UA };
    if (etag) headers["If-None-Match"] = etag;
    https
      .get(url, { headers }, (res) => {
        if (res.statusCode === 304) {
          res.resume();
          resolve({ body: null, etag });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const fresh = typeof res.headers.etag === "string" ? res.headers.etag : null;
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => resolve({ body: Buffer.concat(chunks), etag: fresh }));
      })
      .on("error", reject);
  });
}

/**
 * The build number the client reports at login, read out of the bundle it is
 * baked into. index.html sets window.buildVersion too, but the bundle
 * overwrites it on boot, so this is the number that actually reaches Ankama.
 */
function buildVersionOf(text: string): string | null {
  return /window\.buildVersion="([^"]+)"/.exec(text)?.[1] ?? null;
}

/** Download styles-native.css (sits next to script.js), best-effort. */
async function downloadCss(buildUrl: string, cssPath: string): Promise<void> {
  try {
    const cssUrl = buildUrl.replace(/\/[^/]*$/, "/styles-native.css");
    fs.writeFileSync(cssPath, await download(cssUrl));
    console.log("[dtd] styles-native.css downloaded");
  } catch (e) {
    console.warn("[dtd] styles-native.css failed:", (e as Error).message);
  }
}

/**
 * Download + patch the client bundle (and its stylesheet) into the cache dir.
 * The RAW bundle is cached and patches are re-applied on every launch (so
 * editing patches.json takes effect without re-downloading). Every launch asks
 * the CDN whether the bundle changed, and downloads it only when it did — a
 * conditional GET, so the usual answer is a 304 and no 5 MB.
 */
export async function provisionClientBuild(buildUrl = DEFAULT_CLIENT_BUILD_URL): Promise<void> {
  const buildDir = path.join(gameBaseDir(), "build");
  fs.mkdirSync(buildDir, { recursive: true });

  const rawPath = path.join(buildDir, "script.raw.js");
  const cssPath = path.join(buildDir, "styles-native.css");
  const etagPath = path.join(buildDir, "etag.txt");

  const haveCache = fs.existsSync(rawPath);
  // No ETag for a cache from before this was tracked: it is fetched once more,
  // which is how it gets one — and how a cache that went stale under the old
  // version check is caught.
  const cachedEtag =
    haveCache && fs.existsSync(etagPath) ? fs.readFileSync(etagPath, "utf8").trim() : null;

  try {
    const { body, etag } = await downloadIfChanged(buildUrl, cachedEtag);
    if (body) {
      fs.writeFileSync(rawPath, body);
      // No ETag means no way to ask again: better to re-download every launch
      // than to hold a copy nothing can tell is stale.
      if (etag) fs.writeFileSync(etagPath, etag);
      else fs.rmSync(etagPath, { force: true });
      await downloadCss(buildUrl, cssPath); // versioned in lockstep — refresh too
      console.log("[dtd] client bundle downloaded");
    } else {
      console.log("[dtd] client build unchanged (re-patching)");
    }
  } catch (e) {
    // A launch with no network keeps working off the cache. Only a first run,
    // which has nothing to fall back on, fails.
    if (!haveCache) throw e;
    console.warn("[dtd] client build check failed, using the cache:", (e as Error).message);
  }

  // Left by the version check this replaced; it says 3.2.13 forever and means
  // nothing now.
  fs.rmSync(path.join(buildDir, "version.txt"), { force: true });

  const raw = fs.readFileSync(rawPath, "utf8");
  console.log("[dtd] client buildVersion:", buildVersionOf(raw) ?? "unknown");
  fs.writeFileSync(path.join(buildDir, "script.js"), applyPatches(raw));

  // Guard: ensure the stylesheet exists (older caches, or a failed refresh).
  if (!fs.existsSync(cssPath)) await downloadCss(buildUrl, cssPath);
}
