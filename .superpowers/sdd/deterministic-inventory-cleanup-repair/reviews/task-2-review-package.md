# No-git review package: Task 2

## Files changed
- src/generation/service.js
- test/generation/service.test.js
- src/generation/generationPrompts.js (minimal payload pass-through)

## src/generation/service.js

```js
import { parseJsonObject, parseStructurePlanText } from "./designPlan.js";
import { validateGeneratedModelShape } from "./generatedModelSchema.js";
import {
  buildJsonRepairPrompt,
  buildPlacementPrompt,
  buildPlacementValidationRepairPrompt,
  buildStructurePrompt,
  GENERATED_MODEL_SCHEMA,
  STRUCTURE_PLAN_SCHEMA,
} from "./generationPrompts.js";
import { cleanupIllegalInventoryUsage } from "./inventoryCleanup.js";
import { validateModel } from "./validator.js";

function failure(stage, errors, extra = {}) {
  return {
    ok: false,
    stage,
    errors,
    ...extra,
  };
}

const STAGE_LABELS = {
  structure_generate: "Structure generation",
  structure_parse: "Structure JSON parse",
  structure_repair: "Structure JSON repair",
  placement_generate: "Placement generation",
  placement_parse: "Placement JSON parse",
  placement_repair: "Placement JSON repair",
  validation: "Validation",
  validation_repair: "Validation repair",
};

const REPAIRABLE_VALIDATION_TYPES = new Set([
  "floating_brick",
  "disconnected_component",
  "no_ground_contact",
  "overlapping_bricks",
]);

const REPAIRABLE_INVENTORY_VALIDATION_TYPES = new Set([
  "inventory_missing",
  "inventory_exceeded",
]);

const REPAIRABLE_PLACEMENT_VALIDATION_TYPES = new Set([
  ...REPAIRABLE_INVENTORY_VALIDATION_TYPES,
  ...REPAIRABLE_VALIDATION_TYPES,
]);

async function emitProgress(onProgress, stage, status) {
  if (typeof onProgress !== "function") {
    return;
  }

  await onProgress({
    type: "stage",
    stage,
    status,
    label: STAGE_LABELS[stage],
  });
}

async function emitDraft(onProgress, stage, payload) {
  if (typeof onProgress !== "function") {
    return;
  }

  await onProgress({
    type: "draft",
    stage,
    ...payload,
  });
}

async function parseWithOneRepair({
  text,
  label,
  parse,
  generationClient,
  model,
  responseSchema,
  onProgress,
  parseStage,
  repairStage,
}) {
  await emitProgress(onProgress, parseStage, "running");
  const initialResult = parse(text);

  if (initialResult.ok) {
    await emitProgress(onProgress, parseStage, "complete");
    await emitProgress(onProgress, repairStage, "skipped");
    return initialResult;
  }

  await emitProgress(onProgress, repairStage, "running");
  const repairRequest = buildJsonRepairPrompt({
    label,
    malformedText: text,
    errorMessage: initialResult.errors[0]?.message ?? `Invalid ${label} JSON.`,
    model,
    responseSchema,
  });
  const repairedText = await generationClient.complete(repairRequest);

  const repairedResult = parse(repairedText);

  await emitProgress(onProgress, parseStage, repairedResult.ok ? "complete" : "failed");
  await emitProgress(onProgress, repairStage, repairedResult.ok ? "complete" : "failed");

  return repairedResult;
}

function hasRepairableValidationError(validation) {
  return (
    validation.errors.length > 0 &&
    validation.errors.every((error) => REPAIRABLE_PLACEMENT_VALIDATION_TYPES.has(error.type))
  );
}

function validationErrorsMatching(validation, repairableTypes) {
  return validation.errors.filter((error) => repairableTypes.has(error.type));
}

function hasValidationErrorType(validation, repairableTypes) {
  return validationErrorsMatching(validation, repairableTypes).length > 0;
}

function buildValidationFailure(stage, errors, model, validation, originalValidation, extra = {}) {
  return {
    ok: false,
    stage,
    errors,
    model,
    validation,
    ...(originalValidation ? { originalValidation } : {}),
    ...extra,
  };
}

async function runPlacementValidationRepair({
  userPrompt,
  inventory,
  structurePlan,
  invalidModel,
  originalFailedModel,
  prunedModel,
  removedBricks = [],
  validation,
  targetPieceCount,
  generationClient,
  model,
  buildRepairPrompt,
  validationErrors,
}) {
  const repairRequest = buildRepairPrompt({
    userPrompt,
    inventory,
    structurePlan,
    invalidModel,
    originalFailedModel,
    prunedModel,
    removedBricks,
    validationErrors,
    targetPieceCount,
    model,
  });
  const repairedText = await generationClient.complete(repairRequest);
  const repairedJson = parseJsonObject(repairedText, "placement validation repair model");

  if (!repairedJson.ok) {
    return {
      ok: false,
      stage: "validation_repair_parse",
      errors: repairedJson.errors,
      model: invalidModel,
      validation,
    };
  }

  const shapeResult = validateGeneratedModelShape(repairedJson.value);

  if (!shapeResult.ok) {
    return {
      ok: false,
      stage: "validation_repair_shape",
      errors: shapeResult.errors,
      model: repairedJson.value,
      validation,
    };
  }

  const repairedValidation = validateModel(repairedJson.value, inventory);

  return {
    ok: true,
    model: repairedJson.value,
    validation: repairedValidation,
  };
}

async function repairInvalidPlacement({
  userPrompt,
  inventory,
  structurePlan,
  invalidModel,
  validation,
  targetPieceCount,
  generationClient,
  model,
  onProgress,
}) {
  if (!hasRepairableValidationError(validation)) {
    await emitProgress(onProgress, "validation_repair", "skipped");
    return buildValidationFailure("validation", validation.errors, invalidModel, validation);
  }

  await emitProgress(onProgress, "validation_repair", "running");

  let currentModel = invalidModel;
  let currentValidation = validation;
  let removedBricks = [];
  let prunedModel = currentModel;
  let prunedValidation = currentValidation;

  if (hasValidationErrorType(currentValidation, REPAIRABLE_INVENTORY_VALIDATION_TYPES)) {
    const cleanup = cleanupIllegalInventoryUsage(currentModel, inventory);
    removedBricks = cleanup.removedBricks;
    prunedModel = cleanup.model;
    prunedValidation = validateModel(prunedModel, inventory);

    await emitDraft(onProgress, "pruned_draft", {
      model: prunedModel,
      validation: prunedValidation,
      removedBricks,
    });

    currentModel = prunedModel;
    currentValidation = prunedValidation;
  }

  if (!currentValidation.errors.every((error) => REPAIRABLE_VALIDATION_TYPES.has(error.type))) {
    await emitProgress(onProgress, "validation_repair", "failed");
    return buildValidationFailure(
      "validation",
      currentValidation.errors,
      currentModel,
      currentValidation,
      validation,
      {
        prunedModel,
        prunedValidation,
        removedBricks,
      },
    );
  }

  const buildabilityRepair = await runPlacementValidationRepair({
    userPrompt,
    inventory,
    structurePlan,
    invalidModel: currentModel,
    originalFailedModel: invalidModel,
    prunedModel,
    removedBricks,
    validation: currentValidation,
    validationErrors: currentValidation.errors,
    targetPieceCount,
    generationClient,
    model,
    buildRepairPrompt: buildPlacementValidationRepairPrompt,
  });

  if (!buildabilityRepair.ok && removedBricks.length > 0 && currentValidation.valid) {
    await emitProgress(onProgress, "validation_repair", "complete");
    return {
      ok: true,
      model: currentModel,
      validation: currentValidation,
      removedBricks,
      repaired: false,
    };
  }

  await emitProgress(
    onProgress,
    "validation_repair",
    buildabilityRepair.ok && buildabilityRepair.validation.valid ? "complete" : "failed",
  );

  if (!buildabilityRepair.ok) {
    return {
      ...buildabilityRepair,
      prunedModel,
      prunedValidation,
      removedBricks,
    };
  }

  if (buildabilityRepair.validation.valid) {
    return {
      ...buildabilityRepair,
      removedBricks,
      repaired: true,
    };
  }

  return buildValidationFailure(
    "validation",
    buildabilityRepair.validation.errors,
    buildabilityRepair.model,
    buildabilityRepair.validation,
    validation,
    {
      prunedModel,
      prunedValidation,
      removedBricks,
    },
  );
}

export async function generateModel({
  userPrompt,
  inventory,
  targetPieceCount,
  generationClient,
  structureModel,
  placementModel,
  onProgress,
}) {
  if (
    typeof structureModel !== "string" ||
    structureModel.trim() === "" ||
    typeof placementModel !== "string" ||
    placementModel.trim() === ""
  ) {
    throw new Error(
      "structureModel and placementModel are required. Resolve them from GEMINI_MODEL or GEMINI_STRUCTURE_MODEL/GEMINI_PLACEMENT_MODEL before calling generateModel.",
    );
  }

  const resolvedStructureModel = structureModel.trim();
  const resolvedPlacementModel = placementModel.trim();

  const structureRequest = buildStructurePrompt({
    userPrompt,
    inventory,
    targetPieceCount,
    model: resolvedStructureModel,
  });

  await emitProgress(onProgress, "structure_generate", "running");
  const structureText = await generationClient.complete(structureRequest);
  await emitProgress(onProgress, "structure_generate", "complete");
  const structureResult = await parseWithOneRepair({
    text: structureText,
    label: "structure plan",
    parse: parseStructurePlanText,
    generationClient,
    model: resolvedStructureModel,
    responseSchema: STRUCTURE_PLAN_SCHEMA,
    onProgress,
    parseStage: "structure_parse",
    repairStage: "structure_repair",
  });

  if (!structureResult.ok) {
    return failure("structure_parse", structureResult.errors);
  }

  const placementRequest = buildPlacementPrompt({
    userPrompt,
    inventory,
    structurePlan: structureResult.value,
    targetPieceCount,
    model: resolvedPlacementModel,
  });

  await emitProgress(onProgress, "placement_generate", "running");
  const placementText = await generationClient.complete(placementRequest);
  await emitProgress(onProgress, "placement_generate", "complete");
  const placementJson = await parseWithOneRepair({
    text: placementText,
    label: "placement model",
    parse: (text) => parseJsonObject(text, "placement model"),
    generationClient,
    model: resolvedPlacementModel,
    responseSchema: GENERATED_MODEL_SCHEMA,
    onProgress,
    parseStage: "placement_parse",
    repairStage: "placement_repair",
  });

  if (!placementJson.ok) {
    return failure("placement_parse", placementJson.errors, {
      structurePlan: structureResult.value,
    });
  }

  await emitProgress(onProgress, "validation", "running");
  const shapeResult = validateGeneratedModelShape(placementJson.value);

  if (!shapeResult.ok) {
    await emitProgress(onProgress, "validation", "failed");
    return failure("placement_shape", shapeResult.errors, {
      structurePlan: structureResult.value,
    });
  }

  await emitDraft(onProgress, "placement_draft", {
    model: placementJson.value,
  });

  const validation = validateModel(placementJson.value, inventory);

  if (!validation.valid) {
    const repairedPlacement = await repairInvalidPlacement({
      userPrompt,
      inventory,
      structurePlan: structureResult.value,
      invalidModel: placementJson.value,
      validation,
      targetPieceCount,
      generationClient,
      model: resolvedPlacementModel,
      onProgress,
    });

    if (repairedPlacement.ok) {
      await emitProgress(onProgress, "validation", "complete");
      return {
        ok: true,
        stage: "complete",
        structurePlan: structureResult.value,
        model: repairedPlacement.model,
        validation: repairedPlacement.validation,
        ...(repairedPlacement.removedBricks ? { removedBricks: repairedPlacement.removedBricks } : {}),
        ...(typeof repairedPlacement.repaired === "boolean"
          ? { repaired: repairedPlacement.repaired }
          : {}),
      };
    }

    await emitProgress(onProgress, "validation", "failed");
    return failure(repairedPlacement.stage, repairedPlacement.errors, {
      structurePlan: structureResult.value,
      model: repairedPlacement.model,
      validation: repairedPlacement.validation,
      originalValidation: repairedPlacement.originalValidation,
      ...(repairedPlacement.prunedModel ? { prunedModel: repairedPlacement.prunedModel } : {}),
      ...(repairedPlacement.prunedValidation
        ? { prunedValidation: repairedPlacement.prunedValidation }
        : {}),
      ...(repairedPlacement.removedBricks
        ? { removedBricks: repairedPlacement.removedBricks }
        : {}),
    });
  }

  await emitProgress(onProgress, "validation_repair", "skipped");
  await emitProgress(onProgress, "validation", "complete");

  return {
    ok: true,
    stage: "complete",
    structurePlan: structureResult.value,
    model: placementJson.value,
    validation,
  };
}

```

