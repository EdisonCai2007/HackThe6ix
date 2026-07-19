import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCompactRepairContext } from "../../src/generation/repairContext.js";

const structurePlan = {
  model_name: "Tiny Duck",
  primary_object: "duck",
  target_piece_count: 12,
  overall_shape: "Blocky duck with a low body and raised head.",
  required_features: [
    {
      name: "head",
      visual_goal: "Raised square head over the body.",
      priority: "required",
      preferred_colors: ["yellow"],
      approximate_piece_budget: 2,
    },
  ],
  part_usage_plan: [
    {
      feature: "body",
      allowed_part_ids: ["3001", "3005"],
      allowed_color_ids: ["4"],
      max_pieces: 8,
      notes: "Keep the base grounded.",
    },
  ],
  build_strategy: {
    base: "Use a 2x4 brick as the body support.",
    body: "Keep the body low and rectangular.",
    raised_details: "Stack the head above the front.",
    stability_notes: "Raised pieces need direct stud support.",
  },
  fallback_priorities: ["Keep the silhouette recognizable."],
  user_facing_summary: "A compact duck.",
};

const inventory = {
  inventory_id: "repair-context-test",
  source: "manual_test_fixture",
  items: [
    {
      label: "2x4 brick",
      category: "brick",
      part_id: "3001",
      ldraw_id: "3001.dat",
      color_name: "Red",
      color_id: "4",
      count: 2,
      supported: true,
    },
    {
      label: "1x1 brick",
      category: "brick",
      part_id: "3005",
      ldraw_id: "3005.dat",
      color_name: "Red",
      color_id: "4",
      count: 40,
      supported: true,
    },
    {
      label: "1x2 plate",
      category: "plate",
      part_id: "3023",
      ldraw_id: "3023.dat",
      color_name: "Blue",
      color_id: "1",
      count: 5,
      supported: true,
    },
  ],
};

function brick({
  id,
  part_id = "3005",
  ldraw_id = "3005.dat",
  label = "1x1 brick",
  color_id = "4",
  color_name = "Red",
  position,
  rotation = 0,
  feature = "body",
  step = 1,
  extra = {},
}) {
  return {
    id,
    part_id,
    ldraw_id,
    label,
    color_id,
    color_name,
    position,
    rotation,
    feature,
    step,
    ...extra,
  };
}

function modelWith(bricks, extra = {}) {
  return {
    model_name: "Tiny Duck",
    prompt: "build a duck",
    piece_count: bricks.length,
    dimensions: { width_studs: 1, depth_studs: 1, height_layers: 1 },
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "test",
    bricks,
    notes: [],
    ...extra,
  };
}

