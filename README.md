# sign-consensus-workbench

本地 CPU 参数增量符号一致性合并工作台。输入一个带名称与形状的**基准参数块**和若干**候选参数块**，
检查各候选相对基准的增量在同一坐标上的符号一致性，只保留**所有候选严格同正或严格同负**的坐标，
对保留增量做等权平均，再按可调的非负系数 α 从基准中减去：

```
delta_i,k = candidate_k[i] - base[i]
共识: 所有 delta_i,k 同号且均不为 0（零不算正负）
merged[i] = mean_k(delta_i,k)   若共识成立，否则 0
final[i]  = base[i] - α * merged[i]
```

- 任一候选在某坐标为零、或出现正负符号冲突 → 该坐标掩码为 0，合并增量清零
- 全零（或被清零）坐标的最终参数**保持基准值**
- 候选顺序变化不影响结果；删除候选后立即重算
- 无候选、名称/形状不一致、值数量不匹配（**不偷偷补零**）、非有限数值、非法系数
  → 返回错误并**保持上一次有效结果**

技术栈：TypeScript + Node.js（仅内置 `http`/`fs`，运行时零第三方依赖），页面为原生 HTML + SVG。

## 使用

```bash
npm install
npm test        # tsc 编译 + node:test 自动化测试
npm run build   # 编译到 dist/ 并拷贝静态页面到 dist/public/
npm start       # 默认 http://127.0.0.1:8080
```

服务参数：

```bash
node dist/server/index.js --host 0.0.0.0 --port 9000
node dist/server/index.js --port 0          # 端口 0：启动后打印实际监听地址
node dist/server/index.js --public-dir DIR  # 覆盖静态目录（默认相对模块的 dist/public）
```

## HTTP 接口

- `GET /api/example`：内置 2×3 案例（含正共识、负共识、正负冲突与零值）
- `POST /api/merge`：请求体即完整输入，返回掩码、合并向量、最终参数与逐坐标解释；
  非法编辑返回 422 且响应体仍携带上一次有效结果
- `GET /api/state`：读取当前服务端保留的上一次有效结果
- 其余 GET 提供静态页面

## 导出

页面「导出 JSON」下载的文件包含：

- `input`：可直接 POST 到 `/api/merge` 完整重算的输入（基准、全部候选、选择、系数）
- `result`：掩码、合并增量、最终参数及逐坐标解释的真实数值
- `error`：当前编辑若非法时的错误信息

## 目录结构

```
src/core/types.ts     数据类型
src/core/merge.ts     校验、纯函数合并、Workbench（保持上次有效结果）
src/core/example.ts   内置案例
src/core/merge.test.ts
src/server/app.ts     HTTP 应用（可注入临时目录做测试）
src/server/index.ts   CLI 入口（--host/--port/--public-dir）
src/server/app.test.ts
web/                  前端（index.html + app.js，SVG 热图）
```

## 依赖

仅两个开发依赖：`typescript`、`@types/node`；无外部服务或模型。
