import assert from "node:assert/strict";
import test from "node:test";

import { createEditorHistory } from "../../src/preview/editorHistory.js";

function modelWith(ids) {
  return {
    model_name: "test",
    piece_count: ids.length,
    bricks: ids.map((id, index) => ({
      id,
      part_id: "3005",
      color_id: "4",
      position: { x: index, y: 0, z: 0 },
      rotation: 0,
    })),
  };
}

test("createEditorHistory starts at the reset model and clones snapshots", () => {
  const history = createEditorHistory({ limit: 10 });
  const model = modelWith(["a"]);

  history.reset(model);
  model.bricks[0].position.x = 99;

  assert.deepEqual(history.current().bricks[0].position, { x: 0, y: 0, z: 0 });
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
});

test("undo and redo move between committed model snapshots", () => {
  const history = createEditorHistory({ limit: 10 });
  const first = modelWith(["a"]);
  const second = modelWith(["a", "b"]);

  history.reset(first);
  history.push(second);

  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);
  assert.deepEqual(history.undo().bricks.map((brick) => brick.id), ["a"]);
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);
  assert.deepEqual(history.redo().bricks.map((brick) => brick.id), ["a", "b"]);
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);
});

test("push skips model-identical snapshots and clears redo history", () => {
  const history = createEditorHistory({ limit: 10 });
  const first = modelWith(["a"]);
  const second = modelWith(["a", "b"]);
  const third = modelWith(["a", "c"]);

  history.reset(first);
  history.push(modelWith(["a"]));
  assert.equal(history.canUndo(), false);

  history.push(second);
  history.undo();
  assert.equal(history.canRedo(), true);

  history.push(third);
  assert.equal(history.canRedo(), false);
  assert.deepEqual(history.current().bricks.map((brick) => brick.id), ["a", "c"]);
});

test("history keeps at most the configured undo and redo depth", () => {
  const history = createEditorHistory({ limit: 10 });

  history.reset(modelWith(["0"]));
  for (let index = 1; index <= 12; index += 1) {
    history.push(modelWith([String(index)]));
  }

  const undoIds = [];
  while (history.canUndo()) {
    undoIds.push(history.undo().bricks[0].id);
  }

  assert.deepEqual(undoIds, ["11", "10", "9", "8", "7", "6", "5", "4", "3", "2"]);

  history.reset(modelWith(["0"]));
  for (let index = 1; index <= 12; index += 1) {
    history.push(modelWith([String(index)]));
  }
  for (let index = 0; index < 12; index += 1) {
    history.undo();
  }

  const redoIds = [];
  while (history.canRedo()) {
    redoIds.push(history.redo().bricks[0].id);
  }

  assert.deepEqual(redoIds, ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
});
