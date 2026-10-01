import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { builtinCase, computeMerge, MergeInput } from "./compute";

const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

interface CliOptions {
  host: string;
  port: number;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { host: "127.0.0.1", port: 8080 };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (token === "--host") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--host 需要一个值");
      }
      options.host = value;
      i += 1;
    } else if (token.startsWith("--host=")) {
      options.host = token.slice("--host=".length);
    } else if (token === "--port") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--port 需要一个值");
      }
      options.port = parsePort(value);
      i += 1;
    } else if (token.startsWith("--port=")) {
      options.port = parsePort(token.slice("--port=".length));
    } else if (token === "--help" || token === "-h") {
      throw new Error("用法: node dist/server.js [--host HOST] [--port PORT]");
    } else {
      throw new Error(`未知参数: ${token}`);
    }
  }
  return options;
}

function parsePort(raw: string): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`--port 必须是非负整数，收到 "${raw}"`);
  }
  const port = Number(raw);
  if (port > 65535) {
    throw new Error(`--port 必须在 0-65535 之间，收到 ${port}`);
  }
  return port;
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    request.on("data", (chunk: Buffer) => {
      byteLength += chunk.length;
      if (byteLength > 4 * 1024 * 1024) {
        reject(new Error("请求体超过 4 MiB 限制"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    request.on("error", reject);
  });
}

function serveStatic(request: http.IncomingMessage, response: http.ServerResponse, urlPath: string): void {
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    sendJson(response, 403, { error: "禁止访问" });
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, 404, { error: "资源不存在" });
      return;
    }
    const type = MIME[path.extname(filePath)] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": type });
    response.end(content);
  });
}

export function createServer(): http.Server {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const route = url.pathname;

    if (route === "/api/builtin" && request.method === "GET") {
      sendJson(response, 200, builtinCase());
      return;
    }

    if (route === "/api/merge" && request.method === "POST") {
      readJsonBody(request)
        .then((body) => {
          const result = computeMerge(body as MergeInput);
          sendJson(response, 200, { ok: true, result });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "计算失败";
          sendJson(response, 400, { ok: false, error: message });
        });
      return;
    }

    if (route.startsWith("/api/")) {
      sendJson(response, 404, { error: "未知接口" });
      return;
    }

    if (request.method === "GET") {
      serveStatic(request, response, route);
      return;
    }

    sendJson(response, 405, { error: "不支持的方法" });
  });
}

export function startServer(host: string, port: number): Promise<{ server: http.Server; address: string }> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("无法获取监听地址"));
        return;
      }
      const actualHost = host === "0.0.0.0" ? "127.0.0.1" : host;
      const actual = `http://${actualHost}:${address.port}`;
      resolve({ server, address: actual });
    });
  });
}

const isDirectRun = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.join(__dirname, "server.js");

if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  startServer(options.host, options.port)
    .then(({ address }) => {
      console.log(`参数符号一致性合并工作台已启动: ${address}`);
    })
    .catch((error: Error) => {
      console.error(`启动失败: ${error.message}`);
      process.exit(1);
    });
}
