# Dofus Touch Desktop

A clean Electron wrapper that runs the **official Dofus Touch client** on
desktop (Windows/macOS/Linux). Rebuilt from scratch in TypeScript — no bots or
automation, just the client on your PC with one account per window, plus a set
of optional quality-of-life tweaks (damage estimator, resource counts, health
bars, etc.).

---

## ⚠️ Legal

Dofus Touch is the property of **Ankama**. This is an **unofficial client**
that connects to Ankama's official servers. Per Ankama's Terms of Use,
unofficial clients are a **bannable** offense. Use at your own
risk. This project is not affiliated with or endorsed by Ankama.

---

## Run

```bash
npm install
npm start        # compiles TS and launches Electron
```

First launch downloads the client bundle (~5 MB) into your user-data dir and
caches it; the window reloads automatically when it's ready. The bundle is only
re-downloaded when Ankama ships a new client version (detected from
`config.json`'s `assetsUrl`); otherwise the cache is reused and patches are just
re-applied.

- **Cmd/Ctrl+N** — open another isolated game window (another account).

## How it works

Ankama no longer serves a directly-loadable client URL, so the app bootstraps
the client locally:

1. **`game-base/`** — a small local bootstrap (`index.html`) that fakes the
   Cordova/Android environment the mobile client expects, fetches Ankama's
   `config.json`, and loads the client bundle.
2. The **main process** serves `game-base/` over loopback HTTP, downloads and
   regex-patches the client bundle (`build/script.js`) into a cache dir, and
   opens a `BrowserWindow` with **`webSecurity: false`** (native cross-origin
   requests, no CORS) + a mobile user-agent + a per-account persistent session
   partition.
3. **Login** — the client's OAuth flow opens in a dedicated auth window; the
   `dofustouch://authorized?code=...` redirect is captured and handed back to
   the client's own deeplink handler (`game-base/index.html`).

Desktop fixes (mouse→touch translation, window-shape layout) live in
`game-base/fixes.js` and `game-base/fixes.css`; client patches in
`game-base/patches.json`. Optional quality-of-life mods (`game-base/mods/*.js`,
loaded by `game-base/mods.js`) are always on.

## Structure

```
src/
  main/            Electron main process (TypeScript)
    index.ts       app lifecycle + IPC
    constants.ts   UA, URLs, paths
    gameBase.ts    provision: copy static + download/patch bundle
    server.ts      loopback static server
    windows.ts     game window + auth window (deeplink capture)
    menu.ts        native menu (New Window)
  preload/
    index.ts       window.__dtd bridge (openAuth / newWindow / notify)
game-base/         local client bootstrap (served at runtime)
  index.html       fake Cordova env + config fetch + client loader
  fixes.js/.css    runtime + style desktop fixes
  patches.json     regex transforms applied to the client bundle
  mods.js          loads the helpers, then the quality-of-life mods
  mods/            one .js per QoL mod (damage estimator, show resources, …)
    helpers/       shared code the mods build on (mod-api, camera-watch, …)
  local/           staged from settings.json's localModsDir; not in the repo
dist/              compiled output (gitignored)
```

## Scripts

- `npm start` — build + run
- `npm run build` — compile TypeScript to `dist/`
- `npm run watch` — recompile on change
- `npm run dist` — package with electron-builder

## License

GPL-3.0. The wrapper in `src/` is this project's own code; the `game-base`
submodule's mods, layout rules and client patches are ported from
[Lindo](https://github.com/zenoxs/lindo) (GPL-3.0), which is why the whole
project carries that license. See [NOTICE](NOTICE) and [LICENSE](LICENSE).
