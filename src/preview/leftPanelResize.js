const PROMPT_PANEL_MIN_HEIGHT = 300;
const DEFAULT_MIN_HEIGHTS = [120, 100, PROMPT_PANEL_MIN_HEIGHT];

export function resizeStackedPanelRows({
  rows,
  handleIndex,
  deltaY,
  minHeights = DEFAULT_MIN_HEIGHTS,
}) {
  const nextRows = [...rows];
  const beforeIndex = handleIndex;
  const afterIndex = handleIndex + 1;

  if (
    beforeIndex < 0 ||
    afterIndex >= nextRows.length ||
    !Number.isFinite(deltaY)
  ) {
    return nextRows;
  }

  const beforeMin = minHeights[beforeIndex] ?? 0;
  const afterMin = minHeights[afterIndex] ?? 0;
  const minDelta = beforeMin - nextRows[beforeIndex];
  const maxDelta = nextRows[afterIndex] - afterMin;
  const clampedDelta = Math.max(minDelta, Math.min(maxDelta, deltaY));

  nextRows[beforeIndex] += clampedDelta;
  nextRows[afterIndex] -= clampedDelta;
  return nextRows;
}

function visiblePanelIndexes(panels) {
  return panels
    .map((panel, index) => panel.hidden ? null : index)
    .filter((index) => index !== null);
}

function distributeRows({ rows, panels, handles, minHeights }) {
  const visibleIndexes = visiblePanelIndexes(panels);

  if (visibleIndexes.length === 0) {
    return rows.map(() => 0);
  }

  const visibleHandleHeight = handles
    .filter((handle) => !handle.hidden)
    .reduce((total, handle) => total + handle.offsetHeight, 0);
  const availableHeight = Math.max(0, panels[0].parentElement.clientHeight - visibleHandleHeight);
  const nextRows = rows.map((row, index) => panels[index].hidden ? 0 : Math.max(row, minHeights[index] ?? 0));
  const currentTotal = visibleIndexes.reduce((total, index) => total + nextRows[index], 0);

  if (currentTotal <= 0) {
    const sharedHeight = availableHeight / visibleIndexes.length;
    for (const index of visibleIndexes) {
      nextRows[index] = sharedHeight;
    }
    return nextRows;
  }

  if (currentTotal < availableHeight) {
    nextRows[visibleIndexes[0]] += availableHeight - currentTotal;
    return nextRows;
  }

  let overflow = currentTotal - availableHeight;
  for (const index of [...visibleIndexes].reverse()) {
    if (overflow <= 0) {
      break;
    }

    const minHeight = minHeights[index] ?? 0;
    const removableHeight = Math.max(0, nextRows[index] - minHeight);
    const removedHeight = Math.min(removableHeight, overflow);
    nextRows[index] -= removedHeight;
    overflow -= removedHeight;
  }

  return nextRows;
}

export function createLeftPanelResizer({
  container,
  panels,
  handles,
  minHeights = DEFAULT_MIN_HEIGHTS,
  ownerDocument = document,
}) {
  let rows = panels.map((panel, index) => panel.offsetHeight || minHeights[index] || 0);
  let activeDrag = null;

  function setHandleVisibility() {
    handles.forEach((handle, index) => {
      handle.hidden = panels[index].hidden || panels[index + 1].hidden;
    });
  }

  function applyRows(nextRows) {
    rows = distributeRows({
      rows: nextRows,
      panels,
      handles,
      minHeights,
    });

    panels.forEach((panel, index) => {
      panel.style.flexBasis = `${Math.max(0, rows[index])}px`;
    });
  }

  function update() {
    setHandleVisibility();
    applyRows(panels.map((panel, index) => (
      panel.hidden ? 0 : panel.offsetHeight || rows[index] || minHeights[index] || 0
    )));
  }

  function finishDrag(event) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
      return;
    }

    container.classList.remove("is-resizing-left-panels");
    ownerDocument.removeEventListener("pointermove", moveDrag);
    ownerDocument.removeEventListener("pointerup", finishDrag);
    ownerDocument.removeEventListener("pointercancel", finishDrag);
    handles[activeDrag.handleIndex].classList.remove("is-active");
    handles[activeDrag.handleIndex].releasePointerCapture?.(activeDrag.pointerId);
    activeDrag = null;
  }

  function moveDrag(event) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
      return;
    }

    event.preventDefault();
    applyRows(resizeStackedPanelRows({
      rows: activeDrag.startRows,
      handleIndex: activeDrag.handleIndex,
      deltaY: event.clientY - activeDrag.startY,
      minHeights,
    }));
  }

  handles.forEach((handle, handleIndex) => {
    handle.addEventListener("pointerdown", (event) => {
      if (
        event.button !== 0 ||
        handle.hidden ||
        panels[handleIndex].hidden ||
        panels[handleIndex + 1].hidden
      ) {
        return;
      }

      event.preventDefault();
      activeDrag = {
        handleIndex,
        pointerId: event.pointerId,
        startY: event.clientY,
        startRows: panels.map((panel, index) => (
          panel.hidden ? 0 : panel.offsetHeight || rows[index] || minHeights[index] || 0
        )),
      };
      container.classList.add("is-resizing-left-panels");
      handle.classList.add("is-active");
      handle.setPointerCapture?.(event.pointerId);
      ownerDocument.addEventListener("pointermove", moveDrag, { passive: false });
      ownerDocument.addEventListener("pointerup", finishDrag);
      ownerDocument.addEventListener("pointercancel", finishDrag);
    });
  });

  update();

  return {
    update,
  };
}
