const COLORS = [
  "red", "orange", "yellow", "beige", "brown", "green",
  "dark green", "blue", "white", "light gray", "dark gray", "black"
];

const state = {
  workspace: null,
  document: null,
  sessionId: null,
  index: 0,
  viewMode: "clear",
  activeFrameId: null,
  missedFrameId: null,
  missedWaypointId: null,
  drawing: false,
  drawStart: null,
  manualBox: null,
  overlapCandidates: [],
  overlapReconciliation: null,
  correcting: false,
  handoff: null,
};
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
  return path
    ? `/assets/${encodeURIComponent(state.sessionId)}/${path.split("/").map(encodeURIComponent).join("/")}`
    : "";
}

function frameById(frameId) {
  return (state.document.source_frames || []).find(
    (row) => Number(row.frame_id) === Number(frameId)
  );
}

function activeFrame() {
  return frameById(state.activeFrameId) || frameById(state.document.primary_frame_id);
}

async function loadWorkspace() {
  state.workspace = await api("/api/workspace");
  $("session-select").innerHTML = state.workspace.sessions.map((row) =>
    `<option value="${row.session_id}">${row.session_id} (${row.expected_count})</option>`
  ).join("");
  renderExportState();
  await loadSession(state.workspace.sessions[0].session_id);
}

function renderExportState() {
  const ready = state.workspace && state.workspace.sessions.every((row) => row.locked);
  $("export-inventory").disabled = !ready;
}

function renderOverlapButton() {
  const button = $("review-overlaps");
  const status = state.overlapReconciliation || state.document?.reconciliation;
  const excess = status
    ? status.accounted_physical - status.expected
    : 0;
  const count = state.overlapCandidates.length;
  const actionable = count > 0 && excess > 0;
  button.textContent = actionable
    ? `Review possible extras (${count})`
    : "Review possible extras";
  button.disabled = Boolean(
    !state.document || state.document.locked || !actionable
  );
}

async function refreshOverlapCandidates() {
  const payload = await api(
    `/api/sessions/${encodeURIComponent(state.sessionId)}/overlap-candidates`
  );
  state.overlapCandidates = payload.candidates || [];
  state.overlapReconciliation = payload.reconciliation;
  renderOverlapButton();
  return payload;
}

async function loadSession(sessionId) {
  state.sessionId = sessionId;
  state.document = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
  document.body.classList.toggle("showcase-mode", Boolean(
    state.document.showcase_only
  ));
  const mostConfident = highestConfidenceUnresolvedIndex();
  state.index = mostConfident >= 0 ? mostConfident : 0;
  state.correcting = false;
  state.activeFrameId = state.document.primary_frame_id;
  $("session-select").value = sessionId;
  await refreshOverlapCandidates();
  render();
}

function fitLayer(image, layer) {
  layer.style.width = `${image.clientWidth}px`;
  layer.style.height = `${image.clientHeight}px`;
  layer.style.left = `${image.offsetLeft}px`;
  layer.style.top = `${image.offsetTop}px`;
}

function fitShapeLayer() {
  fitLayer($("overview"), $("shape-buttons"));
}

function predictionScore(row) {
  const score = Number(row?.prediction?.score);
  return Number.isFinite(score) ? score : -1;
}

