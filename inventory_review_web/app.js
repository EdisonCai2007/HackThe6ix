const COLORS = [
  "red", "orange", "yellow", "beige", "brown", "green",
  "dark green", "blue", "white", "light gray", "dark gray", "black"
];

const state = { workspace: null, document: null, sessionId: null, index: 0 };
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Request failed (${response.status})`);
  return payload;
}

function asset(path) {
  return path ? `/assets/${encodeURIComponent(state.sessionId)}/${path.split("/").map(encodeURIComponent).join("/")}` : "";
}

async function loadWorkspace() {
  state.workspace = await api("/api/workspace");
  const select = $("session-select");
  select.innerHTML = state.workspace.sessions.map((row) =>
    `<option value="${row.session_id}">${row.session_id} (${row.expected_count})</option>`
  ).join("");
  await loadSession(state.workspace.sessions[0].session_id);
}

async function loadSession(sessionId) {
  state.sessionId = sessionId;
  state.document = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
  state.index = Math.max(0, state.document.components.findIndex((row) => !row.review.confirmed));
  $("session-select").value = sessionId;
  render();
}

function fitShapeLayer() {
  const image = $("overview");
  const layer = $("shape-buttons");
  layer.style.width = `${image.clientWidth}px`;
  layer.style.height = `${image.clientHeight}px`;
  layer.style.left = `${image.offsetLeft}px`;
  layer.style.top = `${image.offsetTop}px`;
}

function renderShapes() {
  const [width, height] = state.document.overview_size_wh || [1, 1];
  $("shape-buttons").innerHTML = state.document.components.map((row, index) => {
    const [x0, y0, x1, y1] = row.source_anchor.box_canvas;
    const classes = ["shape-button"];
    if (index === state.index) classes.push("selected");
    if (row.review.confirmed) classes.push(row.review.included ? "confirmed" : "excluded");
    const label = String(index).padStart(3, "0");
    return `<button class="${classes.join(" ")}" data-index="${index}"
      aria-label="Select piece ${label}" title="Piece ${label}"
      style="left:${100*x0/width}%;top:${100*y0/height}%;width:${100*(x1-x0)/width}%;height:${100*(y1-y0)/height}%">
      </button>`;
  }).join("");
  document.querySelectorAll(".shape-button").forEach((button) => {
    button.addEventListener("click", () => { state.index = Number(button.dataset.index); render(); });
  });
  fitShapeLayer();
}

function renderCandidates(row) {
  const container = $("candidate-renders");
  if (!row.candidates.length) {
    container.innerHTML = '<span class="hint">No confident suggestions—enter the part below.</span>';
    return;
  }
  container.innerHTML = row.candidates.slice(0, 5).map((candidate, index) => {
    const source = candidate.render_path ? asset(candidate.render_path) : candidate.img_url;
    const image = source ? `<img src="${source}" alt="${candidate.part_name}">` : "<div>no render</div>";
    return `<button class="candidate" data-index="${index}">${image}<span>${candidate.part_id}<br>${candidate.part_name}</span></button>`;
  }).join("");
  container.querySelectorAll(".candidate").forEach((button) => {
    button.addEventListener("click", () => {
      const candidate = row.candidates[Number(button.dataset.index)];
      $("part-id").value = candidate.part_id;
      $("part-name").value = candidate.part_name;
      container.querySelectorAll(".candidate").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });
}

function setView(row, index) {
  const view = row.assets.views[index];
  $("selected-crop").src = asset(view.masked_crop || view.crop);
}

function renderInspector() {
  const row = state.document.components[state.index];
  if (!row) return;
  $("piece-title").textContent = row.component_id;
  const views = row.assets.views || [];
  $("view-thumbnails").innerHTML = views.map((view, index) =>
    `<button data-index="${index}"><img src="${asset(view.masked_crop || view.crop)}" alt="View ${index + 1}"></button>`
  ).join("");
  $("view-thumbnails").querySelectorAll("button").forEach((button) =>
    button.addEventListener("click", () => setView(row, Number(button.dataset.index)))
  );
  if (views.length) setView(row, 0);
  renderCandidates(row);
  const review = row.review;
  $("part-id").value = review.part_id || "";
  $("part-name").value = review.part_name || "";
  $("color").value = COLORS.includes(review.color) ? review.color : "";
  $("segmentation").value = review.segmentation || "unreviewed";
  $("included").checked = review.included;
  $("exclusion-reason").value = review.exclusion_reason || "";
  $("exclusion-wrap").classList.toggle("hidden", review.included);
  $("previous").disabled = state.index === 0;
  $("next").disabled = state.index === state.document.components.length - 1;
  $("confirm").disabled = state.document.locked;
}

function renderCounts() {
  const r = state.document.reconciliation;
  $("counts").textContent = `Physical ${r.expected} · accounted ${r.accounted_physical} · included ${r.included} · excluded ${r.excluded} · unresolved ${r.unresolved}`;
  $("lock-session").disabled = state.document.locked || !r.reconciled;
  $("lock-session").textContent = state.document.locked ? "Batch locked" : "Lock batch";
  $("add-missed").disabled = state.document.locked;
}

function render() {
  const overview = $("overview");
  overview.onload = () => { fitShapeLayer(); renderShapes(); };
  overview.src = asset(state.document.overview_images[0]);
  renderShapes();
  renderInspector();
  renderCounts();
}

async function confirmCurrent() {
  const row = state.document.components[state.index];
  const included = $("included").checked;
  const payload = {
    confirmed: true,
    part_id: $("part-id").value.trim(),
    part_name: $("part-name").value.trim(),
    color: $("color").value,
    included,
    exclusion_reason: included ? null : $("exclusion-reason").value.trim(),
    segmentation: $("segmentation").value,
  };
  $("save-status").textContent = "Saving…";
  try {
    state.document = await api(
      `/api/sessions/${encodeURIComponent(state.sessionId)}/components/${encodeURIComponent(row.component_id)}`,
      { method: "PUT", body: JSON.stringify(payload) }
    );
    $("save-status").textContent = "Saved";
    const next = state.document.components.findIndex((item, index) => index > state.index && !item.review.confirmed);
    if (next >= 0) state.index = next;
    else if (state.index < state.document.components.length - 1) state.index += 1;
    render();
  } catch (error) {
    $("save-status").textContent = error.message;
  }
}

async function addMissed() {
  const partId = prompt("Missed piece part ID");
  if (!partId) return;
  const partName = prompt("Block type/name");
  if (!partName) return;
  const color = prompt(`Color: ${COLORS.join(", ")}`)?.toLowerCase();
  if (!COLORS.includes(color)) return alert("Choose one of the listed inventory colors.");
  try {
    state.document = await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/manual-pieces`, {
      method: "POST",
      body: JSON.stringify({ part_id: partId, part_name: partName, color, included: true }),
    });
    renderCounts();
  } catch (error) { alert(error.message); }
}

