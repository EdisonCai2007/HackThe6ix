const persistentEditorTools = new Set(["hand", "axis", "rotate"]);

export function nextToolAfterSelectionChange(activeTool, selectedBrickId) {
  if (selectedBrickId || persistentEditorTools.has(activeTool)) {
    return activeTool;
  }

  return "hand";
}