describe("repair context helpers", () => {
  it("builds compact repair context around invalid and supporting bricks", () => {
    const supportBrick = brick({
      id: "body-support",
      part_id: "3001",
      ldraw_id: "3001.dat",
      label: "2x4 brick",
      position: { x: 0, y: 0, z: 0 },
      step: 1,
    });
    const invalidBrick = brick({
      id: "bad-head",
      position: { x: 0, y: 0, z: 3 },
      rotation: 45,
      feature: "head",
      step: 2,
    });
    const unrelatedBricks = Array.from({ length: 30 }, (_, index) =>
      brick({
        id: `unrelated-${index}`,
        position: { x: 50 + index * 3, y: 50, z: 0 },
        step: 10 + index,
        extra: { debug_note: `unrelated-secret-${index}` },
      }),
    );
    const currentModel = modelWith([supportBrick, invalidBrick, ...unrelatedBricks]);
    const originalModel = modelWith(
      [supportBrick, invalidBrick, ...unrelatedBricks],
      {
        notes: ["original-secret-note"],
        image: { data: "base64-secret-image" },
      },
    );
    const validationErrors = [
      {
        type: "invalid_rotation",
        severity: "hard",
        brick_instance_id: "bad-head",
        message: "bad-head rotation must be 0, 90, 180, or 270 degrees.",
      },
    ];

    const context = buildCompactRepairContext({
      userPrompt: "build a duck with a raised head",
      structurePlan,
      inventory,
      currentModel,
      originalModel,
      cleanedModel: currentModel,
      validationErrors,
      image: { data: "base64-secret-image" },
    });
    const contextText = JSON.stringify(context);
    const fullModelsText = JSON.stringify({
      original_placement_model: originalModel,
      cleaned_current_model: currentModel,
    });

    assert.equal(context.user_prompt, "build a duck with a raised head");
    assert.equal(context.target_object, "duck");
    assert.equal(context.structure_summary.overall_shape, structurePlan.overall_shape);
    assert.equal(context.current_model_bounds.piece_count, 32);
    assert.equal(context.current_model_bounds.bounds.min_x, 0);
    assert.equal(context.invalid_brick_ids.length, 1);
    assert.equal(context.invalid_brick_ids[0], "bad-head");
    assert.deepEqual(context.invalid_bricks, [
      {
        id: "bad-head",
        part_id: "3005",
        ldraw_id: "3005.dat",
        label: "1x1 brick",
        color_id: "4",
        color_name: "Red",
        position: { x: 0, y: 0, z: 3 },
        rotation: 45,
        feature: "head",
        step: 2,
      },
    ]);
    assert.deepEqual(
      context.nearby_or_supporting_bricks.map((entry) => entry.brick.id),
      ["body-support"],
    );
    assert.deepEqual(
      context.nearby_or_supporting_bricks[0].relationship,
      ["supports_invalid_brick"],
    );

    const oneByOneSummary = context.remaining_inventory.find(
      (item) => item.part_id === "3005" && item.color_id === "4",
    );
    assert.equal(oneByOneSummary.available, 40);
    assert.equal(oneByOneSummary.used, 31);
    assert.equal(oneByOneSummary.remaining, 9);
    assert.deepEqual(context.validation_error_summary, [
      {
        type: "invalid_rotation",
        severity: "hard",
        count: 1,
        brick_ids: ["bad-head"],
        message: "bad-head rotation must be 0, 90, 180, or 270 degrees.",
      },
    ]);

    assert.ok(
      contextText.length < fullModelsText.length / 2,
      "expected compact repair context to be materially smaller than full model payloads",
    );
    assert.doesNotMatch(contextText, /unrelated-0/);
    assert.doesNotMatch(contextText, /unrelated-secret/);
    assert.doesNotMatch(contextText, /original-secret-note/);
    assert.doesNotMatch(contextText, /base64-secret-image/);
    assert.equal(context.original_placement_model, undefined);
    assert.equal(context.cleaned_current_model, undefined);
  });

  it("finds invalid brick records from part/color validation errors without pulling unrelated bricks", () => {
    const unsupportedBrick = brick({
      id: "unsupported-eye",
      part_id: "9999",
      ldraw_id: "9999.dat",
      label: "unknown part",
      color_id: "99",
      color_name: "Glow",
      position: { x: 0, y: 0, z: 0 },
      feature: "eye",
      step: 2,
    });
    const unrelatedBrick = brick({
      id: "far-away-body",
      position: { x: 40, y: 40, z: 0 },
      step: 3,
    });
    const currentModel = modelWith([unsupportedBrick, unrelatedBrick]);
    const validationErrors = [
      {
        type: "inventory_missing",
        severity: "hard",
        part_id: "9999",
        color_id: "99",
        available: 0,
        used: 1,
        message: "Model uses part 9999 color 99, which is not in inventory.",
      },
    ];

    const context = buildCompactRepairContext({
      userPrompt: "build a duck",
      structurePlan,
      inventory,
      currentModel,
      validationErrors,
    });
    const contextText = JSON.stringify(context);

    assert.deepEqual(context.invalid_brick_ids, ["unsupported-eye"]);
    assert.equal(context.invalid_bricks[0].id, "unsupported-eye");
    assert.equal(context.invalid_bricks[0].part_id, "9999");
    assert.deepEqual(context.nearby_or_supporting_bricks, []);

    const missingSummary = context.remaining_inventory.find(
      (item) => item.part_id === "9999" && item.color_id === "99",
    );
    assert.equal(missingSummary.available, 0);
    assert.equal(missingSummary.used, 1);
    assert.equal(missingSummary.remaining, -1);
    assert.equal(context.validation_error_summary[0].type, "inventory_missing");
    assert.equal(context.validation_error_summary[0].part_id, "9999");
    assert.doesNotMatch(contextText, /far-away-body/);
  });
});
