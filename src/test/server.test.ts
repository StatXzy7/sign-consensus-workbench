import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer, parseArgs, startServer } from "../server";
import { builtinCase } from "../compute";

function request(address: string, options: http.RequestOptions, body?: unknown, raw?: string): Promise<{ status: number; json: any; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(address, options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: any = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: response.statusCode ?? 0, json, text });
      });
    });
    req.on("error", reject);
    if (raw !== undefined) req.write(raw);
    else if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test("--host 与 --port 解析, 端口零返回实际端口", async () => {
  assert.deepEqual(parseArgs(["--host", "0.0.0.0", "--port", "3000"]), { host: "0.0.0.0", port: 3000 });
  assert.deepEqual(parseArgs(["--host=127.0.0.1", "--port=0"]), { host: "127.0.0.1", port: 0 });
  assert.throws(() => parseArgs(["--port", "abc"]), /非负整数/);
  assert.throws(() => parseArgs(["--bogus"]), /未知参数/);

  const { server, address } = await startServer("127.0.0.1", 0);
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const match = address.match(/^http:\/\/127\.0\.0\.1:(\d+)$/);
  assert.ok(match && Number(match[1]) > 0, `实际地址异常: ${address}`);

  const builtin = await request(address, { method: "GET", path: "/api/builtin" });
  assert.equal(builtin.status, 200);
  assert.equal(builtin.json.id, builtinCase().id);

  const merged = await request(address, {
    method: "POST",
    path: "/api/merge",
    headers: { "Content-Type": "application/json" },
  }, builtin.json.input);
  assert.equal(merged.status, 200);
  assert.equal(merged.json.ok, true);
  assert.deepEqual(merged.json.result.mask, [true, true, true, false, false, true]);
  assert.ok(Math.abs(merged.json.result.finalParams[0] - (-1)) < 1e-12);

  const bad = await request(address, {
    method: "POST",
    path: "/api/merge",
    headers: { "Content-Type": "application/json" },
  }, { ...builtin.json.input, coefficient: -1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.ok, false);
  assert.match(bad.json.error, /非负/);

  const malformed = await request(address, {
    method: "POST",
    path: "/api/merge",
    headers: { "Content-Type": "application/json" },
  }, undefined, "{not-json");
  assert.equal(malformed.status, 400);
  assert.match(malformed.json.error, /JSON/);

  const home = await request(address, { method: "GET", path: "/" });
  assert.equal(home.status, 200);
  assert.match(home.text, /参数符号一致性/);

  const js = await request(address, { method: "GET", path: "/app.js" });
  assert.equal(js.status, 200);

  const missing = await request(address, { method: "GET", path: "/nope.txt" });
  assert.equal(missing.status, 404);

  const escape = await request(address, { method: "GET", path: "/../package.json" });
  assert.notEqual(escape.status, 200);
});

test("createServer 拒绝未知接口与方法", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const unknown = await request(`http://127.0.0.1:${port}`, { method: "POST", path: "/api/unknown" });
  assert.equal(unknown.status, 404);
});