## test/generation/service.test.js

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { duckInventory } from "../../src/generation/fixtures/duckInventory.js";
import { generateModel } from "../../src/generation/service.js";

const TEST_STRUCTURE_MODEL = "env-structure-model";
const TEST_PLACEMENT_MODEL = "env-placement-model";

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

function fakeClient(contents) {
  const calls = [];

  return {
    calls,
    async complete(request) {
      calls.push(request);
      return contents.shift();
    },
  };
}

function generateTestModel(options) {
  return generateModel({
    structureModel: TEST_STRUCTURE_MODEL,
    placementModel: TEST_PLACEMENT_MODEL,
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
    assert.equal(client.calls[1].model, TEST_STRUCTURE_MODEL);
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
    assert.equal(client.calls[2].model, TEST_PLACEMENT_MODEL);
    assert.match(requestText(client.calls[2]), /repair malformed JSON/i);
  });

  it("returns validator errors for unsupported generated placements", async () => {
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
    const client = fakeClient([JSON.stringify(structurePlan), JSON.stringify(invalidModel)]);

    const result = await generateTestModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "validation");
    assert.equal(result.validation.errors.some((error) => error.type === "unsupported_part"), true);
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
    assert.equal(client.calls[2].model, TEST_PLACEMENT_MODEL);
    assert.match(requestText(client.calls[2]), /repair a LEGO GeneratedModel/i);
    assert.match(requestText(client.calls[2]), /floating_brick/);
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

```

## src/generation/generationPrompts.js relevant repair section

```js
  targetPieceCount,
  model,
}) {
  const cappedTarget = clampTargetPieceCount(targetPieceCount ?? structurePlan.target_piece_count);
  const inventorySummary = summarizeSupportedInventory(inventory);

  return buildGeminiJsonRequest({
    model,
    systemText: [
      "You are a LEGO placement planner for a local LEGO generation app.",
      "Convert a high-level LEGO structure plan into exact internal GeneratedModel JSON.",
      "Return exactly one JSON object matching generationConfig.responseSchema.",
      "No markdown, no commentary, and no text before or after the JSON object.",
      "Do not output raw LDraw.",
      "Do not output meshes, vertices, or arbitrary 3D geometry.",
      "Use only parts and colors present in the inventory.",
      "Do not exceed inventory quantities.",
      `Do not exceed ${MAX_MODEL_PIECES} pieces or the requested target count.`,
      "piece_count must be a non-negative integer.",
      "step must be a positive integer.",
      "Use x and y as stud-grid positions.",
      "Use z as layer height; plates are 1 layer tall and bricks are 3 layers tall.",
      "Every brick must use numeric rotation 0, 90, 180, or 270, never a string.",
      "Avoid overlapping bricks, floating bricks, disconnected components, and models without ground contact.",
    ].join("\n"),
    userPayload: {
      user_prompt: userPrompt,
      target_piece_count: cappedTarget,
      inventory: inventorySummary,
      structure_plan: structurePlan,
    },
    responseSchema: GENERATED_MODEL_SCHEMA,
  });
}

