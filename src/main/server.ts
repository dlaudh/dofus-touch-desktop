import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { gameBaseDir } from "./constants";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
};

/**
 * Serve the game-base cache dir over loopback HTTP. Returns the bound port.
 * Paths are contained within the base dir (no traversal).
 */
export function startServer(): Promise<number> {
  const base = gameBaseDir();
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
      if (rel === "") rel = "index.html";
      const full = path.normalize(path.join(base, rel));
      if (!full.startsWith(base)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      fs.readFile(full, (err, data) => {
        if (err) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": CONTENT_TYPES[path.extname(full)] ?? "application/octet-stream",
        });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as import("net").AddressInfo).port;
      console.log(`[dtd] game-base served at http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}
