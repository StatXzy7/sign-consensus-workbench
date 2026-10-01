import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinCase, computeMerge, MergeInput } from "../compute";

function mergeInput(overrides: Partial<MergeInput> = {}): MergeInput {
  return {
    base: { name: "w", shape: [4], data: [1, 0, -2, 4] },
    candidates: [
      { name: "w", shape: [4], data: [2, 1, -1, 4] },
      { name: "w", shape: [4], data: [3, 1, 0, 4] },
      { name: "w", shape: [4], data: [4, 2, -3, 4] },
    ],
    selected: [0, 1, 2],
    coefficient: 1,
    ...overrides,
  };
}

test("等权平均合并与按系数负向应用", () => {
  const result = computeMerge(mergeInput());
  assert.deepEqual(result.mask, [true, true, false, false]);
  assert.deepEqual(result.usedCandidateIndices, [0, 1, 2]);

  assert.equal(result.explanations[0]!.status, "positive");
  const merged0 = (1 + 2 + 3) / 3;
  assert.ok(Math.abs(result.merged[0]! - merged0) < 1e-12);
  assert.equal(result.finalParams[0]!, 1 - merged0);

  assert.equal(result.explanations[1]!.status, "positive");
  const merged1 = (1 + 1 + 2) / 3;
  assert.ok(Math.abs(result.merged[1]! - merged1) < 1e-12);
  assert.equal(result.finalParams[1]!, 0 - merged1);

  assert.equal(result.merged[2], 0);
  assert.equal(result.merged[3], 0);
  assert.equal(result.finalParams[2], -2);
  assert.equal(result.finalParams[3], 4);
});

test("可调非负系数: 系数为 0 时最终参数等于基准; 系数为 2 时双倍减去", () => {
  const zero = computeMerge(mergeInput({ coefficient: 0 }));
  assert.deepEqual(zero.finalParams, [1, 0, -2, 4]);
  assert.deepEqual(zero.mask, [true, true, false, false]);

  const doubled = computeMerge(mergeInput({ coefficient: 2 }));
  const merged0 = (1 + 2 + 3) / 3;
  const merged1 = (1 + 1 + 2) / 3;
  assert.ok(Math.abs(doubled.finalParams[0]! - (1 - 2 * merged0)) < 1e-12);
  assert.ok(Math.abs(doubled.finalParams[1]! - (0 - 2 * merged1)) < 1e-12);
  assert.equal(doubled.finalParams[2], -2);
  assert.equal(doubled.finalParams[3], 4);
});

test("冲突坐标与零值坐标必须清零, 严格同负坐标保留", () => {
  const input = mergeInput({
    base: { name: "w", shape: [5], data: [0, 0, 0, 0, 10] },
    candidates: [
      { name: "w", shape: [5], data: [1, 1, 0, -1, 8] },
      { name: "w", shape: [5], data: [-1, 0, 2, -2, 4] },
      { name: "w", shape: [5], data: [2, -1, 3, -3, 1] },
    ],
  });
  const result = computeMerge(input);
  assert.deepEqual(result.mask, [false, false, false, true, true]);
  assert.deepEqual(
    result.explanations.map((entry) => entry.status),
    ["conflict", "conflict", "zero", "negative", "negative"],
  );

  assert.equal(result.merged[0], 0);
  assert.equal(result.merged[1], 0);
  assert.equal(result.merged[2], 0);
  assert.ok(Math.abs(result.merged[3]! - ((-1) + (-2) + (-3)) / 3) < 1e-12);
  assert.ok(Math.abs(result.merged[4]! - ((-2) + (-6) + (-9)) / 3) < 1e-12);

  assert.deepEqual(result.finalParams.slice(0, 3), [0, 0, 0]);
  assert.ok(Math.abs(result.finalParams[3]! - (0 - -2)) < 1e-12);
  assert.ok(Math.abs(result.finalParams[4]! - (10 - -17 / 3)) < 1e-12);
});

test("单个候选时按其自身符号保留或清零", () => {
  const input = mergeInput({ selected: [0] });
  const result = computeMerge(input);
  assert.deepEqual(result.mask, [true, true, true, false]);
  assert.deepEqual(
    result.explanations.map((entry) => entry.status),
    ["positive", "positive", "positive", "zero"],
  );
  assert.equal(result.merged[0], 1);
  assert.equal(result.merged[2], 1);
  assert.equal(result.merged[3], 0);
  assert.equal(result.finalParams[3], 4);
});

test("候选顺序变化不改变掩码、合并值与最终参数", () => {
  const forward = computeMerge(mergeInput({ selected: [0, 1, 2] }));
  const reversed = computeMerge(mergeInput({
    candidates: [...mergeInput().candidates].reverse(),
    selected: [2, 1, 0],
  }));
  const permuted = computeMerge(mergeInput({ selected: [2, 0, 1] }));

  for (const other of [reversed, permuted] as typeof forward[]) {
    assert.deepEqual(other.mask, forward.mask);
    for (let i = 0; i < forward.size; i += 1) {
      assert.ok(Math.abs(other.merged[i]! - forward.merged[i]!) < 1e-12);
      assert.ok(Math.abs(other.finalParams[i]! - forward.finalParams[i]!) < 1e-12);
    }
  }
});