export function buildJsonRepairPrompt({
  label,
  malformedText,
  errorMessage,
  model,
  responseSchema = STRUCTURE_PLAN_SCHEMA,
}) {
  return buildGeminiJsonRequest({
    model,
    systemText: [
      "You repair malformed JSON for a local LEGO generation app.",
      "Return exactly one valid JSON object matching generationConfig.responseSchema.",
      "No markdown, no commentary, and no text before or after the JSON object.",
      "Preserve the intended fields and values from the malformed input.",
      "Fix syntax errors, remove stray prose, and do not invent extra wrapper keys.",
    ].join("\n"),
    userPayload: {
      label,
      parse_error: errorMessage,
      malformed_json_text: malformedText,
    },
    responseSchema,
  });
}

export function buildPlacementValidationRepairPrompt({
  userPrompt,
  inventory,
  structurePlan,
  invalidModel,
  originalFailedModel,
  prunedModel,
  removedBricks = [],
  validationErrors,
  targetPieceCount,
  model,
}) {
  const cappedTarget = clampTargetPieceCount(targetPieceCount ?? structurePlan.target_piece_count);
  const inventorySummary = summarizeSupportedInventory(inventory);

  return buildGeminiJsonRequest({
    model,
    systemText: [
      "You repair a LEGO GeneratedModel that failed deterministic buildability validation.",
      "Return exactly one full valid GeneratedModel JSON object matching generationConfig.responseSchema.",
      "No markdown, no commentary, and no text before or after the JSON object.",
      "Preserve the requested object and recognizable features, but prioritize passing validation.",
      "Use only parts and colors present in the inventory. Do not exceed inventory quantities.",
      `Do not exceed ${MAX_MODEL_PIECES} pieces or the requested target count.`,
      "Ground rule: at least one brick must have position.z === 0.",
      "Support rule: every brick with position.z > 0 must have at least one occupied stud cell directly below it at z - 1 from a different brick.",
      "Connection rule: all bricks must form one connected component through vertical stud overlap.",
      "Overlap rule: no two bricks may occupy the same x, y, z grid cell.",
      "Layer rule: plates are 1 layer tall and bricks are 3 layers tall.",
      "If needed, simplify the model by moving pieces down to z 0 or stacking pieces directly on supported studs.",
    ].join("\n"),
    userPayload: {
      user_prompt: userPrompt,
      target_piece_count: cappedTarget,
      inventory: inventorySummary,
      structure_plan: structurePlan,
      validation_errors: validationErrors,
      invalid_generated_model: invalidModel,
      original_failed_generated_model: originalFailedModel,
      pruned_generated_model: prunedModel,
      removed_bricks: removedBricks,
    },
    responseSchema: GENERATED_MODEL_SCHEMA,
  });
}

