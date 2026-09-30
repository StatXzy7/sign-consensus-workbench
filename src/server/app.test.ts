import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { Workbench } from "../core/merge.js";

const publicDir = mkdtempSync(join(tmpdir(), "scw-public-"));
writeFileSync(join(publicDir, "index.html"), "<html>ok</html>");

let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp({ publicDir, workbench: new Workbench() });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  rmSync(publicDir, { recursive: true, force: true });
});

const validBody = {
  base: { name: "b", shape: [2], values: [0, 0] },
  candidates: [
    { name: "b", shape: [2], values: [1, -1] },
    { name: "b", shape: [2], values: [3, -5] },
  ],
  selectedIds: [0, 1],
  coefficient: 1,
};

describe("HTTP 服务", () => {
  it("GET /api/example 返回内置案例（含正负冲突）", async () => {
    const res = await fetch(`${baseUrl}/api/example`);
    assert.equal(res.status, 200);
    const body = await res.json() as {
      base: { name: string; shape: number[] };
      candidates: unknown[];
    };
    assert.equal(body.base.name, "adapter.lora");
    assert.equal(body.candidates.length, 3);
  });

  it("POST /api/merge 合法请求返回掩码与真实数值", async () => {
    const res = await fetch(`${baseUrl}/api/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      ok: boolean;
      result: { mask: boolean[]; merged: number[]; final: number[] };
    };
    assert.equal(body.ok, true);
    assert.deepEqual(body.result.mask, [true, true]);
    assert.deepEqual(body.result.merged, [2, -3]);
    assert.deepEqual(body.result.final, [-2, 3]);
  });

  it("非法编辑返回 422 且保留上一次有效结果", async () => {
    const res = await fetch(`${baseUrl}/api/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, coefficient: -2 }),
    });
    assert.equal(res.status, 422);
    const body = await res.json() as {
      ok: boolean;
      error: string;
      result: { merged: number[]; final: number[] };
    };
    assert.equal(body.ok, false);
    assert.match(body.error, /系数/);
    assert.deepEqual(body.result.final, [-2, 3]);
  });

  it("非法 JSON 返回 400", async () => {
    const res = await fetch(`${baseUrl}/api/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    assert.equal(res.status, 400);
  });

  it("提供静态页面且路径穿越被拒绝", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<html>/);

    const evil = await fetch(`${baseUrl}/..%2f..%2f..%2fetc%2fpasswd`);
    assert.ok(evil.status === 403 || evil.status === 404);
  });
});