test("删除候选后立即重算: 原来被冲突压制的坐标可能重新保留", () => {
  const all = computeMerge(mergeInput({ selected: [0, 1, 2] }));
  assert.deepEqual(all.mask, [true, true, false, false]);

  const removed = computeMerge(mergeInput({ selected: [0, 1] }));
  assert.deepEqual(removed.mask, [true, true, true, false]);
  assert.ok(Math.abs(removed.merged[2]! - 1.5) < 1e-12);
  assert.ok(Math.abs(removed.finalParams[2]! - (-2 - 1.5)) < 1e-12);
  const removedOnly = computeMerge(mergeInput({ selected: [2] }));
  assert.deepEqual(removedOnly.mask, [true, true, true, false]);
  assert.equal(removedOnly.merged[2], -1);
  assert.equal(removedOnly.finalParams[2], -1);
});

test("非法输入: 无候选/名称不符/形状不符/非有限值/非法系数均抛出且不补零", () => {
  const valid = mergeInput();

  assert.throws(() => computeMerge(mergeInput({ candidates: [] })), /至少需要一个候选/);
  assert.throws(() => computeMerge(mergeInput({ selected: [] })), /至少选择/);
  assert.throws(
    () => computeMerge(mergeInput({ selected: [0, 1, 2, 3] })),
    /越界/,
  );
  assert.throws(
    () => computeMerge(mergeInput({
      candidates: [{ name: "other", shape: [4], data: [0, 0, 0, 0] }, ...valid.candidates],
      selected: [0, 1, 2, 3],
    })),
    /名称/,
  );
  assert.throws(
    () => computeMerge(mergeInput({
      candidates: [
        valid.candidates[0] as never,
        { name: "w", shape: [3], data: [0, 0, 0] },
        valid.candidates[2] as never,
      ],
    })),
    /形状/,
  );
  assert.throws(
    () => computeMerge(mergeInput({
      candidates: [
        valid.candidates[0] as never,
        { name: "w", shape: [4], data: [9, 1, -1, 4, 100] },
        valid.candidates[2] as never,
      ],
    })),
    /不允许自动补零/,
  );
  assert.throws(
    () => computeMerge(mergeInput({
      base: { name: "w", shape: [4], data: [1, NaN, -2, 4] },
    })),
    /有限数值/,
  );
  assert.throws(
    () => computeMerge(mergeInput({
      candidates: [
        { name: "w", shape: [4], data: [Infinity, 1, -1, 4] },
        valid.candidates[1] as never,
        valid.candidates[2] as never,
      ],
    })),
    /有限数值/,
  );
  assert.throws(() => computeMerge(mergeInput({ coefficient: -0.5 })), /非负/);
  assert.throws(() => computeMerge(mergeInput({ coefficient: Number.NaN })), /非负/);
  assert.throws(() => computeMerge(mergeInput({ coefficient: Number.POSITIVE_INFINITY })), /非负/);
  assert.throws(() => computeMerge(null as unknown as MergeInput), /请求体/);
});

test("非法编辑后调用方仍可取得上一次有效结果", () => {
  const lastGood = computeMerge(mergeInput({ coefficient: 1 }));
  let retained: unknown;
  try {
    computeMerge(mergeInput({ coefficient: -9 }));
  } catch {
    retained = lastGood;
  }
  assert.ok(retained);
  assert.deepEqual((retained as typeof lastGood).mask, [true, true, false, false]);
  assert.equal((retained as typeof lastGood).finalParams[0], 1 - 2);
});

test("内置案例同时包含正向、负向、冲突与零值", () => {
  const demo = builtinCase();
  const result = computeMerge(demo.input);
  assert.deepEqual(
    result.explanations.map((entry) => entry.status),
    ["positive", "positive", "negative", "zero", "conflict", "negative"],
  );
  assert.deepEqual(result.mask, [true, true, true, false, false, true]);
  const expectedMerged = [2, 4 / 3, -4 / 3, 0, 0, -5 / 3];
  result.merged.forEach((value, i) => {
    assert.ok(Math.abs(value - expectedMerged[i]!) < 1e-12, `merged[${i}]=${value}`);
  });
  const expectedFinal = [1 - 2, -4 / 3, -2 + 4 / 3, 4, 5, 6 + 5 / 3];
  result.finalParams.forEach((value, i) => {
    assert.ok(Math.abs(value - expectedFinal[i]!) < 1e-12, `final[${i}]=${value}`);
  });
  assert.deepEqual(result.explanations[0]!.multiIndex, [0, 0]);
  assert.deepEqual(result.explanations[2]!.multiIndex, [0, 2]);
  assert.deepEqual(result.explanations[5]!.multiIndex, [1, 2]);
});
