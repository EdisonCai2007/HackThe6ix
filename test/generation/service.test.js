import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { randomBuildInventory as duckInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { generateBuildSuggestions, generateModel, refineModel } from "../../src/generation/service.js";

const TEST_STRUCTURE_MODEL = "env-structure-model";
const TEST_PLACEMENT_MODEL = "env-placement-model";
const TEST_REPAIR_MODEL = "env-repair-model";

const structurePlan = {
  model_name: "Tiny Duck",
  primary_object: "duck",
  target_piece_count: 2,
  overall_shape: "A tiny blocky duck marker.",
  required_features: [
    {
      name: "body",
      visual_goal: "Yellow rectangular body",
      priority: "required",
      preferred_colors: ["green"],
      approximate_piece_budget: 1,
    },
  ],
  part_usage_plan: [
    {
      feature: "body",
      allowed_part_ids: ["3001"],
      allowed_color_ids: ["2"],
      max_pieces: 1,
      notes: "Use a green 2x4 brick.",
    },
  ],
  build_strategy: {
    base: "Place the brick on the ground.",
    body: "Use one brick as body.",
    raised_details: "Skip raised details.",
    stability_notes: "Ground contact only.",
  },
  fallback_priorities: ["Keep the body."],
  user_facing_summary: "I planned a tiny duck marker.",
};

const validModel = {
  model_name: "Tiny Duck",
  prompt: "build me a tiny duck",
  piece_count: 1,
  dimensions: { width_studs: 2, depth_studs: 4, height_layers: 3 },
  created_from_inventory_id: "random-build-assortment",
  generator_version: "gemini-two-stage-v1",
  bricks: [
    {
      id: "body-1",
      part_id: "3001",
      ldraw_id: "3001.dat",
      label: "2x4 brick",
      color_id: "2",
      color_name: "green",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      feature: "body",
      step: 1,
    },
  ],
  notes: ["A tiny valid single-brick duck marker."],
};

const floatingModel = {
  ...validModel,
  bricks: [
    {
      ...validModel.bricks[0],
      id: "floating-body",
      position: { x: 0, y: 0, z: 3 },
    },
  ],
};

const missingInventoryAndFloatingModel = {
  ...validModel,
  bricks: [
    {
      ...validModel.bricks[0],
      id: "floating-body",
      part_id: "3623",
      ldraw_id: "3623.dat",
      label: "1x3 plate",
      color_id: "15",
      color_name: "white",
      position: { x: 0, y: 0, z: 3 },
    },
  ],
};

const unsupportedPartAndFloatingModel = {
  ...validModel,
  piece_count: 2,
  bricks: [
    {
      ...validModel.bricks[0],
      id: "floating-body",
      position: { x: 0, y: 0, z: 3 },
    },
    {
      ...validModel.bricks[0],
      id: "unsupported-accent",
      part_id: "9999",
      ldraw_id: "9999.dat",
      label: "unsupported part",
      position: { x: 3, y: 0, z: 0 },
      feature: "accent",
      step: 2,
    },
  ],
};

const offGridModel = {
  ...validModel,
  bricks: [
    {
      ...validModel.bricks[0],
      position: { x: 0.5, y: 0, z: 0 },
    },
  ],
};

const offGridPatch = {
  operations: [
    { type: "move", id: "body-1", position: { x: 0, y: 0, z: 0 } },
  ],
};

const stillOffGridPatch = {
  operations: [
    { type: "move", id: "body-1", position: { x: 0.5, y: 0, z: 0 } },
  ],
};

function fakeClient(contents) {
  const calls = [];
  const metadataCalls = [];
  const serviceEvents = [];

  return {
    calls,
    metadataCalls,
    serviceEvents,
    logServiceEvent(event) {
      serviceEvents.push(event);
    },
    async complete(request, metadata) {
      calls.push(request);
      metadataCalls.push(metadata);
      return contents.shift();
    },
  };
}

function generateTestModel(options) {
  return generateModel({
    structureModel: TEST_STRUCTURE_MODEL,
    placementModel: TEST_PLACEMENT_MODEL,
    repairModel: TEST_REPAIR_MODEL,
    ...options,
  });
}

describe("generateModel", () => {
  it("emits complete placement brick patches while placement text is streaming", async () => {
    const events = [];
    const client = {
      async complete(request) {
        if (request.model === TEST_STRUCTURE_MODEL) return JSON.stringify(structurePlan);
        throw new Error("buffered placement should not run");
      },
      async *streamWithMetadata() {
        yield { text: JSON.stringify({ ...validModel, bricks: [{ ...validModel.bricks[0] }]}).slice(0, 260) };
        yield { text: JSON.stringify({ ...validModel, bricks: [{ ...validModel.bricks[0] }]}).slice(260) };
      },
    };

    const result = await generateTestModel({
      userPrompt: "build me a tiny duck",
      inventory: duckInventory,
      targetPieceCount: 2,
      generationClient: client,
      streamPlacement: true,
      onProgress: (event) => events.push(event),
    });

    assert.equal(result.ok, true);
    assert.equal(events.some((event) => event.type === "brick" && event.phase === "placement"), true);
  });

  it("repairs truncated streamed placement JSON with the generated model schema", async () => {
    const calls = [];
    const metadataCalls = [];
    const client = {
      async complete(request, metadata) {
        calls.push(request);
        metadataCalls.push(metadata);

        if (request.model === TEST_STRUCTURE_MODEL) return JSON.stringify(structurePlan);
        return JSON.stringify(validModel);
      },
      async *streamWithMetadata() {
        yield { text: JSON.stringify(validModel).slice(0, 120) };
      },
    };

    const result = await generateTestModel({
      userPrompt: "build me a tiny duck",
      inventory: duckInventory,
      targetPieceCount: 2,
      generationClient: client,
      streamPlacement: true,
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(metadataCalls[1].stage, "placement_repair");
    assert.equal(calls[1].generationConfig.maxOutputTokens, 40000);
    assert.equal(calls[1].generationConfig.responseSchema.properties.bricks.type, "array");
    assert.equal(calls[1].generationConfig.responseSchema.properties.primary_object, undefined);
  });

  it("runs structure, placement, shape validation, and model validation", async () => {
    const client = fakeClient([JSON.stringify(structurePlan), JSON.stringify(validModel)]);

    const result = await generateTestModel({
      userPrompt: "build me a tiny duck",
      inventory: duckInventory,
      targetPieceCount: 2,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.model.model_name, "Tiny Duck");
    assert.equal(result.structurePlan.primary_object, "duck");
    assert.equal(result.validation.valid, true);
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[0].model, TEST_STRUCTURE_MODEL);
    assert.equal(client.calls[1].model, TEST_PLACEMENT_MODEL);
  });

  it("requires callers to provide resolved structure and placement models", async () => {
    const client = fakeClient([JSON.stringify(structurePlan), JSON.stringify(validModel)]);

    await assert.rejects(
      () =>
        generateModel({
          userPrompt: "build me a tiny duck",
          inventory: duckInventory,
          targetPieceCount: 2,
          generationClient: client,
        }),
      /structureModel and placementModel are required/,
    );
  });

  it("allows structure and placement models to be overridden independently", async () => {
    const client = fakeClient([JSON.stringify(structurePlan), JSON.stringify(validModel)]);

    const result = await generateTestModel({
      userPrompt: "build me a tiny duck",
      inventory: duckInventory,
      generationClient: client,
      structureModel: "custom-planner",
      placementModel: "custom-builder",
    });

    assert.equal(result.ok, true);
    assert.equal(client.calls[0].model, "custom-planner");
    assert.equal(client.calls[1].model, "custom-builder");
  });

  it("labels structure and placement model calls for persistent runtime logs", async () => {
    const client = fakeClient([JSON.stringify(structurePlan), JSON.stringify(validModel)]);

    const result = await generateTestModel({
      userPrompt: "build me a tiny duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(client.metadataCalls, [
      {
        phase: "planning",
        stage: "structure_generate",
        label: "Structure planning",
      },
      {
        phase: "placing",
        stage: "placement_generate",
        label: "Placement generation",
      },
    ]);
  });

  it("returns parse errors when structure JSON is malformed", async () => {
    const client = fakeClient(["{ bad"]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "structure_parse");
    assert.match(result.errors[0].message, /Invalid structure plan JSON/);
    assert.equal(client.serviceEvents.length, 1);
    assert.equal(client.serviceEvents[0].type, "json_parse_failure");
    assert.equal(client.serviceEvents[0].stage, "structure_parse");
    assert.equal(client.serviceEvents[0].label, "Structure JSON parse");
  });

  it("does not hide malformed structure JSON behind a fixture repair", async () => {
    const client = fakeClient([
      '{"model_name":"Tiny Duck",.',
      JSON.stringify(structurePlan),
      JSON.stringify(validModel),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "structure_parse");
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].model, TEST_STRUCTURE_MODEL);
  });

  it("returns shape errors before validator when placement JSON is malformed", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify({ ...validModel, bricks: [{ id: "bad" }] }),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "placement_shape");
    assert.equal(result.errors.some((error) => error.field.includes("part_id")), true);
  });

  it("returns malformed buffered placement JSON without fixture repair", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      '{"model_name":"Tiny Duck",.',
      JSON.stringify(validModel),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "placement_parse");
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[0].model, TEST_STRUCTURE_MODEL);
    assert.equal(client.calls[1].model, TEST_PLACEMENT_MODEL);
    assert.equal(client.serviceEvents.length, 1);
    assert.equal(client.serviceEvents[0].type, "json_parse_failure");
    assert.equal(client.serviceEvents[0].source, "generation_service");
    assert.equal(client.serviceEvents[0].stage, "placement_parse");
    assert.equal(client.serviceEvents[0].label, "Placement JSON parse");
    assert.match(client.serviceEvents[0].errors[0].message, /Invalid placement model JSON/);
  });

  it("returns locally cleaned generated placements without refinement", async () => {
    const invalidModel = {
      ...validModel,
      bricks: [
        {
          ...validModel.bricks[0],
          part_id: "9999",
          ldraw_id: "9999.dat",
          label: "unsupported part",
        },
      ],
    };
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(invalidModel),
      JSON.stringify(validModel),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.removedBricks.length, 1);
    assert.equal(result.removedBricks[0].id, "body-1");
    assert.equal(result.removedBricks[0].reason, "unsupported_part");
    assert.equal(result.stage, "complete");
    assert.equal(result.complete, true);
    assert.equal(result.requiresRefinement, false);
    assert.equal(result.model.bricks.length, 0);
    assert.equal(result.validation.valid, true);
    assert.equal(result.repair.outcome, "local_deterministic_valid");
    assert.equal(client.calls.length, 2);
    assert.equal(client.serviceEvents.length, 1);
    assert.equal(client.serviceEvents[0].type, "local_deterministic_repair");
    assert.equal(client.serviceEvents[0].repairKind, "local_deterministic_repair");
    assert.deepEqual(client.serviceEvents[0].removedBrickIds, ["body-1"]);
    assert.deepEqual(client.serviceEvents[0].removedReasons, ["unsupported_part"]);
  });

  it("returns pruned cleanup context when unsupported inventory and buildability errors are mixed", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(unsupportedPartAndFloatingModel),
      JSON.stringify(validModel),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.removedBricks.length, 2);
    assert.equal(result.removedBricks[0].id, "unsupported-accent");
    assert.equal(result.removedBricks[0].reason, "unsupported_part");
    assert.equal(result.removedBricks[1].id, "floating-body");
    assert.equal(result.removedBricks[1].reason, "floating_brick");
    assert.equal(result.model.bricks.length, 0);
    assert.equal(result.validation.valid, true);
    assert.equal(result.requiresRefinement, false);
    assert.equal(client.calls.length, 2);
  });

  it("removes obvious floating geometry locally before asking AI", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(floatingModel),
      JSON.stringify(validModel),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "complete");
    assert.equal(result.model.bricks.length, 0);
    assert.equal(result.validation.valid, true);
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[0].model, TEST_STRUCTURE_MODEL);
    assert.equal(client.calls[1].model, TEST_PLACEMENT_MODEL);
  });

  it("repairs invalid placement with an AI patch before full-model refinement", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(offGridModel),
      JSON.stringify(offGridPatch),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "complete");
    assert.equal(result.complete, true);
    assert.equal(result.requiresRefinement, false);
    assert.equal(result.validation.valid, true);
    assert.deepEqual(result.model.bricks[0].position, { x: 0, y: 0, z: 0 });
    assert.equal(result.repair.outcome, "ai_patch_repair_valid");
    assert.equal(client.calls.length, 3);
    assert.equal(client.calls[2].model, TEST_REPAIR_MODEL);
    assert.deepEqual(client.metadataCalls.map((metadata) => metadata.stage), [
      "structure_generate",
      "placement_generate",
      "patch_repair",
    ]);
    assert.equal(client.metadataCalls[2].repairKind, "ai_patch_repair");
    assert.equal(client.calls[2].generationConfig.responseSchema.properties.bricks, undefined);
  });

  it("falls back to full-model refinement after malformed patch repair attempts", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(offGridModel),
      "not json",
      '{"operations":',
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "awaiting_refinement");
    assert.equal(result.complete, false);
    assert.equal(result.requiresRefinement, true);
    assert.equal(result.validation.valid, false);
    assert.equal(client.calls.length, 4);
    assert.deepEqual(client.metadataCalls.map((metadata) => metadata.stage), [
      "structure_generate",
      "placement_generate",
      "patch_repair",
      "patch_retry",
    ]);
    assert.equal(client.calls[3].generationConfig.maxOutputTokens, 1500);
    assert.equal(
      client.serviceEvents.filter((event) => event.type === "json_parse_failure").length,
      2,
    );
    assert.equal(
      client.serviceEvents.some((event) => event.type === "full_model_fallback"),
      true,
    );
  });

  it("falls back to full-model refinement after invalid patch repair attempts", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(offGridModel),
      JSON.stringify(stillOffGridPatch),
      JSON.stringify(stillOffGridPatch),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "awaiting_refinement");
    assert.equal(result.requiresRefinement, true);
    assert.equal(result.validation.valid, false);
    assert.equal(client.calls.length, 4);
    assert.equal(
      client.serviceEvents.filter((event) => event.reason === "patched_model_invalid").length,
      2,
    );
    assert.equal(
      client.serviceEvents.find((event) => event.type === "full_model_fallback")?.reason,
      "patch_repair_failed",
    );
  });

  it("does not fall back to full-model refinement when the patch retry succeeds", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(offGridModel),
      "not json",
      JSON.stringify(offGridPatch),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "complete");
    assert.equal(result.requiresRefinement, false);
    assert.equal(result.validation.valid, true);
    assert.equal(result.repair.outcome, "ai_patch_retry_valid");
    assert.equal(client.calls.length, 4);
    assert.deepEqual(client.metadataCalls.map((metadata) => metadata.stage), [
      "structure_generate",
      "placement_generate",
      "patch_repair",
      "patch_retry",
    ]);
    assert.equal(
      client.serviceEvents.some((event) => event.type === "full_model_fallback"),
      false,
    );
  });

  it("normal repair no longer requires AI to emit all bricks", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(offGridModel),
      JSON.stringify({
        operations: [
          { op: "move", id: "body-1", position: { x: 0, y: 0, z: 0 } },
        ],
      }),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.validation.valid, true);
    assert.equal(result.model.bricks.length, 1);
    assert.equal(result.model.bricks[0].id, "body-1");
    assert.equal(result.model.bricks[0].label, "2x4 brick");
    assert.equal(result.repair.patchRepair.operationCount, 1);
    assert.equal(client.calls.length, 3);
  });

  it("cleans inventory validation errors before returning the initial result", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(missingInventoryAndFloatingModel),
      JSON.stringify(validModel),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.validation.valid, true);
    assert.equal(result.removedBricks.length, 1);
    assert.equal(result.removedBricks[0].reason, "inventory_missing");
    assert.equal(result.requiresRefinement, false);
    assert.equal(client.calls.length, 2);
  });

  it("emits cleaned and patched draft events during patch repair", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(offGridModel),
      JSON.stringify(offGridPatch),
    ]);
    const events = [];

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
      onProgress: (event) => events.push(event),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      events
        .filter((event) => event.type === "draft")
        .map((event) => event.stage),
      ["cleaned_placement_draft", "patched_placement_draft"],
    );
    assert.equal(events.find((event) => event.stage === "cleaned_placement_draft").validation.valid, false);
    assert.equal(events.find((event) => event.stage === "patched_placement_draft").validation.valid, true);
  });

  it("cleans illegal inventory before exposing the result model", async () => {
    const prunedValidModel = {
      ...validModel,
      bricks: [],
      piece_count: 0,
    };
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(missingInventoryAndFloatingModel),
      JSON.stringify(validModel),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.removedBricks.length, 1);
    assert.equal(result.removedBricks[0].reason, "inventory_missing");
    assert.equal(client.calls.length, 2);
    assert.deepEqual(result.model, prunedValidModel);
  });

  it("returns a valid pruned model without refinement", async () => {
    const invalidInventoryOnlyModel = {
      ...validModel,
      bricks: [
        ...validModel.bricks,
        {
          ...validModel.bricks[0],
          id: "illegal-extra",
          part_id: "3623",
          ldraw_id: "3623.dat",
          label: "1x3 plate",
          color_id: "15",
          color_name: "white",
          position: { x: 5, y: 0, z: 0 },
          feature: "accent",
          step: 2,
        },
      ],
      piece_count: 2,
    };
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(invalidInventoryOnlyModel),
      "not json",
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.validation.valid, true);
    assert.equal(result.model.bricks.length, 1);
    assert.equal(result.model.bricks[0].id, "body-1");
    assert.equal(result.stage, "complete");
    assert.equal(result.requiresRefinement, false);
    assert.equal(client.calls.length, 2);
    assert.equal(result.removedBricks[0].id, "illegal-extra");
  });

  it("emits the initial generation timeline when JSON is valid", async () => {
    const client = fakeClient([JSON.stringify(structurePlan), JSON.stringify(validModel)]);
    const events = [];

    const result = await generateTestModel({
      userPrompt: "build me a tiny duck",
      inventory: duckInventory,
      targetPieceCount: 2,
      generationClient: client,
      onProgress: (event) => events.push(event),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      events
        .filter((event) => event.status === "running")
        .map((event) => event.stage),
      [
        "structure_generate",
        "structure_parse",
        "placement_generate",
        "placement_parse",
        "validation",
      ],
    );
    assert.equal(events.some((event) => event.status === "skipped"), false);
    assert.deepEqual(
      events
        .filter((event) => event.status === "complete")
        .map((event) => event.stage),
      [
        "structure_generate",
        "structure_parse",
        "placement_generate",
        "placement_parse",
        "validation",
      ],
    );
  });

  it("marks placement parsing failed when buffered placement JSON is invalid", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      "We need to place the body first.",
      "We need to keep thinking, not JSON.",
    ]);
    const events = [];

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
      onProgress: (event) => events.push(event),
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "placement_parse");
    assert.equal(
      events.some(
        (event) => event.stage === "placement_parse" && event.status === "failed",
      ),
      true,
    );
  });

  it("marks structure parsing failed when malformed JSON is returned", async () => {
    const client = fakeClient([
      '{"model_name":"Tiny Duck",.',
      JSON.stringify(structurePlan),
      JSON.stringify(validModel),
    ]);
    const events = [];

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
      onProgress: (event) => events.push(event),
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      events
        .filter((event) => event.stage === "structure_parse")
        .map((event) => event.status),
      ["running", "failed"],
    );
    assert.deepEqual(
      events
        .filter((event) => event.stage === "structure_repair")
        .map((event) => event.status),
      [],
    );
  });
});

