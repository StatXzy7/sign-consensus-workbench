"use strict";

const state = {
  base: { name: "", shape: [], values: [] },
  candidates: [],
  selected: [],
  coefficient: 1,
  result: null,
  error: null,
};

const $ = (id) => document.getElementById(id);

function parseShape(text) {
  const parts = text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  const dims = parts.map(Number);
  return dims;
}

function parseValues(text) {
  const parts = text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((token) => {
    if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(token)) return Number(token);
    return Number.NaN;
  });
}

function vecText(values, digits) {
  return values.map((v) => {
    if (!Number.isFinite(v)) return String(v);
    const r = Math.round(v * 1e8) / 1e8;
    return Object.is(r, -0) ? "0" : String(r);
  }).join(", ");
}

function shapeText(shape) {
  return shape.join(",");
}

function renderCandidateEditor() {
  const list = $("candidate-list");
  list.innerHTML = "";
  state.candidates.forEach((candidate, id) => {
    const wrap = document.createElement("div");
    wrap.className = "candidate";

    const head = document.createElement("div");
    head.className = "head";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.selected.includes(id);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (!state.selected.includes(id)) state.selected.push(id);
      } else {
        state.selected = state.selected.filter((x) => x !== id);
      }
      scheduleCompute();
    });
    const title = document.createElement("span");
    title.className = "nm";
    title.textContent = `候选 ${id + 1}`;
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      state.candidates.splice(id, 1);
      let nextSelected = state.selected
        .map((sel) => (sel > id ? sel - 1 : sel))
        .filter((sel) => sel !== id);
      if (nextSelected.length === 0 && state.candidates.length > 0) {
        nextSelected = state.candidates.map((_, i) => i);
      }
      state.selected = nextSelected;
      renderCandidateEditor();
      scheduleCompute();
    });
    head.append(cb, title, del);

    const shapeLabel = document.createElement("label");
    shapeLabel.textContent = "形状";
    const shapeInput = document.createElement("input");
    shapeInput.type = "text";
    shapeInput.value = shapeText(candidate.shape);
    shapeInput.addEventListener("input", () => {
      candidate.shape = parseShape(shapeInput.value);
      scheduleCompute();
    });

    const valLabel = document.createElement("label");
    valLabel.textContent = "参数值（逗号或空白分隔）";
    const valInput = document.createElement("textarea");
    valInput.rows = 2;
    valInput.value = candidate.values.join(", ");
    valInput.addEventListener("input", () => {
      candidate.values = parseValues(valInput.value);
      scheduleCompute();
    });

    wrap.append(head, shapeLabel, shapeInput, valLabel, valInput);
    list.append(wrap);
  });
  if (state.candidates.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "暂无候选。可新增候选或载入内置案例。";
    list.append(p);
  }
}

function readBaseFromForm() {
  state.base.name = $("base-name").value.trim();
  state.base.shape = parseShape($("base-shape").value);
  state.base.values = parseValues($("base-values").value);
}

function hydrateBaseForm() {
  $("base-name").value = state.base.name;
  $("base-shape").value = shapeText(state.base.shape);
  $("base-values").value = state.base.values.join(", ");
}

function loadIntoState(payload) {
  state.base = {
    name: payload.base.name,
    shape: payload.base.shape.slice(),
    values: payload.base.values.slice(),
  };
  state.candidates = payload.candidates.map((c) => ({
    name: c.name,
    shape: c.shape.slice(),
    values: c.values.slice(),
  }));
  state.selected = payload.selectedIds.slice();
  state.coefficient = payload.coefficient;
  $("coefficient").value = String(payload.coefficient);
  hydrateBaseForm();
  renderCandidateEditor();
  scheduleCompute();
}

let timer = null;
function scheduleCompute() {
  clearTimeout(timer);
  timer = setTimeout(compute, 120);
}

