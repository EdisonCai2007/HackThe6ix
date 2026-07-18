import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { duckInventory } from "../../src/generation/fixtures/duckInventory.js";
import {
  buildBuildSuggestionsPrompt,
  buildJsonRepairPrompt,
  buildPlacementInventoryRepairPrompt,
  buildPlacementPrompt,
  buildPlacementValidationRepairPrompt,
  buildStructurePrompt,
  summarizeSupportedInventory,
} from "../../src/generation/generationPrompts.js";

const TEST_STRUCTURE_MODEL = "env-structure-model";
const TEST_PLACEMENT_MODEL = "env-placement-model";

const structurePlan = {
  model_name: "Small Duck",
  primary_object: "duck",
  target_piece_count: 15,
  overall_shape: "Small blocky duck with a body, head, and beak.",
  required_features: [{ name: "body", priority: "required" }],
  part_usage_plan: [{ feature: "body", allowed_part_ids: ["3001"], max_pieces: 4 }],
  build_strategy: { base: "Stable base" },
  fallback_priorities: ["Keep the duck body."],
  user_facing_summary: "I planned a duck.",
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

function assertGeminiJsonRequest(request, { maxOutputTokens = 10000 } = {}) {
  assert.equal(request.generationConfig.maxOutputTokens, maxOutputTokens);
  assert.equal(request.generationConfig.responseMimeType, "application/json");
  assert.equal(Array.isArray(request.systemInstruction.parts), true);
  assert.equal(request.contents.every((content) => Array.isArray(content.parts)), true);
}

describe("generation prompt builders", () => {
  it("summarizes only supported inventory fields needed by the model", () => {
    const summary = summarizeSupportedInventory(duckInventory);

    assert.equal(summary.inventory_id, "duck-demo");
    assert.equal(summary.items.some((item) => item.part_id === "3001"), true);
    assert.equal(summary.items.every((item) => "count" in item), true);
    assert.equal(summary.items.every((item) => "label" in item), false);
    assert.equal(summary.items.every((item) => "category" in item), false);
    assert.equal(summary.items.every((item) => "supported" in item), false);
  });

  it("builds the structure-planner request with JSON-only and cap rules", () => {
    const request = buildStructurePrompt({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      targetPieceCount: 15,
      model: TEST_STRUCTURE_MODEL,
    });

    const text = requestText(request);

    assert.equal(request.model, TEST_STRUCTURE_MODEL);
    assertGeminiJsonRequest(request);
    assert.equal(request.generationConfig.responseSchema.properties.model_name.type, "string");
    assert.equal(firstUserPayload(request).required_output_shape, undefined);
    assert.match(text, /build me a duck/);
    assert.match(text, /matching generationConfig\.responseSchema/);
    assert.match(text, /no text before or after the JSON object/i);
    assert.match(text, /Do not output exact brick coordinates/);
    assert.match(text, /100-piece MVP cap/);
    assert.match(text, /duck-demo/);
  });

  it("builds the placement-planner request for GeneratedModel JSON, not LDraw", () => {
    const request = buildPlacementPrompt({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      structurePlan,
      targetPieceCount: 15,
      model: TEST_PLACEMENT_MODEL,
    });

    const text = requestText(request);

    assert.match(text, /GeneratedModel/);
    assert.match(text, /Do not output raw LDraw/);
    assert.match(text, /Do not output meshes/);
    assert.match(text, /position/);
    assert.match(text, /rotation/);
    assert.match(text, /plates are 1 layer tall and bricks are 3 layers tall/);
    assert.match(text, /3001/);
    assert.equal(request.model, TEST_PLACEMENT_MODEL);
    assertGeminiJsonRequest(request, { maxOutputTokens: 30000 });
    assert.equal(request.generationConfig.responseSchema.properties.bricks.type, "array");
    assert.equal(firstUserPayload(request).required_output_shape, undefined);
  });

  it("builds a suggestions request that favors realistic everyday objects over generic or high-tech shapes", () => {
    const request = buildBuildSuggestionsPrompt({
      inventory: duckInventory,
      model: "suggestion-model",
    });

    const text = requestText(request);

    assert.equal(request.model, "suggestion-model");
    assertGeminiJsonRequest(request);
    assert.equal(request.generationConfig.responseSchema.properties.suggestions.type, "array");
    assert.match(text, /distinctive/i);
    assert.match(text, /realistic everyday objects/i);
    assert.match(text, /generic/i);
    assert.match(text, /block/i);
    assert.match(text, /cargo/i);
    assert.match(text, /household items/i);
    assert.match(text, /simple animals/i);
    assert.match(text, /boosters/i);
    assert.match(text, /propellers/i);
    assert.doesNotMatch(text, /gadgets/i);
    assert.doesNotMatch(text, /Moon Rover/i);
    assert.doesNotMatch(text, /Dragon Scooter/i);
  });

  it("builds suggestion metadata guidance around features instead of size or brick choices", () => {
    const request = buildBuildSuggestionsPrompt({
      inventory: duckInventory,
      model: "suggestion-model",
    });

    const text = requestText(request);

    assert.match(text, /prompt_metadata[\s\S]*features/i);
    assert.match(text, /prompt_metadata[\s\S]*silhouette/i);
    assert.match(text, /prompt_metadata[\s\S]*color accents/i);
    assert.match(text, /prompt_metadata[\s\S]*avoid size adjectives/i);
    assert.match(text, /prompt_metadata[\s\S]*Do not mention specific bricks/i);
    assert.doesNotMatch(text, /\bsmall\b/i);
    assert.doesNotMatch(text, /\btiny\b/i);
    assert.doesNotMatch(text, /\bcompact\b/i);
  });

  it("uses Gemini-compatible GeneratedModel numeric constraints in the placement schema", () => {
    const request = buildPlacementPrompt({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      structurePlan,
      targetPieceCount: 15,
      model: TEST_PLACEMENT_MODEL,
    });

    const placementSchema = request.generationConfig.responseSchema;
    const brickSchema = placementSchema.properties.bricks.items;

    assert.equal(placementSchema.properties.piece_count.type, "integer");
    assert.equal(brickSchema.properties.step.type, "integer");
    assert.equal(brickSchema.properties.rotation.type, "integer");
    assert.equal("enum" in brickSchema.properties.rotation, false);
  });

  it("builds a JSON repair request using the provided model", () => {
    const request = buildJsonRepairPrompt({
      label: "structure plan",
      malformedText: '{"model_name":"Tiny Duck",.',
      errorMessage: "Unexpected token",
      model: TEST_STRUCTURE_MODEL,
    });

    const text = requestText(request);

    assert.equal(request.model, TEST_STRUCTURE_MODEL);
    assertGeminiJsonRequest(request);
    assert.equal(request.generationConfig.responseSchema.properties.model_name.type, "string");
    assert.match(text, /repair malformed JSON/i);
    assert.match(text, /structure plan/);
    assert.match(text, /Unexpected token/);
  });

  it("builds a placement validation repair request with validator errors", () => {
    const invalidModel = {
      model_name: "Floating Duck",
      bricks: [{ id: "body", position: { x: 0, y: 0, z: 3 } }],
    };
    const validationErrors = [
      {
        type: "floating_brick",
        message: "body is above the ground layer without support underneath.",
      },
      {
        type: "no_ground_contact",
        message: "Model must have at least one brick on the ground layer.",
      },
    ];

    const request = buildPlacementValidationRepairPrompt({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      structurePlan,
      invalidModel,
      validationErrors,
      targetPieceCount: 15,
      model: TEST_PLACEMENT_MODEL,
    });

    const text = requestText(request);

    assert.equal(request.model, TEST_PLACEMENT_MODEL);
    assertGeminiJsonRequest(request, { maxOutputTokens: 30000 });
    assert.equal(request.generationConfig.responseSchema.properties.bricks.type, "array");
    assert.match(text, /repair a LEGO GeneratedModel/i);
    assert.match(text, /floating_brick/);
    assert.match(text, /no_ground_contact/);
    assert.match(text, /position\.z === 0/);
  });

  it("builds validation repair prompt around a pruned draft instead of full rebuild", () => {
    const request = buildPlacementValidationRepairPrompt({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      structurePlan: {
        model_name: "Duck",
        primary_object: "duck",
        target_piece_count: 2,
        overall_shape: "small duck",
        required_features: [],
        part_usage_plan: [],
        build_strategy: {
          base: "grounded body",
          body: "small body",
          raised_details: "head",
          stability_notes: "connected",
        },
        fallback_priorities: [],
        user_facing_summary: "duck",
      },
      invalidModel: { model_name: "Pruned Duck", bricks: [] },
      originalFailedModel: { model_name: "Original Duck", bricks: [{ id: "fake-eye" }] },
      prunedModel: { model_name: "Pruned Duck", bricks: [] },
      removedBricks: [
        {
          id: "fake-eye",
          feature: "eye",
          part_id: "9999",
          color_id: "14",
          reason: "unsupported_part",
          message: "fake-eye uses unsupported part 9999.",
        },
      ],
      validationErrors: [{ type: "no_ground_contact", message: "Model has no ground contact." }],
      targetPieceCount: 2,
      model: "test-model",
    });

    const systemText = request.systemInstruction.parts.map((part) => part.text).join("\n");
    const payload = JSON.parse(request.contents[0].parts[0].text);

    assert.match(systemText, /The pruned model is the starting point/i);
    assert.match(systemText, /Do not rebuild from scratch/i);
    assert.match(systemText, /You may modify any remaining brick/i);
    assert.match(systemText, /Do not re-add removed illegal bricks/i);
    assert.deepEqual(payload.original_failed_generated_model.bricks[0].id, "fake-eye");
    assert.deepEqual(payload.pruned_generated_model.bricks, []);
    assert.equal(payload.removed_bricks[0].reason, "unsupported_part");
  });

  it("builds a narrow inventory validation repair request", () => {
    const invalidModel = {
      model_name: "Duck With Wrong Part",
      bricks: [{ id: "body", part_id: "3023", color_id: "15" }],
    };
    const validationErrors = [
      {
        type: "inventory_missing",
        part_id: "3023",
        color_id: "15",
        message: "Model uses part 3023 color 15, which is not in inventory.",
      },
    ];

    const request = buildPlacementInventoryRepairPrompt({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      structurePlan,
      invalidModel,
      validationErrors,
      targetPieceCount: 15,
      model: TEST_PLACEMENT_MODEL,
    });

    const text = requestText(request);

    assert.equal(request.model, TEST_PLACEMENT_MODEL);
    assertGeminiJsonRequest(request);
    assert.match(text, /repair LEGO inventory validation errors/i);
    assert.match(text, /inventory_missing/);
    assert.match(text, /Do not use part\/color combinations that are absent/i);
    assert.doesNotMatch(text, /Support rule/);
    assert.doesNotMatch(text, /Connection rule/);
  });
});
