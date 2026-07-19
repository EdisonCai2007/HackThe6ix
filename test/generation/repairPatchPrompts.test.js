import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLACEMENT_GENERATION_MAX_TOKENS } from "../../src/generation/generationPrompts.js";
import {
  PATCH_REPAIR_MAX_TOKENS,
  REPAIR_PATCH_SCHEMA,
  buildPlacementPatchRepairPrompt,
} from "../../src/generation/repairPatchPrompts.js";

const TEST_MODEL = "env-patch-repair-model";

const repairContext = {
  user_prompt: "build me a duck",
  target_object: "duck",
  target_piece_count: 6,
  structure_summary: {
    model_name: "Patch Duck",
    primary_object: "duck",
    overall_shape: "Small blocky duck.",
  },
  current_model_bounds: {
    model_name: "Patch Duck",
    piece_count: 2,
    bounds: {
      min_x: 0,
      max_x_exclusive: 2,
      min_y: 0,
      max_y_exclusive: 2,
      min_z: 0,
      max_z_exclusive: 6,
    },
  },
  invalid_brick_ids: ["floating-head"],
  invalid_bricks: [
    {
      id: "floating-head",
      part_id: "3004",
      ldraw_id: "3004.dat",
      label: "1x2 brick",
      color_id: "4",
      color_name: "red",
      position: { x: 0, y: 0, z: 5 },
      rotation: 0,
      feature: "head",
      step: 2,
    },
  ],
  nearby_or_supporting_bricks: [],
  remaining_inventory: [
    {
      part_id: "3004",
      ldraw_id: "3004.dat",
      label: "1x2 brick",
      color_id: "4",
      color_name: "red",
      available: 4,
      used: 2,
      remaining: 2,
    },
  ],
  validation_error_summary: [
    {
      type: "floating_brick",
      severity: "hard",
      brick_ids: ["floating-head"],
      message: "floating-head is above the ground layer without support underneath.",
    },
  ],
};

function requestText(request) {
  return [
    ...(request.systemInstruction?.parts ?? []),
    ...(request.contents ?? []).flatMap((content) => content.parts),
  ]
    .map((part) => part.text)
    .join("\n");
}

function firstUserPayload(request) {
  return JSON.parse(request.contents[0].parts[0].text);
}

function buildRequest(overrides = {}) {
  return buildPlacementPatchRepairPrompt({
    repairContext,
    model: TEST_MODEL,
    ...overrides,
  });
}

describe("repair patch prompt builder", () => {
  it("builds a Gemini JSON request with a much smaller token budget than placement repair", () => {
    const request = buildRequest();

    assert.equal(request.model, TEST_MODEL);
    assert.equal(request.generationConfig.responseMimeType, "application/json");
    assert.equal(request.generationConfig.maxOutputTokens, PATCH_REPAIR_MAX_TOKENS);
    assert.equal(PATCH_REPAIR_MAX_TOKENS < PLACEMENT_GENERATION_MAX_TOKENS / 10, true);
    assert.equal(Array.isArray(request.systemInstruction.parts), true);
    assert.equal(request.contents[0].role, "user");
  });

  it("uses a patch operation schema instead of a GeneratedModel schema", () => {
    const request = buildRequest();
    const schema = request.generationConfig.responseSchema;
    const operationSchema = schema.properties.operations.items;

    assert.deepEqual(schema, REPAIR_PATCH_SCHEMA);
    assert.equal(schema.properties.operations.type, "array");
    assert.deepEqual(schema.required, ["operations"]);
    assert.deepEqual(operationSchema.properties.type.enum, ["remove", "move", "update", "add", "replace"]);
    assert.deepEqual(operationSchema.required, ["type"]);
    assert.equal(operationSchema.properties.updates.type, "object");
    assert.equal(operationSchema.properties.brick.type, "object");

    for (const generatedModelField of [
      "model_name",
      "prompt",
      "piece_count",
      "dimensions",
      "created_from_inventory_id",
      "generator_version",
      "bricks",
      "notes",
    ]) {
      assert.equal(schema.properties[generatedModelField], undefined);
    }
  });

  it("emphasizes targeted compact patch repair and local validation", () => {
    const text = requestText(buildRequest());

    assert.match(text, /Fix only listed invalid brick ids unless impossible/i);
    assert.match(text, /Prefer remove\/move over rebuilding/i);
    assert.match(text, /Output compact operations only/i);
    assert.match(text, /Server will apply and validate patch locally/i);
    assert.doesNotMatch(text, /Return exactly one full valid/i);
    assert.doesNotMatch(text, /Return exactly one complete/i);
    assert.doesNotMatch(text, /entire model/i);
  });

  it("does not include the full model JSON by default", () => {
    const request = buildRequest();
    const payload = firstUserPayload(request);
    const userPayloadText = request.contents[0].parts[0].text;

    assert.equal(payload.reference_model_for_debug_only, undefined);
    assert.equal(payload.invalid_generated_model, undefined);
    assert.equal(payload.repair_context.model_context, undefined);
    assert.equal(payload.repair_context.bricks, undefined);
    assert.deepEqual(payload.repair_context.invalid_brick_ids, ["floating-head"]);
    assert.deepEqual(
      payload.repair_context.invalid_bricks.map((brick) => brick.id),
      ["floating-head"],
    );
    assert.equal(userPayloadText.includes("\"valid-base\""), false);
  });
});
