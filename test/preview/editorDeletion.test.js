import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteSelectedBrick,
  shouldIgnoreEditorShortcut,
  shouldIgnoreDeleteShortcut,
} from "../../src/preview/editorDeletion.js";

function modelWith(ids) {
  return {
    model_name: "test",
    piece_count: ids.length,
    bricks: ids.map((id) => ({
      id,
      part_id: "3005",
      color_id: "4",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
    })),
  };
}

test("deleteSelectedBrick removes the selected brick and returns the editor to hand mode", () => {
  const calls = [];
  let nextModel = null;

  const deleted = deleteSelectedBrick({
    model: modelWith(["brick-1", "brick-2"]),
    selectedBrickId: "brick-1",
    setModel(model) {
      nextModel = model;
      calls.push("setModel");
    },
    clearSelection() {
      calls.push("clearSelection");
    },
    setTool(tool) {
      calls.push(`setTool:${tool}`);
    },
    closeContextMenu() {
      calls.push("closeContextMenu");
    },
    setStatusLine(text) {
      calls.push(`setStatusLine:${text}`);
    },
  });

  assert.equal(deleted, true);
  assert.equal(nextModel.piece_count, 1);
  assert.deepEqual(nextModel.bricks.map((brick) => brick.id), ["brick-2"]);
  assert.deepEqual(calls, [
    "setModel",
    "clearSelection",
    "setTool:hand",
    "closeContextMenu",
    "setStatusLine:Editing",
  ]);
});

test("deleteSelectedBrick is a no-op without a selected brick in the model", () => {
  let mutated = false;

  const deleted = deleteSelectedBrick({
    model: modelWith(["brick-1"]),
    selectedBrickId: "missing",
    setModel() {
      mutated = true;
    },
  });

  assert.equal(deleted, false);
  assert.equal(mutated, false);
});

test("shouldIgnoreDeleteShortcut ignores editable text targets", () => {
  assert.equal(shouldIgnoreDeleteShortcut({ tagName: "INPUT" }), true);
  assert.equal(shouldIgnoreDeleteShortcut({ tagName: "select" }), true);
  assert.equal(shouldIgnoreDeleteShortcut({ tagName: "TEXTAREA" }), true);
  assert.equal(shouldIgnoreDeleteShortcut({ isContentEditable: true }), true);
  assert.equal(shouldIgnoreDeleteShortcut({ tagName: "BUTTON" }), false);
  assert.equal(shouldIgnoreDeleteShortcut(null), false);
});

test("shouldIgnoreEditorShortcut shares the editable-target guard", () => {
  assert.equal(shouldIgnoreEditorShortcut({ tagName: "INPUT" }), true);
  assert.equal(shouldIgnoreEditorShortcut({ tagName: "BUTTON" }), false);
});
