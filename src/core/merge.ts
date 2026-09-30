import type {
  CoordinateExplanation,
  CoordinateStatus,
  MergeResult,
  ParamBlock,
  WorkbenchInput,
} from "./types.js";

export class MergeValidationError extends Error {}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Convert a flat row-major index to a multi-dimensional coordinate. */
export function indexToCoord(index: number, shape: number[]): number[] {
  const coord: number[] = new Array(shape.length);
  let remainder = index;
  for (let dim = shape.length - 1; dim >= 0; dim--) {
    const size = shape[dim] as number;
    coord[dim] = remainder % size;
    remainder = Math.floor(remainder / size);
  }
  return coord;
}

export function shapeSize(shape: number[]): number {
  return shape.reduce((acc, d) => acc * d, 1);
}

function validateBlock(block: unknown, role: string): ParamBlock {
  if (typeof block !== "object" || block === null) {
    throw new MergeValidationError(`${role} 参数块缺失或不是对象。`);
  }
  const b = block as Record<string, unknown>;
  if (typeof b.name !== "string" || b.name.trim() === "") {
    throw new MergeValidationError(`${role} 参数块缺少名称。`);
  }
  if (!Array.isArray(b.shape) || b.shape.length === 0) {
    throw new MergeValidationError(`${role} 参数块的形状必须是非空数组。`);
  }
  const shape = b.shape as unknown[];
  for (const dim of shape) {
    if (!Number.isInteger(dim) || (dim as number) <= 0) {
      throw new MergeValidationError(
        `${role} 参数块的形状维度必须是正整数，收到 ${String(dim)}。`,
      );
    }
  }
  if (!Array.isArray(b.values)) {
    throw new MergeValidationError(`${role} 参数块的值必须是数组。`);
  }
  const size = shapeSize(shape as number[]);
  const values = b.values as unknown[];
  if (values.length !== size) {
    throw new MergeValidationError(
      `${role} 参数块「${b.name}」的值数量 ${values.length} 与形状 ${shape.join("x")} 的元素数 ${size} 不一致，不会自动补零。`,
    );
  }
  for (const v of values) {
    if (!isFiniteNumber(v)) {
      throw new MergeValidationError(
        `${role} 参数块「${b.name}」含有非有限数值（NaN/Infinity），拒绝合并。`,
      );
    }
  }
  return {
    name: b.name,
    shape: shape as number[],
    values: values as number[],
  };
}

interface NormalizedInput {
  base: ParamBlock;
  candidates: ParamBlock[];
  coefficient: number;
}

/** Fully validate a merge request. Throws MergeValidationError on any problem. */
export function validateInput(input: unknown): NormalizedInput {
  if (typeof input !== "object" || input === null) {
    throw new MergeValidationError("请求体缺失或不是对象。");
  }
  const body = input as Record<string, unknown>;
  const base = validateBlock(body.base, "基准");

  if (!Array.isArray(body.candidates)) {
    throw new MergeValidationError("候选参数块必须是数组。");
  }
  const rawCandidates = body.candidates as unknown[];
  if (rawCandidates.length === 0) {
    throw new MergeValidationError("没有任何候选参数块，保持上一次有效结果。");
  }

  const selectedRaw = body.selectedIds;
  let selectedIds: number[];
  if (selectedRaw === undefined) {
    selectedIds = rawCandidates.map((_, i) => i);
  } else if (!Array.isArray(selectedRaw)) {
    throw new MergeValidationError("参与候选选择必须是下标数组。");
  } else {
    selectedIds = [];
    for (const id of selectedRaw) {
      if (!Number.isInteger(id)) {
        throw new MergeValidationError("参与候选下标必须是整数。");
      }
      if (id < 0 || id >= rawCandidates.length) {
        throw new MergeValidationError(
          `参与候选下标 ${id} 超出候选范围 0..${rawCandidates.length - 1}。`,
        );
      }
      if (!selectedIds.includes(id)) selectedIds.push(id);
    }
    if (selectedIds.length === 0) {
      throw new MergeValidationError("没有选中任何候选，保持上一次有效结果。");
    }
  }

  const candidates: ParamBlock[] = [];
  for (const id of selectedIds) {
    const candidate = validateBlock(rawCandidates[id], `候选#${id + 1}`);
    if (candidate.name !== base.name) {
      throw new MergeValidationError(
        `候选#${id + 1} 名称「${candidate.name}」与基准名称「${base.name}」不一致。`,
      );
    }
    if (
      candidate.shape.length !== base.shape.length ||
      candidate.shape.some((d, k) => d !== base.shape[k])
    ) {
      throw new MergeValidationError(
        `候选「${candidate.name}」的形状 [${candidate.shape.join(",")}] 与基准 [${base.shape.join(",")}] 不一致，不会自动补零。`,
      );
    }
    candidates.push(candidate);
  }

  if (!("coefficient" in body)) {
    throw new MergeValidationError("缺少非负系数 coefficient。");
  }
  if (!isFiniteNumber(body.coefficient) || body.coefficient < 0) {
    throw new MergeValidationError(
      `系数必须是有限的非负数，收到 ${String(body.coefficient)}。`,
    );
  }

  return { base, candidates, coefficient: body.coefficient };
}

