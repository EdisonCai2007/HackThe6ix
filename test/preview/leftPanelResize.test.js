import assert from "node:assert/strict";
import test from "node:test";

import {
  createLeftPanelResizer,
  resizeStackedPanelRows,
} from "../../src/preview/leftPanelResize.js";

function createClassList() {
  const classes = new Set();

  return {
    add(className) {
      classes.add(className);
    },
    remove(className) {
      classes.delete(className);
    },
    contains(className) {
      return classes.has(className);
    },
  };
}

function createFakeElement({ offsetHeight = 0, clientHeight = 0, parentElement = null } = {}) {
  const listeners = new Map();

  return {
    hidden: false,
    offsetHeight,
    clientHeight,
    parentElement,
    style: {},
    classList: createClassList(),
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    },
    dispatchPointerEvent(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener({
          button: 0,
          pointerId: 1,
          clientY: 100,
          preventDefault() {},
          ...event,
        });
      }
    },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
}

test("resizeStackedPanelRows moves height between adjacent rows", () => {
  const rows = resizeStackedPanelRows({
    rows: [220, 160, 180],
    handleIndex: 0,
    deltaY: 40,
    minHeights: [120, 100, 140],
  });

  assert.deepEqual(rows, [260, 120, 180]);
});

test("resizeStackedPanelRows clamps when a panel reaches its minimum height", () => {
  const rows = resizeStackedPanelRows({
    rows: [220, 160, 180],
    handleIndex: 1,
    deltaY: 80,
    minHeights: [120, 100, 140],
  });

  assert.deepEqual(rows, [220, 200, 140]);
});

test("resizeStackedPanelRows keeps the prompt panel at its default minimum height", () => {
  const rows = resizeStackedPanelRows({
    rows: [220, 160, 300],
    handleIndex: 1,
    deltaY: 120,
  });

  assert.deepEqual(rows, [220, 160, 300]);
});

test("createLeftPanelResizer marks only the active resize handle while dragging", () => {
  const container = createFakeElement();
  const panelParent = createFakeElement({ clientHeight: 600 });
  const panels = [
    createFakeElement({ offsetHeight: 240, parentElement: panelParent }),
    createFakeElement({ offsetHeight: 160, parentElement: panelParent }),
    createFakeElement({ offsetHeight: 200, parentElement: panelParent }),
  ];
  const handles = [
    createFakeElement({ offsetHeight: 9 }),
    createFakeElement({ offsetHeight: 9 }),
  ];
  const ownerDocument = createFakeElement();

  createLeftPanelResizer({
    container,
    panels,
    handles,
    ownerDocument,
  });

  handles[0].dispatchPointerEvent("pointerdown");

  assert.equal(handles[0].classList.contains("is-active"), true);
  assert.equal(handles[1].classList.contains("is-active"), false);

  ownerDocument.dispatchPointerEvent("pointerup");

  assert.equal(handles[0].classList.contains("is-active"), false);
  assert.equal(handles[1].classList.contains("is-active"), false);
});
