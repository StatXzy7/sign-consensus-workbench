export interface ParamBlock {
  name: string;
  shape: number[];
  data: number[];
}

export interface MergeInput {
  base: ParamBlock;
  candidates: ParamBlock[];
  selected: number[];
  coefficient: number;
}

export type Sign = "positive" | "negative" | "zero";
export type CoordinateStatus = "positive" | "negative" | "conflict" | "zero";

export interface CandidateDelta {
  index: number;
  name: string;
  delta: number[];
  signs: Sign[];
}

export interface CoordinateExplanation {
  flatIndex: number;
  multiIndex: number[];
  base: number;
  deltas: { candidateIndex: number; name: string; delta: number; sign: Sign }[];
  status: CoordinateStatus;
  kept: boolean;
  merged: number;
  final: number;
}

export interface MergeResult {
  shape: number[];
  size: number;
  deltas: CandidateDelta[];
  mask: boolean[];
  merged: number[];
  finalParams: number[];
  explanations: CoordinateExplanation[];
  usedCandidateIndices: number[];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function fail(message: string): never {
  const error = new Error(message);
  error.name = "MergeInputError";
  throw error;
}

function shapeSize(shape: number[]): number {
  return shape.reduce((product, dim) => product * dim, 1);
}

function validateShape(shape: unknown, label: string): number[] {
  if (!Array.isArray(shape) || shape.length === 0) {
    fail(`${label} 的形状必须是非空数组`);
  }
  return shape.map((dim, axis) => {
    if (!isFiniteNumber(dim) || !Number.isInteger(dim) || dim <= 0) {
      fail(`${label} 的形状第 ${axis + 1} 维必须是正整数`);
    }
    return dim;
  });
}

export function validateBlock(block: unknown, label: string): ParamBlock {
  if (typeof block !== "object" || block === null) {
    fail(`${label}必须是对象`);
  }
  const record = block as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim() === "") {
    fail(`${label}名称必须是非空字符串`);
  }
  const shape = validateShape(record.shape, label);
  if (!Array.isArray(record.data)) {
    fail(`${label}参数数据必须是数组`);
  }
  const expected = shapeSize(shape);
  if (record.data.length !== expected) {
    fail(`${label}参数数据长度 ${record.data.length} 与形状 ${shape.join("x")}（${expected}）不一致，不允许自动补零`);
  }
  const data = record.data.map((value, index) => {
    if (!isFiniteNumber(value)) {
      fail(`${label}第 ${index} 个参数不是有限数值（NaN 或 Infinity 不允许）`);
    }
    return value;
  });
  return { name: record.name, shape, data };
}

export function signOf(value: number): Sign {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "zero";
}

export function multiIndex(flatIndex: number, shape: number[]): number[] {
  const result: number[] = new Array(shape.length).fill(0);
  let remaining = flatIndex;
  for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
    const dim = shape[axis] as number;
    result[axis] = remaining % dim;
    remaining = Math.floor(remaining / dim);
  }
  return result;
}

