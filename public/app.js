"use strict";

const state = {
  base: null,
  candidates: [],
  selected: [],
  coefficient: 1,
  result: null,
  lastGoodInput: null,
  error: null,
  nextId: 1,
};

const els = {};

function fmt(value, digits) {
  if (!Number.isFinite(value)) return String(value);
  if (Object.is(value, -0)) value = 0;
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e6)) return value.toExponential(3);
  return String(Number(value.toFixed(digits ?? 4)));
}

function parseShape(text) {
  const parts = String(text).split(/[,，xX* ]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("形状不能为空，例如 2x3");
  const shape = parts.map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`形状维度必须是正整数: "${part}"`);
    const dim = Number(part);
    if (dim <= 0) throw new Error("形状维度必须大于 0");
    return dim;
  });
  return shape;
}

function shapeSize(shape) {
  return shape.reduce((p, d) => p * d, 1);
}

function parseData(text, expected, label) {
  const tokens = String(text).split(/[\s,，;；]+/).map((s) => s.trim()).filter(Boolean);
  if (tokens.length !== expected) {
    throw new Error(`${label} 参数个数 ${tokens.length} 与形状所需 ${expected} 不一致，不允许补零`);
  }
  return tokens.map((token, i) => {
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error(`${label} 第 ${i + 1} 个值 "${token}" 不是有限数值`);
    return value;
  });
}

function readBlockFromCard(card, label) {
  const name = card.querySelector(".block-name").value.trim();
  if (!name) throw new Error(`${label}名称不能为空`);
  const shape = parseShape(card.querySelector(".block-shape").value);
  const data = parseData(card.querySelector(".block-data").value, shapeSize(shape), label);
  return { name, shape, data };
}

function dataText(block) {
  return block.data.join(", ");
}

function shapeText(block) {
  return block.shape.join("x");
}

function makeBlockCard(block, label, selectable, index) {
  const card = document.createElement("div");
  card.className = "block-card" + (label === "基准" ? " base" : " candidate");
  const head = document.createElement("div");
  head.className = "block-head";
  if (selectable) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "block-select";
    checkbox.checked = state.selected.includes(index);
    checkbox.title = "参与合并";
    head.appendChild(checkbox);
    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = `#${index + 1}`;
    head.appendChild(idx);
  }
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "block-name";
  nameInput.value = block.name;
  head.appendChild(nameInput);
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  head.appendChild(spacer);
  if (selectable) {
    const up = document.createElement("button");
    up.type = "button";
    up.className = "secondary";
    up.textContent = "↑";
    up.title = "上移（结果不依赖顺序）";
    up.addEventListener("click", () => moveCandidate(index, -1));
    const down = document.createElement("button");
    down.type = "button";
    down.className = "secondary";
    down.textContent = "↓";
    down.title = "下移";
    down.addEventListener("click", () => moveCandidate(index, 1));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "删除";
    del.addEventListener("click", () => deleteCandidate(index));
    head.append(up, down, del);
  }
  card.appendChild(head);

  const shapeLabel = document.createElement("div");
  shapeLabel.className = "field-label";
  shapeLabel.textContent = "形状（如 2x3）";
  const shapeInput = document.createElement("input");
  shapeInput.type = "text";
  shapeInput.className = "block-shape";
  shapeInput.value = shapeText(block);
  card.append(shapeLabel, shapeInput);

  const dataLabel = document.createElement("div");
  dataLabel.className = "field-label";
  dataLabel.textContent = "参数（逗号 / 空格分隔，长度必须与形状一致）";
  const dataInput = document.createElement("textarea");
  dataInput.className = "block-data";
  dataInput.rows = 2;
  dataInput.value = dataText(block);
  card.append(dataLabel, dataInput);

  card.querySelectorAll("input, textarea").forEach((input) => {
    input.addEventListener("input", scheduleRecompute);
  });
  if (selectable) {
    card.querySelector(".block-select").addEventListener("change", () => {
      toggleCandidate(index, card.querySelector(".block-select").checked);
    });
  }
  return card;
}