describe("refineModel", () => {
  it("logs parse failure and full-model fallback for malformed refinement JSON", async () => {
    const serviceEvents = [];
    const client = {
      serviceEvents,
      logServiceEvent(event) {
        serviceEvents.push(event);
      },
      async complete() {
        return "not json";
      },
    };

    const result = await refineModel({
      userPrompt: "build me a tiny duck",
      inventory: duckInventory,
      targetPieceCount: 2,
      structurePlan,
      originalModel: validModel,
      generationClient: client,
      refinementModel: TEST_REPAIR_MODEL,
    });

    assert.equal(result.ok, true);
    assert.equal(result.refinement.outcome, "cleaned_initial_parse_fallback");

    const parseEvent = serviceEvents.find((event) => event.type === "json_parse_failure");
    assert.equal(parseEvent.stage, "refinement_parse");
    assert.equal(parseEvent.label, "Refinement JSON parse");
    assert.match(parseEvent.errors[0].message, /Invalid refinement model JSON/);

    const fallbackEvent = serviceEvents.find((event) => event.type === "full_model_fallback");
    assert.equal(fallbackEvent.repairKind, "full_model_fallback");
    assert.equal(fallbackEvent.reason, "refinement_json_parse_failed");
    assert.equal(fallbackEvent.outcome, "cleaned_initial_parse_fallback");
    assert.equal(fallbackEvent.cleanedInitialValid, true);
  });

  it("marks replacement metadata from live streamed placement ids", async () => {
    const events = [];
    const client = {
      async *streamWithMetadata() {
        yield { text: JSON.stringify(validModel) };
      },
    };

    const result = await refineModel({
      userPrompt: "build me a tiny duck",
      inventory: duckInventory,
      targetPieceCount: 2,
      structurePlan,
      originalModel: validModel,
      generationClient: client,
      refinementModel: TEST_REPAIR_MODEL,
      streamRefinement: true,
      streamedBrickIds: ["a-different-live-id"],
      onProgress: (event) => events.push(event),
    });

    assert.equal(result.ok, true);
    assert.equal(events.find((event) => event.type === "brick")?.replaced, false);
  });
});

describe("generateBuildSuggestions", () => {
  it("labels suggestion generation calls for persistent runtime logs", async () => {
    const client = fakeClient([
      JSON.stringify({
        suggestions: [
          {
            label: "Tiny Duck",
            prompt_metadata: "Build a tiny duck with a blocky body and beak.",
            inventory_reasoning: "Yellow bricks can form the body.",
          },
        ],
      }),
    ]);

    const result = await generateBuildSuggestions({
      inventory: duckInventory,
      generationClient: client,
      suggestionModel: "suggestion-model",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(client.metadataCalls, [
      {
        phase: "suggestion",
        stage: "suggestion_generate",
        label: "Build suggestion generation",
      },
    ]);
  });
});
