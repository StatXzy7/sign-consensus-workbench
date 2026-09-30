import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createApp } from "./app.js";

interface CliOptions {
  host: string;
  port: number;
  publicDir: string;
}

function parseArgs(argv: string[]): CliOptions {
  let host = "127.0.0.1";
  let port = 8080;
  let publicDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`参数 ${arg} 缺少取值。`);
      return value;
    };
    if (arg === "--host") {
      host = next();
    } else if (arg === "--port") {
      const raw = next();
      if (!/^\d+$/.test(raw)) throw new Error(`--port 必须是非负整数，收到 ${raw}。`);
      port = Number(raw);
      if (port > 65535) throw new Error("--port 必须在 0..65535 之间。");
    } else if (arg === "--public-dir") {
      publicDir = next();
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "用法: node dist/server/index.js [--host 127.0.0.1] [--port 8080] [--public-dir DIR]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const resolvedPublic = resolve(publicDir ?? joinDefault(here));
  return { host, port, publicDir: resolvedPublic };
}

function joinDefault(here: string): string {
  // dist/server -> dist/public; resolved relative to the module, never a
  // machine-specific shared directory.
  return resolve(here, "..", "public");
}

let options: CliOptions;
try {
  options = parseArgs(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`${(err as Error).message}
使用 --help 查看参数说明。
`);
  process.exit(2);
}
const server = createApp({ publicDir: options.publicDir });

server.on("error", (err) => {
  process.stderr.write(`服务器错误：${(err as Error).message}\n`);
  process.exit(1);
});

server.listen(options.port, options.host, () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    process.stderr.write("无法确定监听地址。\n");
    process.exit(1);
  }
  const actualHost = address.address === "::" ? "localhost" : address.address;
  process.stdout.write(
    `参数合并工作台已启动: http://${actualHost}:${address.port}  (静态目录: ${options.publicDir})\n`,
  );
});