function renderInputs() {
  els.base.innerHTML = "";
  els.base.appendChild(makeBlockCard(state.base, "基准", false));
  els.candidateList.innerHTML = "";
  state.candidates.forEach((block, index) => {
    const card = makeBlockCard(block, `候选 #${index + 1}`, true, index);
    if (state.selected.includes(index)) card.classList.add("selected");
    els.candidateList.appendChild(card);
  });
}

function collectInput() {
  const baseCard = els.base.querySelector(".block-card");
  const base = readBlockFromCard(baseCard, "基准");
  const candidates = [];
  els.candidateList.querySelectorAll(".block-card.candidate").forEach((card, i) => {
    candidates.push(readBlockFromCard(card, `候选 #${i + 1}`));
  });
  return {
    base,
    candidates,
    selected: [...state.selected].filter((i) => i >= 0 && i < candidates.length),
    coefficient: state.coefficient,
  };
}

let debounceTimer = null;

function scheduleRecompute() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(recompute, 120);
}

async function recompute() {
  let input;
  try {
    input = collectInput();
  } catch (error) {
    showError(`${error.message}\n\n页面编辑非法，仍显示上一次有效结果（不会补零）。`, true);
    renderResults();
    return;
  }

  try {
    const response = await fetch("/api/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.result = payload.result;
    state.lastGoodInput = input;
    state.base = input.base;
    state.candidates = input.candidates;
    state.selected = input.selected;
    state.coefficient = input.coefficient;
    state.error = null;
    els.banner.classList.add("hidden");
    renderResults();
  } catch (error) {
    showError(`${error.message}\n\n已保留上一次有效结果；非法编辑不会被自动补零。`, true);
    renderResults();
  }
}

function showError(message, stale) {
  state.error = message;
  els.banner.textContent = message;
  els.banner.classList.toggle("stale", Boolean(stale));
  els.banner.classList.remove("hidden");
}

function statusLabel(status) {
  return { positive: "同正", negative: "同负", conflict: "冲突", zero: "含零" }[status];
}

function divergingColor(value, maxAbs) {
  if (maxAbs === 0 || value === 0) return "#eef1f5";
  const t = Math.min(1, Math.abs(value) / maxAbs);
  if (value > 0) {
    const light = 245 - Math.round(100 * t);
    return `rgb(${light}, ${248 - Math.round(40 * t)}, ${235 - Math.round(120 * t)})`;
  }
  const light = 245 - Math.round(90 * t);
  return `rgb(${light}, ${247 - Math.round(60 * t)}, 252)`;
}

function finalColor(value, min, max) {
  if (max === min) return "#eef1f5";
  const t = (value - min) / (max - min);
  const light = 250 - Math.round(70 * t);
  return `rgb(255, ${light}, ${250 - Math.round(120 * t)})`;
}

function maskColor(status) {
  if (status === "conflict") return "#c53030";
  if (status === "zero") return "#8a94a0";
  if (status === "positive") return "#2f855a";
  return "#2b6cb0";
}

function svgEl(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
  return node;
}

function gridDims(shape) {
  if (shape.length === 1) return { cols: shape[0], rows: 1 };
  return { cols: shape[shape.length - 1], rows: shapeSize(shape.slice(0, -1)) };
}

function renderHeatmap(title, shape, fillFor, textFor, tooltipFor) {
  const block = document.createElement("div");
  block.className = "heatmap-block";
  const heading = document.createElement("h4");
  heading.textContent = title;
  block.appendChild(heading);

  const { cols, rows } = gridDims(shape);
  const cell = 58;
  const svg = svgEl("svg", {
    width: cols * cell + 2,
    height: rows * cell + 2,
    viewBox: `0 0 ${cols * cell + 2} ${rows * cell + 2}`,
  });
  const size = shapeSize(shape);
  for (let i = 0; i < size; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cell + 1;
    const y = row * cell + 1;
    const rect = svgEl("rect", {
      x, y, width: cell - 2, height: cell - 2, rx: 4,
      fill: fillFor(i), stroke: "#c4ccd4", "stroke-width": 1,
    });
    const titleNode = svgEl("title", {});
    titleNode.textContent = tooltipFor(i);
    rect.appendChild(titleNode);
    svg.appendChild(rect);
    const label = svgEl("text", {
      x: x + cell / 2 - 1, y: y + cell / 2 + 3,
      "text-anchor": "middle", class: "cell-label",
    });
    label.textContent = textFor(i);
    svg.appendChild(label);
  }
  block.appendChild(svg);
  return block;
}

function renderResults() {
  const result = state.result;
  if (!result) {
    els.summary.innerHTML = "<span>尚无有效结果。</span>";
    els.heatmaps.innerHTML = "";
    els.explainWrap.innerHTML = "";
    return;
  }

  const keptCount = result.mask.filter(Boolean).length;
  const counts = { positive: 0, negative: 0, conflict: 0, zero: 0 };
  result.explanations.forEach((entry) => { counts[entry.status] += 1; });
  els.summary.innerHTML =
    `形状 <b>${result.shape.join("x")}</b>（${result.size} 个坐标）· 参与候选 <b>${result.deltas.length}</b> 个 · ` +
    `保留 <b>${keptCount}</b>（同正 ${counts.positive} / 同负 ${counts.negative}）· ` +
    `冲突 <b style="color:#c53030">${counts.conflict}</b> · 含零 ${counts.zero} · 系数 <b>${fmt(state.coefficient, 3)}</b>`;

  els.heatmaps.innerHTML = "";
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML =
    '<span><i style="background:#2f855a"></i>同正保留</span>' +
    '<span><i style="background:#2b6cb0"></i>同负保留</span>' +
    '<span><i style="background:#c53030"></i>符号冲突清零</span>' +
    '<span><i style="background:repeating-linear-gradient(45deg,#8a94a0,#8a94a0 4px,#cbd2da 4px,#cbd2da 8px)"></i>含零清零</span>';
  els.heatmaps.appendChild(legend);

  els.heatmaps.appendChild(renderHeatmap(
    "保留掩码 / 状态",
    result.shape,
    (i) => maskColor(result.explanations[i].status),
    (i) => statusLabel(result.explanations[i].status),
    (i) => `坐标 [${result.explanations[i].multiIndex.join(",")}]：${statusLabel(result.explanations[i].status)}（基准 ${fmt(result.explanations[i].base)}）`,
  ));

  const maxAbs = Math.max(0, ...result.merged.map(Math.abs));
  els.heatmaps.appendChild(renderHeatmap(
    "合并增量（等权平均）",
    result.shape,
    (i) => divergingColor(result.merged[i], maxAbs),
    (i) => fmt(result.merged[i]),
    (i) => `合并增量 = ${fmt(result.merged[i], 8)}（${statusLabel(result.explanations[i].status)}）`,
  ));

  const finalValues = result.finalParams;
  const min = Math.min(...finalValues);
  const max = Math.max(...finalValues);
  els.heatmaps.appendChild(renderHeatmap(
    "最终参数（基准 − 系数 × 合并增量）",
    result.shape,
    (i) => finalColor(finalValues[i], min, max),
    (i) => fmt(finalValues[i]),
    (i) => `最终参数 = ${fmt(finalValues[i], 8)}`,
  ));

  renderExplanations(result);
}

function signMark(sign) {
  return sign === "positive" ? "+" : sign === "negative" ? "−" : "0";
}

function renderExplanations(result) {
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const deltaHeaders = result.deltas.map((entry) =>
    `<th>Δ#${entry.index + 1}</th>`).join("");
  head.innerHTML = `<tr>
    <th class="idx">坐标</th><th>基准</th>${deltaHeaders}<th>状态</th><th>掩码</th><th>合并增量</th><th>最终参数</th>
  </tr>`;
  table.appendChild(head);
  const body = document.createElement("tbody");
  result.explanations.forEach((entry) => {
    const tr = document.createElement("tr");
    if (entry.kept) tr.className = "kept";
    const deltaCells = entry.deltas.map((delta) =>
      `<td class="num" style="color:${delta.sign === "positive" ? "#2f855a" : delta.sign === "negative" ? "#2b6cb0" : "#8a94a0"}">${signMark(delta.sign)}${fmt(delta.delta)}</td>`).join("");
    tr.innerHTML =
      `<td class="idx">[${entry.multiIndex.join(", ")}]</td>` +
      `<td class="num">${fmt(entry.base)}</td>` +
      deltaCells +
      `<td><span class="badge ${entry.status}">${statusLabel(entry.status)}</span></td>` +
      `<td>${entry.kept ? "保留" : "清零"}</td>` +
      `<td class="num">${fmt(entry.merged)}</td>` +
      `<td class="num"><b>${fmt(entry.final)}</b></td>`;
    body.appendChild(tr);
  });
  table.appendChild(body);
  els.explainWrap.innerHTML = "";
  els.explainWrap.appendChild(table);
}

function toggleCandidate(index, checked) {
  const set = new Set(state.selected);
  if (checked) set.add(index); else set.delete(index);
  state.selected = [...set].sort((a, b) => a - b);
  document.querySelectorAll(".block-card.candidate").forEach((card, i) => {
    card.classList.toggle("selected", state.selected.includes(i));
  });
  recompute();
}

function moveCandidate(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= state.candidates.length) return;
  const blocks = [...state.candidates];
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  const remapped = new Set(state.selected.map((i) => (i === index ? target : i === target ? index : i)));
  state.candidates = blocks;
  state.selected = [...remapped].sort((a, b) => a - b);
  state.selected = [...wasSelected].sort((a, b) => a - b);
  renderInputs();
  recompute();
}

