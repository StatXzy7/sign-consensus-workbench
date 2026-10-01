# 参数符号一致性合并工作台 (sign-consensus-workbench)

纯本地 Linux CPU 工作台，用于检查多个小型参数增量在同一坐标上的符号一致性。
TypeScript + Node.js（仅内置模块，零运行时依赖）提供计算与 HTTP 服务，页面使用原生 HTML + SVG。

## 合并规则

1. 对每个候选参数块计算相对基准的增量 `delta = candidate - base`。
2. 逐坐标检查所有**被选中**候选的符号：
   - 严格同正或严格同负 → 保留；
   - 任一候选增量为零，或同时存在正与负（符号冲突）→ 该坐标清零；
   - 零值既不算正也不算负。
3. 对保留坐标做等权平均，得到合并增量 `merged`；被清零坐标 `merged = 0`。
4. 最终参数 `final = base - coefficient * merged`，`coefficient >= 0` 可调。
   因此全零坐标（掩码为 false）的最终参数严格保持基准值。
5. 候选顺序不影响掩码、合并值与最终结果；删除 / 取消选择候选会立即重算。

非法输入（无候选、块名称或形状不一致、数据长度与形状不符、NaN/Infinity、负数或非有限系数）
不会被自动补零，服务返回 400，前端保留并继续显示上一次有效结果及错误横幅。

## 使用

```bash
npm install
npm test     # tsc 编译 + node --test 自动化测试
npm run build
npm start -- --host 0.0.0.0 --port 8080
```

- `--host` 默认 `127.0.0.1`，`--port` 默认 `8080`；支持 `--host=x --port=y` 形式。
- `--port 0` 时由系统分配端口，启动后打印实际访问地址，例如
  `参数符号一致性合并工作台已启动: http://127.0.0.1:45369`。
- 静态页面目录通过相对于编译产物的路径解析（`dist/../public`），不硬编码共享目录。

## HTTP 接口

- `GET /api/builtin`：内置小型案例（2x3，含同正、同负、冲突、零值坐标）。
- `POST /api/merge`：请求体
  ```json
  {
    "base": { "name": "w", "shape": [2, 3], "data": [...] },
    "candidates": [ { "name": "w", "shape": [2, 3], "data": [...] } ],
    "selected": [0, 2],
    "coefficient": 1.0
  }
  ```
  返回 `{ "ok": true, "result": { shape, size, deltas, mask, merged, finalParams, explanations, ... } }`。
  `explanations` 含逐坐标的基准值、每个候选的增量与符号、状态、掩码、合并增量和最终参数。

页面的「导出」按钮会下载包含完整重算输入（base/candidates/selected/coefficient）与全部数值结果的 JSON。

## 页面

- 左侧：可编辑基准块 / 候选块名称、形状、参数；勾选参与候选；调整非负系数（数字框 + 滑块联动）；添加 / 删除 / 上移 / 下移候选。
- 右侧：保留掩码、合并增量、最终参数三张 SVG 热图（绿=同正，蓝=同负，红=冲突，灰=含零），以及逐坐标解释表。

## 依赖

新增依赖仅为开发期的 `typescript` 与 `@types/node`；无外部服务、模型或网络调用。