function highestConfidenceUnresolvedIndex() {
  if (!state.document) return -1;
  let bestIndex = -1;
  let bestScore = -Infinity;
  state.document.components.forEach((row, index) => {
    const score = predictionScore(row);
    if (!row.review.confirmed && score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function waypointLabel(row, index) {
  const sourceShape = row.source_anchor?.shape_id;
  if (sourceShape) return String(sourceShape).split(":").pop();
  const manual = String(row.component_id || "").match(/manual-waypoint-(\d+)$/);
  if (manual) return `M${String(Number(manual[1]) + 1).padStart(2, "0")}`;
  return String(index).padStart(3, "0");
}

function waypointButton(row, index, frame, selected = false) {
  const [width, height] = frame.size_wh;
  const view = (row.assets?.views || [])[0] || {};
  const [x0, y0, x1, y1] =
    view.crop_box_original || row.source_anchor.box_original;
  const classes = ["shape-button"];
  if (view.mask) classes.push("mask-backed");
  if (selected) classes.push("selected");
  if (row.review.confirmed) classes.push(row.review.included ? "confirmed" : "excluded");
  if (row.review.segmentation === "duplicate") classes.push("deleted");
  const label = waypointLabel(row, index);
  const maskCanvas = view.mask
    ? `<canvas class="segmentation-silhouette" data-mask-src="${asset(view.mask)}" aria-hidden="true"></canvas>`
    : "";
  return `<button class="${classes.join(" ")}" data-index="${index}"
    aria-label="Select piece ${label}" title="Piece ${label}"
    style="left:${100 * x0 / width}%;top:${100 * y0 / height}%;
      width:${100 * (x1 - x0) / width}%;height:${100 * (y1 - y0) / height}%">
    ${maskCanvas}</button>`;
}

async function paintSegmentationMask(canvas) {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = canvas.dataset.maskSrc;
  });
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixelData = pixels.data;
  for (let offset = 0; offset < pixelData.length; offset += 4) {
    const luminance = Math.max(
      pixelData[offset], pixelData[offset + 1], pixelData[offset + 2]
    );
    pixelData[offset] = 255;
    pixelData[offset + 1] = 213;
    pixelData[offset + 2] = 0;
    pixelData[offset + 3] = luminance;
  }
  context.putImageData(pixels, 0, 0);
}

function paintSegmentationMasks() {
  document.querySelectorAll("#shape-buttons .segmentation-silhouette").forEach(
    (canvas) => paintSegmentationMask(canvas).catch(() => { canvas.hidden = true; })
  );
}

function renderShapes() {
  const frame = activeFrame();
  if (!frame) return;
  $("shape-buttons").innerHTML = state.document.components.map((row, index) =>
    Number(row.source_anchor.frame_id) === Number(frame.frame_id)
      ? waypointButton(row, index, frame, index === state.index)
      : ""
  ).join("");
  document.querySelectorAll("#shape-buttons .shape-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.index = Number(button.dataset.index);
      state.correcting = false;
      render();
    });
  });
  paintSegmentationMasks();
  fitShapeLayer();
  requestAnimationFrame(positionConfirmationCallout);
}

