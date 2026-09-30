/** A named, shaped parameter block. Values are stored in row-major (C) order. */
export interface ParamBlock {
  name: string;
  shape: number[];
  values: number[];
}

/** Editable workbench state sent by the client. */
export interface WorkbenchInput {
  base: ParamBlock;
  candidates: ParamBlock[];
  /** Ids of candidates participating in the merge. */
  selectedIds: number[];
  /** Non-negative scale applied to the averaged consensus delta. */
  coefficient: number;
}

export type CoordinateStatus =
  | "positive"
  | "negative"
  | "conflict"
  | "zero";

export interface CoordinateExplanation {
  index: number;
  coord: number[];
  baseValue: number;
  deltas: { candidateId: number; name: string; delta: number }[];
  status: CoordinateStatus;
  kept: boolean;
  mergedDelta: number;
  finalValue: number;
  note: string;
}

export interface MergeResult {
  blockName: string;
  shape: number[];
  size: number;
  /** Signed delta of every selected candidate at every coordinate. */
  deltas: { candidateId: number; name: string; values: number[] }[];
  /** Per-coordinate sign summary: '+', '-', '0', or 'conflict'. */
  signSummary: ("+" | "-" | "0" | "conflict")[];
  /** True only where every selected delta is strictly positive or strictly negative. */
  mask: boolean[];
  merged: number[];
  final: number[];
  status: CoordinateStatus[];
  explanations: CoordinateExplanation[];
  coefficient: number;
  participatingCandidateIds: number[];
}
