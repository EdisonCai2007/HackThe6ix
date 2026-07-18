import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { duckInventory } from "../../src/generation/fixtures/duckInventory.js";
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
      preferred_colors: ["yellow"],
      approximate_piece_budget: 1,
    },
  ],
  part_usage_plan: [
    {
      feature: "body",
      allowed_part_ids: ["3001"],
      allowed_color_ids: ["14"],
      max_pieces: 1,
      notes: "Use a yellow 2x4 brick.",
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
  created_from_inventory_id: "duck-demo",
  generator_version: "gemini-two-stage-v1",
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
      part_id: "3023",
      ldraw_id: "3023.dat",
      label: "1x2 plate",
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

function fakeClient(contents) {
  const calls = [];
  const metadataCalls = [];

  return {
    calls,
    metadataCalls,
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

function requestText(request) {
  return [
    ...(request.systemInstruction?.parts ?? []),
    ...(request.contents ?? []).flatMap((content) => content.parts),
  ]
    .map((part) => part.text)
    .join("\n");
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
  });

  it("repairs malformed structure JSON once before failing generation", async () => {
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

    assert.equal(result.ok, true);
    assert.equal(result.structurePlan.model_name, "Tiny Duck");
    assert.equal(client.calls.length, 3);
    assert.equal(client.calls[0].model, TEST_STRUCTURE_MODEL);
    assert.equal(client.calls[1].model, TEST_REPAIR_MODEL);
    assert.equal(client.calls[2].model, TEST_PLACEMENT_MODEL);
    assert.match(requestText(client.calls[1]), /repair malformed JSON/i);
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

  it("repairs malformed placement JSON once before shape validation", async () => {
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

    assert.equal(result.ok, true);
    assert.equal(result.model.model_name, "Tiny Duck");
    assert.equal(client.calls.length, 3);
    assert.equal(client.calls[0].model, TEST_STRUCTURE_MODEL);
    assert.equal(client.calls[1].model, TEST_PLACEMENT_MODEL);
    assert.equal(client.calls[2].model, TEST_REPAIR_MODEL);
    assert.match(requestText(client.calls[2]), /repair malformed JSON/i);
  });

  it("cleans unsupported generated placements before asking AI to repair", async () => {
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
    assert.equal(client.calls.length, 3);
    assert.match(requestText(client.calls[2]), /unsupported_part/);
    assert.match(requestText(client.calls[2]), /removed_bricks/);
  });

  it("uses pruned cleanup context when unsupported inventory and buildability errors are mixed", async () => {
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
    assert.equal(result.removedBricks.length, 1);
    assert.equal(result.removedBricks[0].id, "unsupported-accent");
    assert.equal(result.removedBricks[0].reason, "unsupported_part");
    assert.equal(client.calls.length, 3);

    const repairText = requestText(client.calls[2]);
    assert.match(repairText, /floating-body/);
    assert.match(repairText, /unsupported-accent/);
    assert.match(repairText, /pruned_generated_model/);
    assert.match(repairText, /removed_bricks/);
  });

  it("repairs buildability validation errors once before returning success", async () => {
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
    assert.equal(result.model.bricks[0].position.z, 0);
    assert.equal(result.validation.valid, true);
    assert.equal(client.calls.length, 3);
    assert.equal(client.calls[0].model, TEST_STRUCTURE_MODEL);
    assert.equal(client.calls[1].model, TEST_PLACEMENT_MODEL);
    assert.equal(client.calls[2].model, TEST_REPAIR_MODEL);
    assert.match(requestText(client.calls[2]), /repair a LEGO GeneratedModel/i);
    assert.match(requestText(client.calls[2]), /floating_brick/);
  });

  it("repairs malformed validation repair JSON once before returning success", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(floatingModel),
      '{"model_name":"Tiny Duck",.',
      JSON.stringify(validModel),
    ]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.validation.valid, true);
    assert.equal(client.calls.length, 4);
    assert.equal(client.calls[2].model, TEST_REPAIR_MODEL);
    assert.equal(client.calls[3].model, TEST_REPAIR_MODEL);
    assert.match(requestText(client.calls[2]), /repair a LEGO GeneratedModel/i);
    assert.match(requestText(client.calls[3]), /repair malformed JSON/i);
    assert.match(requestText(client.calls[3]), /placement validation repair model/);
    assert.deepEqual(client.metadataCalls.map((metadata) => metadata.stage), [
      "structure_generate",
      "placement_generate",
      "validation_repair",
      "validation_repair_parse",
    ]);
  });

  it("repairs inventory validation errors before buildability errors", async () => {
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
    assert.equal(client.calls.length, 3);
    assert.match(requestText(client.calls[2]), /repair a LEGO GeneratedModel/i);
    assert.match(requestText(client.calls[2]), /removed_bricks/);
    assert.match(requestText(client.calls[2]), /pruned_generated_model/);
  });

  it("emits a draft event for schema-valid placement before validation repair", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify(floatingModel),
      JSON.stringify(validModel),
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
      ["placement_draft"],
    );
    assert.equal(events.find((event) => event.type === "draft").model.bricks[0].id, "floating-body");
  });

  it("cleans illegal inventory before asking AI to repair buildability", async () => {
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
    assert.equal(client.calls.length, 3);

    const repairText = requestText(client.calls[2]);
    assert.match(repairText, /removed_bricks/);
    assert.match(repairText, /pruned_generated_model/);
    assert.match(repairText, /floating-body/);
    assert.notDeepEqual(result.model, prunedValidModel);
  });

  it("falls back to a valid pruned model when AI repair fails", async () => {
    const invalidInventoryOnlyModel = {
      ...validModel,
      bricks: [
        ...validModel.bricks,
        {
          ...validModel.bricks[0],
          id: "illegal-extra",
          part_id: "3023",
          ldraw_id: "3023.dat",
          label: "1x2 plate",
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
    assert.equal(result.repaired, false);
    assert.equal(result.removedBricks[0].id, "illegal-extra");
  });

  it("emits seven timeline stages and skips repairs when JSON is valid", async () => {
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
    assert.deepEqual(
      events
        .filter((event) => event.status === "skipped")
        .map((event) => event.stage),
      ["structure_repair", "placement_repair", "validation_repair"],
    );
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

  it("marks placement repair failed when repaired placement JSON is still invalid", async () => {
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
        (event) => event.stage === "placement_repair" && event.status === "failed",
      ),
      true,
    );
  });

  it("marks parse complete when malformed JSON is repaired successfully", async () => {
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

    assert.equal(result.ok, true);
    assert.deepEqual(
      events
        .filter((event) => event.stage === "structure_parse")
        .map((event) => event.status),
      ["running", "complete"],
    );
    assert.deepEqual(
      events
        .filter((event) => event.stage === "structure_repair")
        .map((event) => event.status),
      ["running", "complete"],
    );
  });
});

describe("refineModel", () => {
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