export function computeMerge(input: MergeInput): MergeResult {
  if (typeof input !== "object" || input === null) {
    fail("请求体必须是对象");
  }
  const base = validateBlock(input.base, "基准块");

  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    fail("至少需要一个候选参数块");
  }
  const candidates = input.candidates.map((candidate, index) =>
    validateBlock(candidate, `候选 #${index + 1}`),
  );

  const size = shapeSize(base.shape);
  candidates.forEach((candidate, index) => {
    if (candidate.name !== base.name) {
      fail(`候选 #${index + 1} 名称 "${candidate.name}" 与基准名称 "${base.name}" 不一致`);
    }
    if (candidate.shape.length !== base.shape.length
      || candidate.shape.some((dim, axis) => dim !== base.shape[axis])) {
      fail(`候选 #${index + 1} 形状 [${candidate.shape.join(",")}] 与基准 [${base.shape.join(",")}] 不一致`);
    }
  });

  if (!Array.isArray(input.selected) || input.selected.length === 0) {
    fail("请至少选择一个参与合并的候选");
  }
  const seen = new Set<number>();
  input.selected.forEach((rawIndex) => {
    if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= candidates.length) {
      fail(`候选下标 ${String(rawIndex)} 越界`);
    }
    if (seen.has(rawIndex)) {
      fail(`候选下标 ${rawIndex} 重复选择`);
    }
    seen.add(rawIndex);
  });

  if (!isFiniteNumber(input.coefficient) || input.coefficient < 0) {
    fail(`系数必须是非负有限数值，收到 ${String(input.coefficient)}`);
  }
  const coefficient = input.coefficient;

  const selectedIndices = [...seen].sort((a, b) => a - b);

  const candidateDeltas: CandidateDelta[] = selectedIndices.map((candidateIndex) => {
    const candidate = candidates[candidateIndex] as ParamBlock;
    const delta: number[] = [];
    const signs: Sign[] = [];
    for (let i = 0; i < size; i += 1) {
      const diff = (candidate.data[i] as number) - (base.data[i] as number);
      delta.push(diff);
      signs.push(signOf(diff));
    }
    return { index: candidateIndex, name: candidate.name, delta, signs };
  });

  const mask: boolean[] = new Array(size).fill(false);
  const merged: number[] = new Array(size).fill(0);
  const explanations: CoordinateExplanation[] = [];

  for (let i = 0; i < size; i += 1) {
    let positives = 0;
    let negatives = 0;
    let zeros = 0;
    const perCandidate = candidateDeltas.map((entry) => {
      const delta = entry.delta[i] as number;
      const sign = entry.signs[i] as Sign;
      if (sign === "positive") positives += 1;
      else if (sign === "negative") negatives += 1;
      else zeros += 1;
      return { candidateIndex: entry.index, name: entry.name, delta, sign };
    });

    let status: CoordinateStatus;
    if (positives > 0 && negatives > 0) status = "conflict";
    else if (zeros > 0) status = "zero";
    else if (positives > 0) status = "positive";
    else status = "negative";

    const kept = status === "positive" || status === "negative";
    const baseValue = base.data[i] as number;
    let mergedValue = 0;
    if (kept) {
      let sum = 0;
      for (const item of perCandidate) sum += item.delta;
      mergedValue = sum / perCandidate.length;
    }
    mask[i] = kept;
    merged[i] = mergedValue;

    explanations.push({
      flatIndex: i,
      multiIndex: multiIndex(i, base.shape),
      base: baseValue,
      deltas: perCandidate,
      status,
      kept,
      merged: mergedValue,
      final: baseValue - coefficient * mergedValue,
    });
  }

  const finalParams = explanations.map((entry) => entry.final);

  return {
    shape: base.shape,
    size,
    deltas: candidateDeltas,
    mask,
    merged,
    finalParams,
    explanations,
    usedCandidateIndices: selectedIndices,
  };
}

export interface BuiltinCase {
  id: string;
  description: string;
  input: MergeInput;
}

export function builtinCase(): BuiltinCase {
  const shape = [2, 3];
  return {
    id: "builtin-sign-conflict-demo",
    description: "包含严格同正、严格同负、符号冲突、零增量与单候选零值的 2x3 内置案例",
    input: {
      base: {
        name: "demo.weight",
        shape,
        data: [1, 0, -2, 4, 5, 6],
      },
      candidates: [
        {
          name: "demo.weight",
          shape,
          data: [2, 1, -3, 4, 5, 5],
        },
        {
          name: "demo.weight",
          shape,
          data: [3, 1, -4, 4, 4, 4],
        },
        {
          name: "demo.weight",
          shape,
          data: [4, 2, -3, 4, 6, 4],
        },
      ],
      selected: [0, 1, 2],
      coefficient: 1,
    },
  };
}
