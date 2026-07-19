import { getPartDimensions } from "./partCatalog.js";

export const MODEL_PATCH_SCHEMA_VERSION = 1;

const VALID_ROTATIONS = new Set([0, 90, 180, 270]);
const OPERATION_TYPES = new Set(["add", "move", "remove", "replace", "update"]);
const BRICK_UPDATE_FIELDS = new Set([
  "part_id",
  "ldraw_id",
  "label",
  "color_id",
  "color_name",
  "position",
  "rotation",
  "feature",
  "step",
]);

/**
 * @typedef {{ type: "move", id: string, position: import("./types.js").GridPosition }} MoveBrickPatchOperation
 * @typedef {{ type: "remove", id: string }} RemoveBrickPatchOperation
 * @typedef {{ type: "add", brick: import("./types.js").PlacedBrick }} AddBrickPatchOperation
 * @typedef {{ type: "replace", id: string, brick: import("./types.js").PlacedBrick }} ReplaceBrickPatchOperation
 * @typedef {{ type: "update", id: string, updates: Partial<Pick<import("./types.js").PlacedBrick, "part_id" | "ldraw_id" | "label" | "color_id" | "color_name" | "position" | "rotation" | "feature" | "step">> }} UpdateBrickPatchOperation
 * @typedef {MoveBrickPatchOperation | RemoveBrickPatchOperation | AddBrickPatchOperation | ReplaceBrickPatchOperation | UpdateBrickPatchOperation} ModelPatchOperation
 * @typedef {{ schema_version?: 1, operations: ModelPatchOperation[] }} ModelPatch
 */

