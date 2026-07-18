const VALID_ROTATIONS = new Set([0, 90, 180, 270]);

function issue(field, message) {
  return { field, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function validateDimensions(dimensions, errors) {
  if (!isPlainObject(dimensions)) {
    errors.push(issue("dimensions", "dimensions must be an object."));
    return;
  }

  for (const field of ["width_studs", "depth_studs", "height_layers"]) {
    requireNumber(dimensions[field], `dimensions.${field}`, errors);
  }
}

function validatePosition(position, index, errors) {
  if (!isPlainObject(position)) {
    errors.push(issue(`bricks[${index}].position`, "position must be an object."));
    return;
  }

  for (const axis of ["x", "y", "z"]) {
    requireNumber(position[axis], `bricks[${index}].position.${axis}`, errors);
  }
}

function validateBrick(brick, index, errors) {
  if (!isPlainObject(brick)) {
    errors.push(issue(`bricks[${index}]`, "brick must be an object."));
    return;
  }

  for (const field of [
    "id",
    "part_id",
    "ldraw_id",
    "label",
    "color_id",
    "color_name",
    "feature",
  ]) {
    requireString(brick[field], `bricks[${index}].${field}`, errors);
  }

  validatePosition(brick.position, index, errors);

  if (!VALID_ROTATIONS.has(brick.rotation)) {
    errors.push(issue(`bricks[${index}].rotation`, "rotation must be 0, 90, 180, or 270."));
  }

  if (!Number.isInteger(brick.step) || brick.step <= 0) {
    errors.push(issue(`bricks[${index}].step`, "step must be a positive integer."));
  }
}

export function validateGeneratedModelShape(model) {
  const errors = [];

  if (!isPlainObject(model)) {
    return {
      ok: false,
      errors: [issue("model", "Generated model must be an object.")],
    };
  }

  for (const field of [
    "model_name",
    "prompt",
    "created_from_inventory_id",
    "generator_version",
  ]) {
    requireString(model[field], field, errors);
  }

  if (!Number.isInteger(model.piece_count) || model.piece_count < 0) {
    errors.push(issue("piece_count", "piece_count must be a non-negative integer."));
  }

  validateDimensions(model.dimensions, errors);

  if (!Array.isArray(model.bricks)) {
    errors.push(issue("bricks", "bricks must be an array."));
  } else {
    model.bricks.forEach((brick, index) => validateBrick(brick, index, errors));
  }

  if (!Array.isArray(model.notes)) {
    errors.push(issue("notes", "notes must be an array."));
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
