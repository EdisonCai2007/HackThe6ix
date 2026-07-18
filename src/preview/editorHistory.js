function cloneModel(model) {
  return structuredClone(model);
}

function modelsAreEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createEditorHistory({ limit = 10 } = {}) {
  const maxDepth = Math.max(0, limit);
  let current = null;
  let undoStack = [];
  let redoStack = [];

  function trim(stack) {
    if (stack.length <= maxDepth) {
      return stack;
    }

    return stack.slice(stack.length - maxDepth);
  }

  return {
    reset(model) {
      current = cloneModel(model);
      undoStack = [];
      redoStack = [];
    },
    push(model) {
      const next = cloneModel(model);

      if (current && modelsAreEqual(current, next)) {
        return current;
      }

      if (current && maxDepth > 0) {
        undoStack = trim([...undoStack, current]);
      }

      current = next;
      redoStack = [];
      return current;
    },
    undo() {
      if (undoStack.length === 0 || !current) {
        return current;
      }

      const previous = undoStack.at(-1);
      undoStack = undoStack.slice(0, -1);
      if (maxDepth > 0) {
        redoStack = trim([...redoStack, current]);
      }
      current = cloneModel(previous);
      return cloneModel(current);
    },
    redo() {
      if (redoStack.length === 0 || !current) {
        return current;
      }

      const next = redoStack.at(-1);
      redoStack = redoStack.slice(0, -1);
      if (maxDepth > 0) {
        undoStack = trim([...undoStack, current]);
      }
      current = cloneModel(next);
      return cloneModel(current);
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
    current() {
      return current ? cloneModel(current) : null;
    },
  };
}