function issue(field, message) {
  return { field, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clonePosition(position) {
  return { x: position.x, y: position.y, z: position.z };
}

function cloneBrick(brick) {
  return {
    ...brick,
    position: isPlainObject(brick.position) ? clonePosition(brick.position) : brick.position,
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireString(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(issue(field, `${field} must be a non-empty string.`));
  }
}

function requireNumber(value, field, errors) {
  if (!Number.isFinite(value)) {
    errors.push(issue(field, `${field} must be a finite number.`));
  }
}

function validatePosition(position, field, errors) {
  if (!isPlainObject(position)) {
    errors.push(issue(field, `${field} must be an object.`));
    return;
  }

  for (const axis of ["x", "y", "z"]) {
    requireNumber(position[axis], `${field}.${axis}`, errors);
  }
}

function validateBrickShape(brick, field, errors) {
  if (!isPlainObject(brick)) {
    errors.push(issue(field, `${field} must be an object.`));
    return false;
  }

  for (const brickField of [
    "id",
    "part_id",
    "ldraw_id",
    "label",
    "color_id",
    "color_name",
    "feature",
  ]) {
    requireString(brick[brickField], `${field}.${brickField}`, errors);
  }

  validatePosition(brick.position, `${field}.position`, errors);

  if (!VALID_ROTATIONS.has(brick.rotation)) {
    errors.push(issue(`${field}.rotation`, "rotation must be 0, 90, 180, or 270."));
  }

  if (!Number.isInteger(brick.step) || brick.step <= 0) {
    errors.push(issue(`${field}.step`, "step must be a positive integer."));
  }

  return true;
}

function validateKnownDimensions(bricks, errors) {
  bricks.forEach((brick, index) => {
    if (!getPartDimensions(brick.part_id, brick.rotation)) {
      errors.push(
        issue(
          `bricks[${index}].part_id`,
          `Cannot calculate dimensions for ${brick.id}; unsupported part ${brick.part_id}.`,
        ),
      );
    }
  });
}

function disallowUnknownFields(value, allowedFields, field, errors) {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      errors.push(issue(`${field}.${key}`, `${field}.${key} is not part of the model patch contract.`));
    }
  }
}

function brickIndexById(bricks, id) {
  return bricks.findIndex((brick) => brick.id === id);
}

function validateId(value, field, errors) {
  requireString(value, field, errors);
  return typeof value === "string" && value.trim() !== "";
}

function validateOperationObject(operation, field, errors) {
  if (!isPlainObject(operation)) {
    errors.push(issue(field, `${field} must be an object.`));
    return false;
  }

  if (!OPERATION_TYPES.has(operation.type)) {
    errors.push(
      issue(
        `${field}.type`,
        `${field}.type must be one of: add, move, remove, replace, update.`,
      ),
    );
    return false;
  }

  return true;
}

function validateUniqueModelIds(bricks, errors) {
  const seenIds = new Set();

  bricks.forEach((brick, index) => {
    if (seenIds.has(brick.id)) {
      errors.push(issue(`model.bricks[${index}].id`, `Duplicate brick id "${brick.id}" in model.`));
      return;
    }

    seenIds.add(brick.id);
  });
}

function validateAddOperation(operation, field, bricks, errors) {
  const operationErrorCount = errors.length;
  disallowUnknownFields(operation, new Set(["type", "brick"]), field, errors);
  validateBrickShape(operation.brick, `${field}.brick`, errors);

  if (errors.length !== operationErrorCount) {
    return;
  }

  if (brickIndexById(bricks, operation.brick.id) !== -1) {
    errors.push(issue(`${field}.brick.id`, `A brick with id "${operation.brick.id}" already exists.`));
    return;
  }

  bricks.push(cloneBrick(operation.brick));
}

function validateMoveOperation(operation, field, bricks, errors) {
  const operationErrorCount = errors.length;
  disallowUnknownFields(operation, new Set(["type", "id", "position"]), field, errors);
  const idIsValid = validateId(operation.id, `${field}.id`, errors);
  validatePosition(operation.position, `${field}.position`, errors);

  if (!idIsValid) {
    return;
  }

  const index = brickIndexById(bricks, operation.id);

  if (index === -1) {
    errors.push(issue(`${field}.id`, `No brick exists with id "${operation.id}".`));
    return;
  }

  if (errors.length !== operationErrorCount) {
    return;
  }

  bricks[index] = {
    ...bricks[index],
    position: clonePosition(operation.position),
  };
}

function validateRemoveOperation(operation, field, bricks, errors) {
  const operationErrorCount = errors.length;
  disallowUnknownFields(operation, new Set(["type", "id"]), field, errors);
  const idIsValid = validateId(operation.id, `${field}.id`, errors);

  if (!idIsValid) {
    return;
  }

  const index = brickIndexById(bricks, operation.id);

  if (index === -1) {
    errors.push(issue(`${field}.id`, `No brick exists with id "${operation.id}".`));
    return;
  }

  if (errors.length !== operationErrorCount) {
    return;
  }

  bricks.splice(index, 1);
}

function validateReplaceOperation(operation, field, bricks, errors) {
  const operationErrorCount = errors.length;
  disallowUnknownFields(operation, new Set(["type", "id", "brick"]), field, errors);
  const idIsValid = validateId(operation.id, `${field}.id`, errors);
  validateBrickShape(operation.brick, `${field}.brick`, errors);

  if (!idIsValid) {
    return;
  }

  const index = brickIndexById(bricks, operation.id);

  if (index === -1) {
    errors.push(issue(`${field}.id`, `No brick exists with id "${operation.id}".`));
    return;
  }

  if (errors.length !== operationErrorCount) {
    return;
  }

  if (operation.brick.id !== operation.id) {
    errors.push(issue(`${field}.brick.id`, "Replacement brick id must match the operation id."));
    return;
  }

  bricks[index] = cloneBrick(operation.brick);
}

function validateUpdateOperation(operation, field, bricks, errors) {
  const operationErrorCount = errors.length;
  disallowUnknownFields(operation, new Set(["type", "id", "updates"]), field, errors);
  const idIsValid = validateId(operation.id, `${field}.id`, errors);

  if (!isPlainObject(operation.updates)) {
    errors.push(issue(`${field}.updates`, `${field}.updates must be an object.`));
  } else if (Object.keys(operation.updates).length === 0) {
    errors.push(issue(`${field}.updates`, `${field}.updates must include at least one field.`));
  } else {
    for (const key of Object.keys(operation.updates)) {
      if (!BRICK_UPDATE_FIELDS.has(key)) {
        errors.push(
          issue(
            `${field}.updates.${key}`,
            `${field}.updates.${key} is not an allowed brick update field.`,
          ),
        );
      }
    }
  }

  if (!idIsValid) {
    return;
  }

  const index = brickIndexById(bricks, operation.id);

  if (index === -1) {
    errors.push(issue(`${field}.id`, `No brick exists with id "${operation.id}".`));
    return;
  }

  if (!isPlainObject(operation.updates)) {
    return;
  }

  if (errors.length !== operationErrorCount) {
    return;
  }

  const nextBrick = {
    ...bricks[index],
    ...operation.updates,
    position: hasOwn(operation.updates, "position")
      ? isPlainObject(operation.updates.position)
        ? clonePosition(operation.updates.position)
        : operation.updates.position
      : clonePosition(bricks[index].position),
  };
  validateBrickShape(nextBrick, `${field}.updates`, errors);

  if (errors.length !== operationErrorCount) {
    return;
  }

  bricks[index] = nextBrick;
}

function validateAndApplyOperation(operation, index, bricks, errors) {
  const field = `patch.operations[${index}]`;

  if (!validateOperationObject(operation, field, errors)) {
    return;
  }

  if (operation.type === "add") {
    validateAddOperation(operation, field, bricks, errors);
    return;
  }

  if (operation.type === "move") {
    validateMoveOperation(operation, field, bricks, errors);
    return;
  }

  if (operation.type === "remove") {
    validateRemoveOperation(operation, field, bricks, errors);
    return;
  }

  if (operation.type === "replace") {
    validateReplaceOperation(operation, field, bricks, errors);
    return;
  }

  validateUpdateOperation(operation, field, bricks, errors);
}

function evaluateModelPatch(model, patch) {
  const errors = [];

  if (!isPlainObject(model)) {
    return {
      errors: [issue("model", "Generated model must be an object.")],
      bricks: [],
    };
  }

  if (!Array.isArray(model.bricks)) {
    return {
      errors: [issue("model.bricks", "Generated model bricks must be an array.")],
      bricks: [],
    };
  }

  if (!isPlainObject(patch)) {
    return {
      errors: [issue("patch", "Model patch must be an object.")],
      bricks: model.bricks.map(cloneBrick),
    };
  }

  if (
    patch.schema_version !== undefined &&
    patch.schema_version !== MODEL_PATCH_SCHEMA_VERSION
  ) {
    errors.push(
      issue(
        "patch.schema_version",
        `Unsupported model patch schema_version ${patch.schema_version}.`,
      ),
    );
  }

  if (!Array.isArray(patch.operations)) {
    errors.push(issue("patch.operations", "patch.operations must be an array."));
  }

  disallowUnknownFields(
    patch,
    new Set(["schema_version", "operations"]),
    "patch",
    errors,
  );

  const bricks = model.bricks.map(cloneBrick);
  validateUniqueModelIds(bricks, errors);

  if (!Array.isArray(patch.operations)) {
    return { errors, bricks };
  }

  patch.operations.forEach((operation, index) => {
    validateAndApplyOperation(operation, index, bricks, errors);
  });

  validateKnownDimensions(bricks, errors);

  return { errors, bricks };
}

function dimensionsFor(bricks) {
  if (bricks.length === 0) {
    return { width_studs: 0, depth_studs: 0, height_layers: 0 };
  }

  const extents = bricks.map((brick) => {
    const dimensions = getPartDimensions(brick.part_id, brick.rotation);

    return {
      minX: brick.position.x,
      maxX: brick.position.x + dimensions.width,
      minY: brick.position.y,
      maxY: brick.position.y + dimensions.depth,
      minZ: brick.position.z,
      maxZ: brick.position.z + dimensions.height,
    };
  });

  return {
    width_studs: Math.max(...extents.map((extent) => extent.maxX)) -
      Math.min(...extents.map((extent) => extent.minX)),
    depth_studs: Math.max(...extents.map((extent) => extent.maxY)) -
      Math.min(...extents.map((extent) => extent.minY)),
    height_layers: Math.max(...extents.map((extent) => extent.maxZ)) -
      Math.min(...extents.map((extent) => extent.minZ)),
  };
}

function formatPatchErrors(errors) {
  return errors.map((error) => `${error.field}: ${error.message}`).join("; ");
}

export class ModelPatchError extends Error {
  constructor(errors) {
    super(`Invalid model patch: ${formatPatchErrors(errors)}`);
    this.name = "ModelPatchError";
    this.errors = errors;
  }
}

/**
 * Validate a model patch against a specific GeneratedModel.
 *
 * @param {import("./types.js").GeneratedModel} model
 * @param {ModelPatch} patch
 * @returns {{ ok: boolean, errors: { field: string, message: string }[] }}
 */
export function validateModelPatch(model, patch) {
  const { errors } = evaluateModelPatch(model, patch);

  return {
    ok: errors.length === 0,
    errors,
  };
}

/**
 * Apply a valid model patch and return a new full GeneratedModel.
 *
 * @param {import("./types.js").GeneratedModel} model
 * @param {ModelPatch} patch
 * @returns {import("./types.js").GeneratedModel}
 */
export function applyModelPatch(model, patch) {
  const { errors, bricks } = evaluateModelPatch(model, patch);

  if (errors.length > 0) {
    throw new ModelPatchError(errors);
  }

  return {
    ...model,
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    bricks,
    notes: Array.isArray(model.notes) ? [...model.notes] : model.notes,
  };
}
