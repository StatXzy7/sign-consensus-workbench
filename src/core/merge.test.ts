import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeMerge, Workbench, MergeValidationError, validateInput } from "./merge.js";
import type { ParamBlock, WorkbenchInput } from "./types.js";

const EPS = 1e-12;

function block(name: string, shape: number[], values: number[]): ParamBlock {
  return { name, shape, values };
}

function deepClose(actual: number[], expected: number[]): void {
  assert.equal(actual.length, expected.length, "数组长度不一致");
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs((actual[i] as number) - (expected[i] as number)) <= EPS,
      `下标 ${i}: 实际 ${actual[i]} 期望 ${expected[i]}`,
    );
  }
}

describe("computeMerge 合并与负向应用", () => {
  it("严格同正/同负保留等权平均，系数可为负值方向的效果", () => {
    const base = block("w", [4], [10, 20, 30, 40]);
    const c1 = block("w", [4], [12, 18, 30, 39]);
    const c2 = block("w", [4], [14, 16, 31, 37]);

    const result = computeMerge(base, [c1, c2], 0.5);

    // 坐标0: 增量 [2,4] 同正 -> 均值 3
    // 坐标1: 增量 [-2,-4] 同负 -> 均值 -3
    // 坐标2: 增量 [0,1] 含零 -> 清零，保持基准
    // 坐标3: 增量 [-1,-3] 同负 -> 均值 -2
    assert.deepEqual(result.mask, [true, true, false, true]);
    assert.deepEqual(result.signSummary, ["+", "-", "0", "-"]);
    deepClose(result.merged, [3, -3, 0, -2]);

    // final = base - coefficient * merged
    deepClose(result.final, [10 - 0.5 * 3, 20 - 0.5 * -3, 30, 40 - 0.5 * -2]);
    deepClose(result.final, [8.5, 21.5, 30, 41]);

    assert.equal(result.status[0], "positive");
    assert.equal(result.status[1], "negative");
    assert.equal(result.status[2], "zero");
  });

  it("负向（同负）应用会抬升基准参数，零坐标保持基准", () => {
    const base = block("w", [2], [5, 5]);
    const cands = [
      block("w", [2], [4.5, 5]),
      block("w", [2], [4.0, 5]),
      block("w", [2], [3.5, 5]),
    ];
    const result = computeMerge(base, cands, 1);
    assert.deepEqual(result.mask, [true, false]);
    deepClose(result.merged, [-1, 0]);
    deepClose(result.final, [6, 5]);
  });

  it("零系数时最终参数完全等于基准但掩码仍按符号给出", () => {
    const base = block("w", [2], [1, 2]);
    const result = computeMerge(base, [block("w", [2], [3, -2])], 0);
    assert.deepEqual(result.mask, [true, true]);
    deepClose(result.final, [1, 2]);
  });
});

describe("computeMerge 冲突与零值", () => {
  it("正负冲突坐标清零，零值不参与正负", () => {
    const base = block("w", [3], [0, 0, 0]);
    const cands = [
      block("w", [3], [1, 0, 2]),
      block("w", [3], [-1, 0, -2]),
      block("w", [3], [2, 5, 0]),
    ];
    const result = computeMerge(base, cands, 2);

    // 0: + / - / + -> 冲突
    // 1: 0 / 0 / + -> 含零清零
    // 2: + / - / 0 -> 冲突（且含零）
    assert.deepEqual(result.mask, [false, false, false]);
    assert.deepEqual(result.status, ["conflict", "zero", "conflict"]);
    deepClose(result.merged, [0, 0, 0]);
    deepClose(result.final, [0, 0, 0]);
  });

  it("单候选非零增量视为严格一致", () => {
    const result = computeMerge(
      block("w", [1], [10]),
      [block("w", [1], [7])],
      1,
    );
    assert.deepEqual(result.mask, [true]);
    deepClose(result.merged, [-3]);
    deepClose(result.final, [13]);
  });

  it("解释中标注多维坐标", () => {
    const result = computeMerge(
      block("w", [2, 2], [0, 1, 2, 3]),
      [block("w", [2, 2], [0, 2, 1, 3])],
      1,
    );
    assert.deepEqual(result.explanations[0]?.coord, [0, 0]);
    assert.deepEqual(result.explanations[3]?.coord, [1, 1]);
  });
});