/** Pure merge: strict same-sign consensus, equal-weight mean, subtract from base. */
export function computeMerge(
  base: ParamBlock,
  candidates: ParamBlock[],
  coefficient: number,
): MergeResult {
  const shape = base.shape;
  const size = shapeSize(shape);
  const n = candidates.length;

  const deltas = candidates.map((candidate, candidateId) => ({
    candidateId,
    name: candidate.name,
    values: candidate.values.map((v, i) => v - (base.values[i] as number)),
  }));

  const signSummary: MergeResult["signSummary"] = new Array(size);
  const mask = new Array<boolean>(size);
  const status = new Array<CoordinateStatus>(size);
  const merged = new Array<number>(size);
  const final = new Array<number>(size);
  const explanations: CoordinateExplanation[] = new Array(size);

  for (let i = 0; i < size; i++) {
    const coordDeltas = deltas.map((d, candidateId) => ({
      candidateId,
      name: d.name,
      delta: d.values[i] as number,
    }));

    let hasPositive = false;
    let hasNegative = false;
    let hasZero = false;
    let sum = 0;
    for (const entry of coordDeltas) {
      if (entry.delta > 0) hasPositive = true;
      else if (entry.delta < 0) hasNegative = true;
      else hasZero = true;
      sum += entry.delta;
    }

    let coordStatus: CoordinateStatus;
    let summary: (typeof signSummary)[number];
    if (hasPositive && hasNegative) {
      coordStatus = "conflict";
      summary = "conflict";
    } else if (hasZero) {
      coordStatus = "zero";
      summary = "0";
    } else if (hasPositive) {
      coordStatus = "positive";
      summary = "+";
    } else {
      coordStatus = "negative";
      summary = "-";
    }

    const kept = coordStatus === "positive" || coordStatus === "negative";
    const mergedDelta = kept ? sum / n : 0;
    const baseValue = base.values[i] as number;
    const finalValue = baseValue - coefficient * mergedDelta;

    signSummary[i] = summary;
    mask[i] = kept;
    status[i] = coordStatus;
    merged[i] = mergedDelta;
    final[i] = kept ? finalValue : baseValue;

    let note: string;
    if (coordStatus === "positive") {
      note = `全部 ${n} 个候选严格同正，保留等权平均增量 ${fmt(mergedDelta)}。`;
    } else if (coordStatus === "negative") {
      note = `全部 ${n} 个候选严格同负，保留等权平均增量 ${fmt(mergedDelta)}。`;
    } else if (coordStatus === "conflict") {
      note = "候选增量同时出现正与负（符号冲突），该坐标清零。";
    } else if (hasZero && (hasPositive || hasNegative)) {
      note = "部分候选增量为零（零值不算正负），该坐标清零。";
    } else {
      note = "所有候选增量均为零，最终参数保持基准。";
    }

    explanations[i] = {
      index: i,
      coord: indexToCoord(i, shape),
      baseValue,
      deltas: coordDeltas,
      status: coordStatus,
      kept,
      mergedDelta,
      finalValue: final[i] as number,
      note,
    };
  }

  return {
    blockName: base.name,
    shape,
    size,
    deltas,
    signSummary,
    mask,
    merged,
    final,
    status,
    explanations,
    coefficient,
    participatingCandidateIds: candidates.map((_, i) => i),
  };
}

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const rounded = Math.round(v * 1e10) / 1e10;
  return String(rounded);
}

/** Stateful workbench: keeps the last valid result when edits are invalid. */
export class Workbench {
  private lastValid: MergeResult | null = null;

  /** Returns the recomputed result, or null when no successful merge exists yet. */
  get lastResult(): MergeResult | null {
    return this.lastValid;
  }

  /**
   * Validate and recompute. On any invalid edit the previous result is
   * preserved verbatim and the validation error is returned instead.
   */
  apply(input: WorkbenchInput | unknown): {
    ok: true;
    result: MergeResult;
    error: null;
  } | {
    ok: false;
    result: MergeResult | null;
    error: string;
  } {
    try {
      const normalized = validateInput(input);
      const result = computeMerge(
        normalized.base,
        normalized.candidates,
        normalized.coefficient,
      );
      this.lastValid = result;
      return { ok: true, result, error: null };
    } catch (err) {
      return {
        ok: false,
        result: this.lastValid,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