function deleteCandidate(index) {
  state.candidates.splice(index, 1);
  state.selected = state.selected
    .filter((i) => i !== index)
    .map((i) => (i > index ? i - 1 : i));
  renderInputs();
  recompute();
}

function addCandidate() {
  const clone = {
    name: state.base.name,
    shape: [...state.base.shape],
    data: [...state.base.data],
  };
  state.candidates.push(clone);
  state.selected.push(state.candidates.length - 1);
  state.selected.sort((a, b) => a - b);
  renderInputs();
  recompute();
}

function setCoefficient(value) {
  state.coefficient = value;
  els.coefficient.value = String(value);
  els.coefficientRange.value = String(value);
  scheduleRecompute();
}

function exportBundle() {
  if (!state.result || !state.lastGoodInput) {
    showError("尚无有效结果可以导出。", false);
    return;
  }
  const bundle = {
    exportedAt: new Date().toISOString(),
    tool: "sign-consensus-workbench",
    input: state.lastGoodInput,
    result: state.result,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "merge-export.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function init() {
  els.base = document.getElementById("base-card");
  els.candidateList = document.getElementById("candidate-list");
  els.banner = document.getElementById("error-banner");
  els.heatmaps = document.getElementById("heatmaps");
  els.explainWrap = document.getElementById("explain-wrap");
  els.summary = document.getElementById("summary");
  els.coefficient = document.getElementById("coefficient");
  els.coefficientRange = document.getElementById("coefficient-range");

  const response = await fetch("/api/builtin");
  const demo = await response.json();
  state.base = demo.input.base;
  state.candidates = demo.input.candidates.map((block) => ({
    name: block.name, shape: [...block.shape], data: [...block.data],
  }));
  state.selected = [...demo.input.selected];
  state.coefficient = demo.input.coefficient;
  els.coefficient.value = String(state.coefficient);
  els.coefficientRange.value = String(state.coefficient);

  renderInputs();
  recompute();

  document.getElementById("add-candidate").addEventListener("click", addCandidate);
  document.getElementById("export-btn").addEventListener("click", exportBundle);
  document.getElementById("reset-demo").addEventListener("click", () => window.location.reload());
  els.coefficient.addEventListener("input", () => {
    const value = Number(els.coefficient.value);
    if (Number.isFinite(value) && value >= 0) setCoefficient(value);
  });
  els.coefficientRange.addEventListener("input", () => setCoefficient(Number(els.coefficientRange.value)));
}

init().catch((error) => showError(`初始化失败: ${error.message}`, false));