$("color").innerHTML = '<option value="">Choose color</option>' + COLORS.map((color) => `<option value="${color}">${color}</option>`).join("");
$("included").addEventListener("change", () => $("exclusion-wrap").classList.toggle("hidden", $("included").checked));
$("confirm").addEventListener("click", confirmCurrent);
$("previous").addEventListener("click", () => { if (state.index > 0) { state.index--; render(); } });
$("next").addEventListener("click", () => { if (state.index < state.document.components.length - 1) { state.index++; render(); } });
$("session-select").addEventListener("change", (event) => loadSession(event.target.value));
$("add-missed").addEventListener("click", addMissed);
$("lock-session").addEventListener("click", async () => {
  try {
    state.document = await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/lock`, { method: "POST" });
    render();
  } catch (error) { alert(error.message); }
});
window.addEventListener("resize", fitShapeLayer);
window.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (event.key === "Enter") confirmCurrent();
  if (event.key === "ArrowLeft" && state.index > 0) { state.index--; render(); }
  if (event.key === "ArrowRight" && state.index < state.document.components.length - 1) { state.index++; render(); }
  if (event.key.toLowerCase() === "e") { $("included").checked = !$("included").checked; $("included").dispatchEvent(new Event("change")); }
});

loadWorkspace().catch((error) => { document.body.innerHTML = `<pre>${error.message}</pre>`; });