function renderCandidates(row) {
  const container = $("candidate-renders");
  const candidates = row.candidates || [];
  if (!candidates.length) {
    container.innerHTML = '<span class="hint">No confident suggestions—edit the block type below.</span>';
    return;
  }
  container.innerHTML = candidates.slice(0, 5).map((candidate, index) => {
    const source = candidate.render_path ? asset(candidate.render_path) : candidate.img_url;
    const image = source ? `<img src="${source}" alt="${candidate.part_name}">` : "<div>no render</div>";
    return `<button class="candidate" data-index="${index}">${image}<span>${candidate.part_id}<br>${candidate.part_name}</span></button>`;
  }).join("");
  container.querySelectorAll(".candidate").forEach((button) => {
    button.addEventListener("click", () => {
      const candidate = candidates[Number(button.dataset.index)];
      $("part-id").value = candidate.part_id || "";
      $("part-name").value = candidate.part_name || "";
      container.querySelectorAll(".candidate").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });
}

function setCrop(row) {
  const view = (row.assets?.views || [])[0];
  if (!view) {
    $("selected-crop").removeAttribute("src");
    return;
  }
  const source = state.viewMode === "mask"
    ? (view.masked_crop || view.crop)
    : (view.crop || view.masked_crop);
  $("selected-crop").src = asset(source);
  $("view-clear").setAttribute("aria-pressed", String(state.viewMode === "clear"));
  $("view-mask").setAttribute("aria-pressed", String(state.viewMode === "mask"));
  $("view-mask").disabled = !view.masked_crop;
}

function renderInspector() {
  const row = state.document.components[state.index];
  if (!row) return;
  state.activeFrameId = row.source_anchor.frame_id;
  $("piece-title").textContent = "Selected LEGO piece";
  setCrop(row);
  $("association-status").className = "association-status safe";
  $("association-status").textContent =
    "Exact source segmentation · one piece · no automatic alternate views";
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
  $("confirm").textContent = state.correcting ? "Save correction + next" : "Confirm + next";
  const deleted = review.segmentation === "duplicate";
  $("delete-segmentation").disabled = state.document.locked;
  $("delete-segmentation").textContent = deleted ? "Restore detection" : "Delete detection";
}

function positionConfirmationCallout() {
  const selected = document.querySelector("#shape-buttons .shape-button.selected");
  const callout = $("confirmation-callout");
  const line = $("callout-line");
  const dot = $("callout-dot");
  if (!selected || !callout || !line || !dot) {
    if (line) line.style.display = "none";
    if (dot) dot.style.display = "none";
    return;
  }
  const stageRect = $("segmentation-stage").getBoundingClientRect();
  const selectedRect = selected.getBoundingClientRect();
  const calloutRect = callout.getBoundingClientRect();
  const x1 = selectedRect.left + selectedRect.width / 2 - stageRect.left;
  const y1 = selectedRect.top + selectedRect.height / 2 - stageRect.top;
  const calloutLeft = calloutRect.left - stageRect.left;
  const calloutRight = calloutRect.right - stageRect.left;
  const x2 = x1 < calloutLeft ? calloutLeft : calloutRight;
  const y2 = Math.max(
    calloutRect.top - stageRect.top + 18,
    Math.min(y1, calloutRect.bottom - stageRect.top - 18)
  );
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  dot.setAttribute("cx", x1);
  dot.setAttribute("cy", y1);
  line.style.display = "block";
  dot.style.display = "block";
}

function renderConfirmationCallout(row) {
  if (state.handoff) {
    $("confirmation-question").textContent = "Inventory ready";
    $("confirmation-confidence").textContent =
      "Your confirmed LEGO pieces are ready for building.";
    $("quick-confirm-yes").hidden = true;
    $("quick-confirm-no").hidden = true;
    $("confirmation-callout").classList.add("handoff-ready");
    return;
  }
  const prediction = row.prediction || {};
  const color = prediction.color ? `${prediction.color} ` : "";
  const partName = prediction.part_name || "LEGO piece";
  const score = Number(row.prediction?.score);
  const confirmed = Boolean(row.review.confirmed);
  $("confirmation-question").textContent = `Is this a ${color}${partName}?`;
  $("confirmation-confidence").textContent = Number.isFinite(score)
    ? `Model confidence ${Math.round(score * 100)}%`
    : "Model suggestion";
  $("quick-confirm-yes").disabled = state.document.locked || confirmed;
  $("quick-confirm-no").disabled = state.document.locked || confirmed;
  $("quick-confirm-yes").textContent = confirmed ? "Confirmed" : "Yes";
  $("confirmation-callout").classList.toggle("correcting", state.correcting);
  $("segmentation-stage").classList.add("review-focus");
  document.body.classList.toggle("correction-mode", state.correcting);
  requestAnimationFrame(positionConfirmationCallout);
}

async function finishShowcaseIfReady() {
  if (!state.document?.showcase_only || highestConfidenceUnresolvedIndex() >= 0) {
    return false;
  }
  const result = await api(
    `/api/sessions/${encodeURIComponent(state.sessionId)}/handoff`,
    { method: "POST", body: "{}" }
  );
  state.handoff = result;
  state.correcting = false;
  renderConfirmationCallout(state.document.components[state.index]);
  if (result.generator_url) {
    window.setTimeout(() => window.location.assign(result.generator_url), 1400);
  }
  return true;
}

function renderCorrectionSlide(row) {
  $("confirmation-review").classList.toggle("hidden", state.correcting);
  $("correction-slide").classList.toggle("hidden", !state.correcting);
  if (!state.correcting) return;
  $("correction-part-name").value =
    row.review.part_name || row.prediction?.part_name || "";
  $("correction-status").textContent = "";
}

function beginCorrection() {
  state.correcting = true;
  const row = state.document.components[state.index];
  renderCorrectionSlide(row);
  renderConfirmationCallout(row);
  $("correction-part-name").focus({ preventScroll: true });
}

function cancelCorrection() {
  state.correcting = false;
  const row = state.document.components[state.index];
  renderCorrectionSlide(row);
  renderConfirmationCallout(row);
}

async function saveCorrection() {
  const partName = $("correction-part-name").value.trim();
  if (!partName) {
    $("correction-status").textContent = "Type the LEGO piece before saving.";
    $("correction-part-name").focus();
    return;
  }
  $("part-id").value = "";
  $("part-name").value = partName;
  $("segmentation").value = "correct";
  $("correction-status").textContent = "Saving…";
  await confirmCurrent();
  if (state.correcting) {
    $("correction-status").textContent = $("save-status").textContent;
  }
}

function acceptCurrentPrediction() {
  const row = state.document.components[state.index];
  if (!row || row.review.confirmed || state.document.locked) return;
  const prediction = row.prediction || {};
  $("part-id").value = prediction.part_id || "";
  $("part-name").value = prediction.part_name || "unknown brick";
  $("color").value = COLORS.includes(prediction.color) ? prediction.color : "";
  $("segmentation").value = "correct";
  $("included").checked = true;
  $("exclusion-reason").value = "";
  $("included").dispatchEvent(new Event("change"));
  confirmCurrent();
}

function renderCounts() {
  const r = state.document.reconciliation;
  $("counts").textContent =
    `Physical ${r.expected} · active ${r.segmentations_active} · ` +
    `confirmed ${r.accounted_physical} · excluded ${r.excluded} · ` +
    `removed ${r.segmentations_removed} · unresolved ${r.unresolved}`;
  $("lock-session").disabled = state.document.locked || !r.reconciled;
  $("lock-session").textContent = state.document.locked ? "Batch locked" : "Lock batch";
  $("add-missed").disabled = state.document.locked;
  renderOverlapButton();
}

function render() {
  const row = state.document.components[state.index];
  if (row) state.activeFrameId = row.source_anchor.frame_id;
  const frame = activeFrame();
  if (!frame) {
    document.body.innerHTML = "<pre>This review does not contain source-frame waypoints.</pre>";
    return;
  }
  const overview = $("overview");
  overview.onload = () => {
    fitShapeLayer();
    renderShapes();
    requestAnimationFrame(positionConfirmationCallout);
  };
  overview.src = asset(frame.image);
  $("frame-hint").textContent =
    "Original camera frame · select a yellow segmented piece to inspect it.";
  renderShapes();
  renderInspector();
  renderCounts();
  renderCorrectionSlide(row);
  renderConfirmationCallout(row);
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
    state.correcting = false;
    const next = highestConfidenceUnresolvedIndex();
    if (next >= 0) state.index = next;
    else if (state.index < state.document.components.length - 1) state.index += 1;
    if (await finishShowcaseIfReady()) return;
    render();
  } catch (error) {
    $("save-status").textContent = error.message;
  }
}

async function toggleCurrentDetection() {
  const row = state.document.components[state.index];
  const deleted = row.review.segmentation === "duplicate";
  const payload = deleted
    ? {
        confirmed: false,
        part_id: row.prediction.part_id || "",
        part_name: row.prediction.part_name || "unknown brick",
        color: COLORS.includes(row.prediction.color) ? row.prediction.color : "",
        included: true,
        exclusion_reason: null,
        segmentation: "unreviewed",
      }
    : {
        confirmed: true,
        part_id: "",
        part_name: "",
        color: "",
        included: false,
        exclusion_reason: "duplicate or false detector waypoint",
        segmentation: "duplicate",
      };
  $("save-status").textContent = deleted ? "Restoring…" : "Removing…";
  try {
    state.document = await api(
      `/api/sessions/${encodeURIComponent(state.sessionId)}/components/${encodeURIComponent(row.component_id)}`,
      { method: "PUT", body: JSON.stringify(payload) }
    );
    $("save-status").textContent = deleted ? "Detection restored" : "Detection removed";
    if (!deleted && state.index < state.document.components.length - 1) state.index += 1;
    render();
  } catch (error) {
    $("save-status").textContent = error.message;
  }
}

function pooledWaypoints(frameId) {
  const added = new Set(state.document.components.map((row) => row.component_id));
  return (state.document.waypoint_pool || [])
    .filter((row) => Number(row.component.source_anchor.frame_id) === Number(frameId))
    .map((row) => ({ ...row, added: added.has(row.component.component_id) }));
}

function selectedPoolRow() {
  return (state.document.waypoint_pool || []).find(
    (row) => row.waypoint_id === state.missedWaypointId
  );
}

function fitMissedLayer() {
  fitLayer($("missed-frame"), $("missed-waypoint-buttons"));
}

function renderMissedFrame() {
  const frame = frameById(state.missedFrameId);
  if (!frame) return;
  state.missedWaypointId = null;
  state.manualBox = null;
  state.drawing = false;
  $("manual-box").classList.add("hidden");
  $("add-drawn-box").classList.add("hidden");
  $("add-selected-waypoint").classList.remove("hidden");
  $("add-selected-waypoint").disabled = true;
  $("missed-selected-crop").removeAttribute("src");
  $("missed-selected-crop").classList.add("hidden");
  $("missed-selection").textContent = "No waypoint selected.";
  const image = $("missed-frame");
  image.onload = () => {
    fitMissedLayer();
    renderMissedWaypoints();
  };
  image.src = asset(frame.image);
  renderMissedWaypoints();
}

function renderMissedWaypoints() {
  const frame = frameById(state.missedFrameId);
  if (!frame) return;
  const [width, height] = frame.size_wh;
  $("missed-waypoint-buttons").innerHTML = pooledWaypoints(frame.frame_id).map((row) => {
    const [x0, y0, x1, y1] = row.component.source_anchor.box_original;
    const label = row.waypoint_id.split(":").pop();
    const classes = ["missed-waypoint"];
    if (row.added) classes.push("added");
    if (row.waypoint_id === state.missedWaypointId) classes.push("selected");
    return `<button type="button" class="${classes.join(" ")}" data-waypoint="${row.waypoint_id}"
      ${row.added ? "disabled" : ""}
      style="left:${100 * x0 / width}%;top:${100 * y0 / height}%;
        width:${100 * (x1 - x0) / width}%;height:${100 * (y1 - y0) / height}%">
      <span>${label}</span></button>`;
  }).join("");
  $("missed-waypoint-buttons").querySelectorAll(".missed-waypoint:not(:disabled)").forEach((button) => {
    button.addEventListener("click", () => {
      state.missedWaypointId = button.dataset.waypoint;
      const row = selectedPoolRow();
      const view = row.component.assets.views[0];
      $("missed-selected-crop").src = asset(view.crop || view.masked_crop);
      $("missed-selected-crop").classList.remove("hidden");
      $("missed-selection").textContent =
        `${row.component.prediction.part_name || "unknown brick"} · ${row.component.prediction.color || "unknown color"}`;
      $("add-selected-waypoint").disabled = false;
      renderMissedWaypoints();
    });
  });
  fitMissedLayer();
}

function openMissedDialog() {
  const frames = state.document.source_frames || [];
  $("source-frame-select").innerHTML = frames.map((frame) =>
    `<option value="${frame.frame_id}">Frame ${frame.frame_id}${frame.primary ? " (primary)" : ""}</option>`
  ).join("");
  const secondaryWithCandidates = frames.find(
    (frame) => !frame.primary && pooledWaypoints(frame.frame_id).some((row) => !row.added)
  );
  state.missedFrameId = (secondaryWithCandidates || frames[0]).frame_id;
  $("source-frame-select").value = state.missedFrameId;
  $("missed-piece-dialog").showModal();
  renderMissedFrame();
}

async function addSelectedWaypoint() {
  if (!state.missedWaypointId) return;
  try {
    state.document = await api(
      `/api/sessions/${encodeURIComponent(state.sessionId)}/waypoints/${encodeURIComponent(state.missedWaypointId)}`,
      { method: "POST" }
    );
    state.index = state.document.components.length - 1;
    state.activeFrameId = state.document.components[state.index].source_anchor.frame_id;
    $("missed-piece-dialog").close();
    render();
  } catch (error) {
    $("missed-selection").textContent = error.message;
  }
}

function beginManualDraw() {
  state.drawing = true;
  state.drawStart = null;
  state.manualBox = null;
  $("missed-waypoint-buttons").classList.add("drawing");
  $("missed-instructions").textContent = "Drag a box around the missing LEGO piece.";
  $("add-selected-waypoint").classList.add("hidden");
  $("add-drawn-box").classList.remove("hidden");
  $("add-drawn-box").disabled = true;
}

function pointerPosition(event) {
  const layer = $("missed-waypoint-buttons");
  const rect = layer.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    width: rect.width,
    height: rect.height,
  };
}

