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
