import { removeBrick } from "./editorState.js";

const EDITABLE_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

export function shouldIgnoreEditorShortcut(target) {
  if (!target) {
    return false;
  }

  if (EDITABLE_TAGS.has(target.tagName?.toUpperCase())) {
    return true;
  }

  return Boolean(target.isContentEditable);
}

export const shouldIgnoreDeleteShortcut = shouldIgnoreEditorShortcut;

export function deleteSelectedBrick({
  model,
  selectedBrickId,
  setModel,
  clearSelection = () => {},
  setTool = () => {},
  closeContextMenu = () => {},
  setStatusLine = () => {},
}) {
  if (!model || !selectedBrickId) {
    return false;
  }

  if (!model.bricks.some((brick) => brick.id === selectedBrickId)) {
    return false;
  }

  setModel(removeBrick(model, selectedBrickId));
  clearSelection();
  setTool("hand");
  closeContextMenu();
  setStatusLine("Editing");
  return true;
}