function updateManualBox(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const box = $("manual-box");
  box.classList.remove("hidden");
  box.style.left = `${$("missed-frame").offsetLeft + left}px`;
  box.style.top = `${$("missed-frame").offsetTop + top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
}

function finishManualDraw(event) {
  if (!state.drawStart) return;
  const end = pointerPosition(event);
  updateManualBox(state.drawStart, end);
  const frame = frameById(state.missedFrameId);
  const [frameWidth, frameHeight] = frame.size_wh;
  state.manualBox = [
    Math.round(Math.min(state.drawStart.x, end.x) * frameWidth / end.width),
    Math.round(Math.min(state.drawStart.y, end.y) * frameHeight / end.height),
    Math.round(Math.max(state.drawStart.x, end.x) * frameWidth / end.width),
    Math.round(Math.max(state.drawStart.y, end.y) * frameHeight / end.height),
  ];
  state.drawStart = null;
  $("add-drawn-box").disabled =
    state.manualBox[2] - state.manualBox[0] < 8 || state.manualBox[3] - state.manualBox[1] < 8;
  $("missed-instructions").textContent = "Adjust by drawing again, or add this box.";
}

async function addDrawnBox() {
  if (!state.manualBox) return;
  try {
    state.document = await api(
      `/api/sessions/${encodeURIComponent(state.sessionId)}/manual-waypoints`,
      {
        method: "POST",
        body: JSON.stringify({ frame_id: state.missedFrameId, box: state.manualBox }),
      }
    );
    state.index = state.document.components.length - 1;
    state.activeFrameId = state.missedFrameId;
    $("missed-piece-dialog").close();
    render();
  } catch (error) {
    $("missed-selection").textContent = error.message;
  }
}

function currentOverlapPair() {
  return state.overlapCandidates[0] || null;
}

function fitOverlapLayer() {
  fitLayer($("overlap-frame"), $("overlap-layer"));
}

function positionOverlapBox(element, box, frame) {
  const [width, height] = frame.size_wh;
  const [x0, y0, x1, y1] = box;
  element.style.left = `${100 * x0 / width}%`;
  element.style.top = `${100 * y0 / height}%`;
  element.style.width = `${100 * (x1 - x0) / width}%`;
  element.style.height = `${100 * (y1 - y0) / height}%`;
}

function renderOverlapBoxes() {
  const pair = currentOverlapPair();
  if (!pair) return;
  const frame = frameById(pair.frame_id);
  if (!frame) return;
  positionOverlapBox($("overlap-box-a"), pair.a.box_original, frame);
  positionOverlapBox($("overlap-box-b"), pair.b.box_original, frame);
  fitOverlapLayer();
}

function overlapRecordLabel(row) {
  const color = row.color || "unknown color";
  const partName = row.part_name || "unknown type";
  return `${color} · ${partName}`;
}

function setOverlapActionsDisabled(disabled) {
  $("keep-overlap-a").disabled = disabled;
  $("keep-overlap-b").disabled = disabled;
  $("keep-overlap-separate").disabled = disabled;
}

function renderOverlapPair() {
  const status = state.overlapReconciliation || state.document.reconciliation;
  const excess = status.accounted_physical - status.expected;
  $("overlap-counts").textContent =
    `Expected ${status.expected} · confirmed ${status.accounted_physical} · ` +
    `${Math.max(0, excess)} extra`;
  const pair = currentOverlapPair();
  if (excess <= 0) {
    $("overlap-progress").textContent = "Count reconciled";
    $("overlap-status").textContent = "This batch now matches its physical count.";
    $("overlap-label-a").textContent = "Batch reconciled";
    $("overlap-label-b").textContent = "No further deletion suggested";
    $("overlap-id-a").textContent = "";
    $("overlap-id-b").textContent = "";
    setOverlapActionsDisabled(true);
    return;
  }
  if (!pair) {
    $("overlap-progress").textContent = "No candidates remain";
    $("overlap-status").textContent =
      `The batch is still ${excess} over, but every shortlisted pair was marked separate.`;
    $("overlap-label-a").textContent = "No overlap pair available";
    $("overlap-label-b").textContent = "Close and inspect the batch manually";
    $("overlap-id-a").textContent = "";
    $("overlap-id-b").textContent = "";
    setOverlapActionsDisabled(true);
    return;
  }
  setOverlapActionsDisabled(false);
  $("overlap-progress").textContent =
    `${state.overlapCandidates.length} shortlisted pair${state.overlapCandidates.length === 1 ? "" : "s"} remaining`;
  $("overlap-label-a").textContent = overlapRecordLabel(pair.a);
  $("overlap-label-b").textContent = overlapRecordLabel(pair.b);
  $("overlap-id-a").textContent = pair.a.component_id;
  $("overlap-id-b").textContent = pair.b.component_id;
  $("overlap-strength").textContent =
    `Smaller-box containment ${Math.round(pair.containment * 100)}% · ` +
    `box IoU ${Math.round(pair.iou * 100)}%`;
  $("overlap-status").textContent =
    "Choose which inventory record to retain, or confirm that both are real pieces.";
  const frame = frameById(pair.frame_id);
  if (!frame) {
    $("overlap-status").textContent = `Source frame ${pair.frame_id} is unavailable.`;
    setOverlapActionsDisabled(true);
    return;
  }
  const image = $("overlap-frame");
  image.onload = () => {
    fitOverlapLayer();
    renderOverlapBoxes();
  };
  image.src = asset(frame.image);
  renderOverlapBoxes();
}

async function openOverlapDialog() {
  $("overlap-status").textContent = "Loading shortlisted pairs…";
  $("overlap-cleanup-dialog").showModal();
  try {
    await refreshOverlapCandidates();
    renderOverlapPair();
  } catch (error) {
    $("overlap-status").textContent = error.message;
    setOverlapActionsDisabled(true);
  }
}

async function submitOverlapDecision(action) {
  const pair = currentOverlapPair();
  if (!pair) return;
  setOverlapActionsDisabled(true);
  $("overlap-status").textContent = "Saving decision…";
  try {
    const result = await api(
      `/api/sessions/${encodeURIComponent(state.sessionId)}/overlap-decisions`,
      {
        method: "POST",
        body: JSON.stringify({
          component_a: pair.a.component_id,
          component_b: pair.b.component_id,
          action,
        }),
      }
    );
    state.overlapCandidates = result.candidates || [];
    state.overlapReconciliation = result.reconciliation;
    state.document = await api(`/api/sessions/${encodeURIComponent(state.sessionId)}`);
    render();
    renderOverlapPair();
  } catch (error) {
    $("overlap-status").textContent = error.message;
    setOverlapActionsDisabled(false);
  }
}

$("color").innerHTML = '<option value="">Choose color</option>' +
  COLORS.map((color) => `<option value="${color}">${color}</option>`).join("");
$("included").addEventListener("change", () =>
  $("exclusion-wrap").classList.toggle("hidden", $("included").checked)
);
$("segmentation").addEventListener("change", () => {
  if ($("segmentation").value === "duplicate") {
    $("included").checked = false;
    $("exclusion-reason").value ||= "duplicate or false detector waypoint";
    $("included").dispatchEvent(new Event("change"));
  }
});
$("confirm").addEventListener("click", confirmCurrent);
$("quick-confirm-yes").addEventListener("click", acceptCurrentPrediction);
$("quick-confirm-no").addEventListener("click", beginCorrection);
$("correction-back").addEventListener("click", cancelCorrection);
$("correction-save").addEventListener("click", saveCorrection);
$("delete-segmentation").addEventListener("click", toggleCurrentDetection);
$("view-clear").addEventListener("click", () => {
  state.viewMode = "clear";
  setCrop(state.document.components[state.index]);
});
$("view-mask").addEventListener("click", () => {
  state.viewMode = "mask";
  setCrop(state.document.components[state.index]);
});
$("previous").addEventListener("click", () => {
  if (state.index > 0) { state.index--; state.correcting = false; render(); }
});
$("next").addEventListener("click", () => {
  if (state.index < state.document.components.length - 1) { state.index++; state.correcting = false; render(); }
});
$("session-select").addEventListener("change", (event) => loadSession(event.target.value));
$("review-overlaps").addEventListener("click", openOverlapDialog);
$("keep-overlap-a").addEventListener("click", () => submitOverlapDecision("keep_a"));
$("keep-overlap-b").addEventListener("click", () => submitOverlapDecision("keep_b"));
$("keep-overlap-separate").addEventListener("click", () =>
  submitOverlapDecision("separate")
);
$("add-missed").addEventListener("click", openMissedDialog);
$("source-frame-select").addEventListener("change", (event) => {
  state.missedFrameId = Number(event.target.value);
  renderMissedFrame();
});
$("add-selected-waypoint").addEventListener("click", addSelectedWaypoint);
$("draw-missing-box").addEventListener("click", beginManualDraw);
$("add-drawn-box").addEventListener("click", addDrawnBox);
$("missed-waypoint-buttons").addEventListener("pointerdown", (event) => {
  if (!state.drawing) return;
  event.preventDefault();
  state.drawStart = pointerPosition(event);
  updateManualBox(state.drawStart, state.drawStart);
});
$("missed-waypoint-buttons").addEventListener("pointermove", (event) => {
  if (!state.drawing || !state.drawStart) return;
  updateManualBox(state.drawStart, pointerPosition(event));
});
$("missed-waypoint-buttons").addEventListener("pointerup", (event) => {
  if (state.drawing) finishManualDraw(event);
});
$("lock-session").addEventListener("click", async () => {
  try {
    state.document = await api(
      `/api/sessions/${encodeURIComponent(state.sessionId)}/lock`,
      { method: "POST" }
    );
    const row = state.workspace.sessions.find((item) => item.session_id === state.sessionId);
    if (row) row.locked = true;
    renderExportState();
    render();
  } catch (error) { alert(error.message); }
});
$("export-inventory").addEventListener("click", async () => {
  try {
    const result = await api("/api/export", { method: "POST" });
    alert(`Verified inventory written to ${result.output_dir}`);
  } catch (error) { alert(error.message); }
});
window.addEventListener("resize", () => {
  fitShapeLayer();
  positionConfirmationCallout();
  if ($("missed-piece-dialog").open) fitMissedLayer();
  if ($("overlap-cleanup-dialog").open) {
    fitOverlapLayer();
    renderOverlapBoxes();
  }
});
window.addEventListener("keydown", (event) => {
  if ($("missed-piece-dialog").open || $("overlap-cleanup-dialog").open) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (event.key === "Enter") confirmCurrent();
  if (event.key === "ArrowLeft" && state.index > 0) { state.index--; state.correcting = false; render(); }
  if (event.key === "ArrowRight" && state.index < state.document.components.length - 1) { state.index++; state.correcting = false; render(); }
  if (event.key.toLowerCase() === "e") {
    $("included").checked = !$("included").checked;
    $("included").dispatchEvent(new Event("change"));
  }
  if (event.key.toLowerCase() === "d") toggleCurrentDetection();
  if (/^[1-5]$/.test(event.key)) {
    const button = $("candidate-renders").querySelector(
      `.candidate[data-index="${Number(event.key) - 1}"]`
    );
    if (button) button.click();
  }
});

loadWorkspace().catch((error) => {
  document.body.innerHTML = `<pre>${error.message}</pre>`;
});
