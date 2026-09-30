import type { WorkbenchInput } from "./types.js";

/**
 * Built-in 2x3 case covering every outcome:
 *  col 0: strict positive consensus
 *  col 1: strict negative consensus
 *  col 2: + / 0 / -  -> sign conflict at row 0
 */
export function builtinExample(): WorkbenchInput {
  return {
    base: {
      name: "adapter.lora",
      shape: [2, 3],
      values: [1, 2, 3, 4, 5, 6],
    },
    candidates: [
      {
        name: "adapter.lora",
        shape: [2, 3],
        values: [1.2, 1.6, 2.4, 4.2, 4.5, 5.7],
      },
      {
        name: "adapter.lora",
        shape: [2, 3],
        values: [1.4, 1.2, 3.0, 4.4, 4.0, 5.4],
      },
      {
        name: "adapter.lora",
        shape: [2, 3],
        values: [1.6, 0.8, 3.6, 4.6, 3.5, 5.1],
      },
    ],
    selectedIds: [0, 1, 2],
    coefficient: 1,
  };
}