async function compute() {
  readBaseFromForm();
  state.coefficient = Number($("coefficient").value);
  const payload = {
    base: state.base,
    candidates: state.candidates,
    selectedIds: [...state.selected].sort((a, b) => a - b),
    coefficient: state.coefficient,
  };
  let res;
  try {
    res = await fetch("/api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    state.error = `无法连接计算服务：${err.message}`;
    renderError();
    return;
  }
  const body = await res.json();
  if (body.ok) {
    state.result = body.result;
    state.error = null;
  } else {
    state.error = body.error;
    if (body.result) state.result = body.result;
  }
  renderAll();
}

const STATUS_STYLE = {
  positive: { color: "var(--pos)", chip: "pos", text: "同正保留" },
  negative: { color: "var(--neg)", chip: "neg", text: "同负保留" },
  conflict: { color: "var(--conflict)", chip: "conflict", text: "正负冲突" },
  zero: { color: "var(--zero)", chip: "zero", text: "含零/全零" },
};

function heatColor(status) {
  return STATUS_STYLE[status] ? STATUS_STYLE[status].color : "var(--zero)";
}

function renderHeatmap() {
  const host = $("heatmap");
  host.innerHTML = "";
  const result = state.result;
  if (!result) {
    host.textContent = "尚无有效结果。";
    return;
  }
  const shape = result.shape;
  const cols = shape[shape.length - 1];
  const rows = result.size / cols;
  const cell = 64;
  const labelW = 96;
  const labelH = 24;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", String(labelW + cols * cell + 8));
  svg.setAttribute("height", String(labelH + rows * cell + 8));
  svg.setAttribute("role", "img");

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const exp = result.explanations[i];
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(labelW + c * cell));
      rect.setAttribute("y", String(labelH + r * cell));
      rect.setAttribute("width", String(cell - 2));
      rect.setAttribute("height", String(cell - 2));
      rect.setAttribute("rx", "5");
      rect.setAttribute("class", "cell");
      rect.setAttribute("fill", heatColor(exp.status));
      const title = document.createElementNS(svgNS, "title");
      title.textContent =
        `[${exp.coord.join(",")}] ${STATUS_STYLE[exp.status].text}\n` +
        `基准=${exp.baseValue} 平均增量=${exp.mergedDelta} 最终=${exp.finalValue}\n` +
        exp.note;
      rect.append(title);

      const t1 = document.createElementNS(svgNS, "text");
      t1.setAttribute("x", String(labelW + c * cell + 6));
      t1.setAttribute("y", String(labelH + r * cell + 20));
      t1.setAttribute("fill", "#fff");
      t1.setAttribute("font-size", "11");
      t1.textContent = `[${exp.coord.join(",")}]`;

      const t2 = document.createElementNS(svgNS, "text");
      t2.setAttribute("x", String(labelW + c * cell + 6));
      t2.setAttribute("y", String(labelH + r * cell + 40));
      t2.setAttribute("fill", "#fff");
      t2.setAttribute("font-size", "11");
      t2.textContent = fmtShort(exp.mergedDelta);

      const t3 = document.createElementNS(svgNS, "text");
      t3.setAttribute("x", String(labelW + c * cell + 6));
      t3.setAttribute("y", String(labelH + r * cell + 56));
      t3.setAttribute("fill", "rgba(255,255,255,.85)");
      t3.setAttribute("font-size", "10");
      t3.textContent = `→ ${fmtShort(exp.finalValue)}`;

      svg.append(rect, t1, t2, t3);
    }
  }
  host.append(svg);
}

function fmtShort(v) {
  if (!Number.isFinite(v)) return String(v);
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}

function signChip(sign) {
  const map = { "+": ["pos", "+"], "-": ["neg", "−"], "0": ["zero", "0"], conflict: ["conflict", "±"] };
  const [cls, txt] = map[sign];
  return `<span class="chip ${cls}">${txt}</span>`;
}