export function buildPlacementInventoryRepairPrompt({
  userPrompt,
  inventory,
  structurePlan,
  invalidModel,
  validationErrors,
  targetPieceCount,
  model,
}) {
  const cappedTarget = clampTargetPieceCount(targetPieceCount ?? structurePlan.target_piece_count);
  const inventorySummary = summarizeSupportedInventory(inventory);

  return buildGeminiJsonRequest({
    model,
    systemText: [
      "You repair LEGO inventory validation errors in a GeneratedModel.",
      "Return exactly one full valid GeneratedModel JSON object matching generationConfig.responseSchema.",
      "No markdown, no commentary, and no text before or after the JSON object.",
      "Fix only invalid part/color choices and inventory overuse.",
      "Use only parts and colors present in the inventory. Do not exceed inventory quantities.",
      "Do not use part/color combinations that are absent from the inventory, even if the part id exists in another color.",
      `Do not exceed ${MAX_MODEL_PIECES} pieces or the requested target count.`,
      "Preserve the requested object and recognizable features.",
      "Preserve brick positions, rotations, features, and steps where possible.",
      "If a missing part/color has no direct substitute, replace it with the closest available supported inventory item.",
    ].join("\n"),
    userPayload: {
      user_prompt: userPrompt,
      target_piece_count: cappedTarget,
      inventory: inventorySummary,
      structure_plan: structurePlan,
      validation_errors: validationErrors,
      invalid_generated_model: invalidModel,
    },
    responseSchema: GENERATED_MODEL_SCHEMA,

```
