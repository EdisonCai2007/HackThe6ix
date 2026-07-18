### Task 1: Schema Guards And Piece Cap

**Files:**
- Create: `src/generation/designPlan.js`
- Create: `src/generation/generatedModelSchema.js`
- Create: `test/generation/designPlan.test.js`
- Create: `test/generation/generatedModelSchema.test.js`
- Modify: `src/generation/partCatalog.js`
- Modify: `test/generation/partCatalog.test.js`

**Interfaces:**
- Produces: `parseJsonObject(text, label)`
- Produces: `validateStructurePlan(plan)`
- Produces: `parseStructurePlanText(text)`
- Produces: `validateGeneratedModelShape(model)`
- Updates: `MAX_MODEL_PIECES` to `50`

- [ ] **Step 1: Write failing design-plan tests**

Create `test/generation/designPlan.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseJsonObject,
  parseStructurePlanText,
  validateStructurePlan,
} from "../../src/generation/designPlan.js";

const validPlan = {
  model_name: "Small Duck",
  primary_object: "duck",
  target_piece_count: 15,
  overall_shape: "Small blocky duck with body, head, beak, and eyes.",
  required_features: [
    {
      name: "body",
      visual_goal: "Wide low yellow body",
      priority: "required",
      preferred_colors: ["yellow"],
      approximate_piece_budget: 6,
    },
  ],
  part_usage_plan: [
    {
      feature: "body",
      allowed_part_ids: ["3001", "3003"],
      allowed_color_ids: ["14"],
      max_pieces: 6,
      notes: "Use larger yellow bricks for the body.",
    },
  ],
  build_strategy: {
    base: "Use plates for a stable footprint.",
    body: "Keep the body wider than the head.",
    raised_details: "Place details on supported bricks.",
    stability_notes: "Avoid unsupported overhangs.",
  },
  fallback_priorities: ["Keep body, head, and beak."],
  user_facing_summary: "I planned a small duck.",
};

describe("design plan schema", () => {
  it("parses JSON object text", () => {
    const result = parseJsonObject(JSON.stringify(validPlan), "structure plan");

    assert.equal(result.ok, true);
    assert.equal(result.value.primary_object, "duck");
  });

  it("rejects malformed JSON text", () => {
    const result = parseJsonObject("{ nope", "structure plan");

    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /Invalid structure plan JSON/);
  });

  it("accepts a complete structure plan", () => {
    const result = validateStructurePlan(validPlan);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects a structure plan missing required arrays", () => {
    const result = validateStructurePlan({
      ...validPlan,
      required_features: [],
      part_usage_plan: "body pieces",
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.field === "required_features"), true);
    assert.equal(result.errors.some((error) => error.field === "part_usage_plan"), true);
  });

  it("parses and validates structure plan text in one call", () => {
    const result = parseStructurePlanText(JSON.stringify(validPlan));

    assert.equal(result.ok, true);
    assert.equal(result.value.model_name, "Small Duck");
  });
});
```

- [ ] **Step 2: Write failing generated-model schema tests**

Create `test/generation/generatedModelSchema.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";

const validModel = {
  model_name: "Small Duck",
  prompt: "build me a duck",
  piece_count: 1,
  dimensions: { width_studs: 2, depth_studs: 4, height_layers: 3 },
  created_from_inventory_id: "duck-demo",
  generator_version: "openrouter-test",
  bricks: [
    {
      id: "body-1",
      part_id: "3001",
      ldraw_id: "3001.dat",
      label: "2x4 brick",
      color_id: "14",
      color_name: "yellow",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      feature: "body",
      step: 1,
    },
  ],
  notes: ["Valid shape for schema tests."],
};

describe("generated model schema", () => {
  it("accepts a GeneratedModel-shaped object", () => {
    const result = validateGeneratedModelShape(validModel);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects missing model metadata", () => {
    const result = validateGeneratedModelShape({
      ...validModel,
      model_name: "",
      created_from_inventory_id: undefined,
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.field === "model_name"), true);
    assert.equal(result.errors.some((error) => error.field === "created_from_inventory_id"), true);
  });

  it("rejects malformed brick fields before validator runs", () => {
    const result = validateGeneratedModelShape({
      ...validModel,
      bricks: [{ ...validModel.bricks[0], position: { x: 0, y: 0 }, rotation: 45 }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.field === "bricks[0].position.z"), true);
    assert.equal(result.errors.some((error) => error.field === "bricks[0].rotation"), true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/generation/designPlan.test.js test/generation/generatedModelSchema.test.js`

Expected: FAIL with module-not-found errors for `designPlan.js` and `generatedModelSchema.js`.

- [ ] **Step 4: Implement `designPlan.js`**

Create `src/generation/designPlan.js`:

```js
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
```

- [ ] **Step 5: Implement `generatedModelSchema.js`**

Create `src/generation/generatedModelSchema.js`:

```js
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
```

- [ ] **Step 6: Change the piece cap**

Modify `src/generation/partCatalog.js`:

```js
export const MAX_MODEL_PIECES = 50;
```

- [ ] **Step 7: Ensure the part catalog test expects 50**

If `test/generation/partCatalog.test.js` already asserts the cap, update it to:

```js
assert.equal(MAX_MODEL_PIECES, 50);
```

If it does not assert the cap, add this test:

```js
it("uses the documented MVP max model piece count", () => {
  assert.equal(MAX_MODEL_PIECES, 50);
});
```

- [ ] **Step 8: Run task tests**

Run: `node --test test/generation/designPlan.test.js test/generation/generatedModelSchema.test.js test/generation/partCatalog.test.js`

Expected: PASS.

- [ ] **Step 9: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record in the task handoff that commit is blocked until `.git` is restored.

---