function renderDeltaSigns() {
  const host = $("delta-signs");
  const result = state.result;
  if (!result) {
    host.textContent = "尚无有效结果。";
    return;
  }
  let html = "<table><thead><tr><th class='idx'>坐标</th>";
  for (const d of result.deltas) {
    html += `<th>候选 ${d.candidateId + 1}<br/><span class='muted'>${escapeHtml(d.name)}</span></th>`;
  }
  html += "<th>汇总</th></tr></thead><tbody>";
  for (let i = 0; i < result.size; i++) {
    const exp = result.explanations[i];
    html += `<tr><td class='idx'>[${exp.coord.join(",")}]</td>`;
    for (const d of result.deltas) {
      const delta = d.values[i];
      const sign = delta > 0 ? "+" : delta < 0 ? "-" : "0";
      html += `<td>${signChip(sign)} <span class='muted'>${fmtShort(delta)}</span></td>`;
    }
    html += `<td>${signChip(result.signSummary[i])}</td></tr>`;
  }
  html += "</tbody></table>";
  host.innerHTML = html;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function renderVectors() {
  const result = state.result;
  if (!result) {
    $("mask-vec").textContent = "尚无有效结果。";
    $("merged-vec").textContent = "尚无有效结果。";
    $("final-vec").textContent = "尚无有效结果。";
    return;
  }
  $("mask-vec").textContent = result.mask.map((k) => (k ? "1" : "0")).join(", ");
  $("merged-vec").textContent = vecText(result.merged);
  $("final-vec").textContent = vecText(result.final);
}

function renderExplanations() {
  const tbody = $("explain-table").querySelector("tbody");
  const result = state.result;
  tbody.innerHTML = "";
  if (!result) return;
  for (const exp of result.explanations) {
    const tr = document.createElement("tr");
    const deltaDetail = exp.deltas
      .map((d) => `候选${d.candidateId + 1}:${fmtShort(d.delta)}`)
      .join(" ");
    tr.innerHTML =
      `<td class='idx'>[${exp.coord.join(",")}]</td>` +
      `<td>${fmtShort(exp.baseValue)}</td>` +
      `<td><span class="chip ${STATUS_STYLE[exp.status].chip}">${STATUS_STYLE[exp.status].text}</span></td>` +
      `<td>${exp.kept ? "是" : "否"}</td>` +
      `<td>${fmtShort(exp.mergedDelta)}</td>` +
      `<td>${fmtShort(exp.finalValue)}</td>` +
      `<td class='note'>${escapeHtml(exp.note)}<br/><span class='muted'>各候选增量：${escapeHtml(deltaDetail)}</span></td>`;
    tbody.append(tr);
  }
}

function renderError() {
  const banner = $("error-banner");
  if (state.error) {
    banner.style.display = "block";
    banner.textContent = "错误（结果未更新，继续显示上一次有效结果）：\n" + state.error;
  } else {
    banner.style.display = "none";
    banner.textContent = "";
  }
  $("stale-note").hidden = !state.error;
}

function renderAll() {
  renderError();
  renderHeatmap();
  renderDeltaSigns();
  renderVectors();
  renderExplanations();
}

function buildExport() {
  const input = {
    base: state.base,
    candidates: state.candidates,
    selectedIds: [...state.selected].sort((a, b) => a - b),
    coefficient: state.coefficient,
  };
  return {
    exportedAt: new Date().toISOString(),
    input,
    result: state.result,
    error: state.error,
    note: "POST 此 input 到 /api/merge 即可完整重算（候选顺序不影响结果）。",
  };
}

$("load-example").addEventListener("click", async () => {
  const res = await fetch("/api/example");
  const payload = await res.json();
  loadIntoState(payload);
});

$("add-candidate").addEventListener("click", () => {
  const id = state.candidates.length;
  state.candidates.push({
    name: state.base.name || "",
    shape: state.base.shape.slice(),
    values: state.base.values.slice(),
  });
  state.selected.push(id);
  renderCandidateEditor();
  scheduleCompute();
});

$("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(buildExport(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "merge-export.json";
  a.click();
  URL.revokeObjectURL(url);
});

$("base-name").addEventListener("input", scheduleCompute);
$("base-shape").addEventListener("input", scheduleCompute);
$("base-values").addEventListener("input", scheduleCompute);
$("coefficient").addEventListener("input", scheduleCompute);

(async function init() {
  const res = await fetch("/api/example");
  loadIntoState(await res.json());
})();
