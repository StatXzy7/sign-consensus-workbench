import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";
import { Workbench } from "../core/merge.js";
import { builtinExample } from "../core/example.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface AppDeps {
  publicDir: string;
  workbench?: Workbench;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error("请求体超过 4MB 上限。"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolvePromise(text.length === 0 ? {} : JSON.parse(text));
      } catch (err) {
        rejectPromise(new Error(`请求体不是合法 JSON：${(err as Error).message}`));
      }
    });
    req.on("error", rejectPromise);
  });
}

function serveStatic(publicDir: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const safePath = normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = resolve(join(publicDir, safePath));
  const root = resolve(publicDir);
  if (!filePath.startsWith(root + "/") && filePath !== root) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

export function createApp(deps: AppDeps): Server {
  const workbench = deps.workbench ?? new Workbench();

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/example") {
      sendJson(res, 200, builtinExample());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, { result: workbench.lastResult });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/merge") {
      let body: unknown;
      try {
        body = await readJson(req);
      } catch (err) {
        sendJson(res, 400, {
          ok: false,
          result: workbench.lastResult,
          error: (err as Error).message,
        });
        return;
      }
      const outcome = workbench.apply(body);
      sendJson(res, outcome.ok ? 200 : 422, outcome);
      return;
    }

    if (req.method === "GET") {
      serveStatic(deps.publicDir, req, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed" });
  });
}