describe("候选顺序不变性", () => {
  it("打乱候选顺序得到完全相同的掩码/合并/最终值", () => {
    const base = block("w", [6], [1, 2, 3, 4, 5, 6]);
    const cands = [
      block("w", [6], [1.2, 1.6, 2.4, 4.2, 4.5, 5.7]),
      block("w", [6], [1.4, 1.2, 3.0, 4.4, 4.0, 5.4]),
      block("w", [6], [1.6, 0.8, 3.6, 4.6, 3.5, 5.1]),
    ];
    const a = computeMerge(base, cands, 1.25);
    const b = computeMerge(base, [cands[2]!, cands[0]!, cands[1]!], 1.25);

    assert.deepEqual(a.mask, b.mask);
    assert.deepEqual(a.status, b.status);
    deepClose(b.merged, a.merged);
    deepClose(b.final, a.final);

    // 具体数值断言：内置案例坐标2冲突清零，坐标0同正均值 0.4
    assert.deepEqual(a.mask, [true, true, false, true, true, true]);
    assert.equal(a.status[2], "conflict");
    deepClose(a.merged, [0.4, -0.8, 0, 0.4, -1, -0.6]);
    deepClose(a.final, [0.5, 3, 3, 3.5, 6.25, 6.75]);
  });
});

describe("非法编辑保持上一次有效结果", () => {
  const valid: WorkbenchInput = {
    base: block("w", [2], [0, 0]),
    candidates: [block("w", [2], [1, -1]), block("w", [2], [3, -5])],
    selectedIds: [0, 1],
    coefficient: 1,
  };

  it("无候选时返回错误且保留旧结果", () => {
    const wb = new Workbench();
    const first = wb.apply(valid);
    assert.equal(first.ok, true);

    const bad = wb.apply({ ...valid, candidates: [] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /没有任何候选/);
    assert.strictEqual(bad.result, first.result);
    deepClose(bad.result!.merged, [2, -3]);
  });

  it("名称不一致时拒绝且不偷偷补零", () => {
    const wb = new Workbench();
    wb.apply(valid);
    const bad = wb.apply({
      ...valid,
      candidates: [block("other", [2], [9, 9]), block("w", [2], [3, -5])],
    });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /名称/);
    deepClose(bad.result!.final, [-2, 3]);
  });

  it("形状不一致与值数量不足都拒绝（不补零）", () => {
    const wb = new Workbench();
    wb.apply(valid);

    const shapeBad = wb.apply({
      ...valid,
      candidates: [block("w", [3], [1, 2, 3]), block("w", [2], [3, -5])],
    });
    assert.equal(shapeBad.ok, false);
    assert.match(shapeBad.error, /形状/);

    const shortBad = wb.apply({
      ...valid,
      candidates: [block("w", [2], [1]), block("w", [2], [3, -5])],
    });
    assert.equal(shortBad.ok, false);
    assert.match(shortBad.error, /值数量|不会自动补零/);
    assert.strictEqual(shortBad.result, wb.lastResult);
  });

  it("非有限参数与非法系数被拒绝", () => {
    const wb = new Workbench();
    wb.apply(valid);

    for (const badValue of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const outcome = wb.apply({
        ...valid,
        candidates: [block("w", [2], [badValue, -1]), block("w", [2], [3, -5])],
      });
      assert.equal(outcome.ok, false, `应拒绝 ${String(badValue)}`);
      assert.match(outcome.error, /非有限/);
    }

    for (const badCoefficient of [-0.1, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = wb.apply({ ...valid, coefficient: badCoefficient });
      assert.equal(outcome.ok, false, `应拒绝系数 ${String(badCoefficient)}`);
      assert.match(outcome.error, /系数/);
    }
  });

  it("未产生过有效结果时非法请求返回 null", () => {
    const wb = new Workbench();
    const outcome = wb.apply({ ...valid, candidates: [] });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.result, null);
  });

  it("删除候选后立即用剩余候选重算", () => {
    const wb = new Workbench();
    wb.apply(valid);
    const removed = wb.apply({ ...valid, candidates: [valid.candidates[0]!], selectedIds: [0] });
    assert.equal(removed.ok, true);
    deepClose(removed.result!.merged, [1, -1]);
    deepClose(removed.result!.final, [-1, 1]);
  });

  it("validateInput 直接抛出 MergeValidationError", () => {
    assert.throws(() => validateInput(null), MergeValidationError);
  });
});
