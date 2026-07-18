function issue(field, message) {
  return { field, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(plan, field, errors) {
  if (typeof plan[field] !== "string" || plan[field].trim() === "") {
    errors.push(issue(field, `${field} must be a non-empty string.`));
  }
}

function requirePositiveNumber(plan, field, errors) {
  if (!Number.isFinite(plan[field]) || plan[field] <= 0) {
    errors.push(issue(field, `${field} must be a positive number.`));
  }
}

function requireNonEmptyArray(plan, field, errors) {
  if (!Array.isArray(plan[field]) || plan[field].length === 0) {
    errors.push(issue(field, `${field} must be a non-empty array.`));
  }
}

export function parseJsonObject(text, label) {
  try {
    const value = JSON.parse(text);

    if (!isPlainObject(value)) {
      return {
        ok: false,
        errors: [issue(label, `${label} JSON must be an object.`)],
      };
    }

    return { ok: true, value, errors: [] };
  } catch (error) {
    return {
      ok: false,
      errors: [issue(label, `Invalid ${label} JSON: ${error.message}`)],
    };
  }
}

export function validateStructurePlan(plan) {
  const errors = [];

  if (!isPlainObject(plan)) {
    return {
      ok: false,
      errors: [issue("structure_plan", "Structure plan must be an object.")],
    };
  }

  for (const field of ["model_name", "primary_object", "overall_shape", "user_facing_summary"]) {
    requireString(plan, field, errors);
  }

  requirePositiveNumber(plan, "target_piece_count", errors);
  requireNonEmptyArray(plan, "required_features", errors);
  requireNonEmptyArray(plan, "part_usage_plan", errors);
  requireNonEmptyArray(plan, "fallback_priorities", errors);

  if (!isPlainObject(plan.build_strategy)) {
    errors.push(issue("build_strategy", "build_strategy must be an object."));
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function parseStructurePlanText(text) {
  const parsed = parseJsonObject(text, "structure plan");

  if (!parsed.ok) {
    return parsed;
  }

  const validation = validateStructurePlan(parsed.value);

  return {
    ok: validation.ok,
    value: validation.ok ? parsed.value : undefined,
    errors: validation.errors,
  };
}
