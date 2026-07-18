# Whole-change no-git review package

## Requirements
See:
- docs/superpowers/specs/2026-07-16-deterministic-inventory-cleanup-repair-design.md
- docs/superpowers/plans/2026-07-16-deterministic-inventory-cleanup-repair.md

## Files changed
- src/generation/inventoryCleanup.js
- test/generation/inventoryCleanup.test.js
- src/generation/service.js
- src/generation/generationPrompts.js
- test/generation/service.test.js
- test/generation/generationPrompts.test.js
- server/generationServer.js
- src/preview/main.js
- test/server/generationServerEvents.test.js

## src/generation/inventoryCleanup.js

```js
import { SUPPORTED_PARTS } from "./partCatalog.js";

function keyFor(partId, colorId) {
  return `${partId}:${colorId}`;
}

function buildAvailableInventory(inventory) {
  const available = new Map();

  for (const item of inventory.items) {
    if (!item.supported || !SUPPORTED_PARTS[item.part_id]) {
      continue;
    }

    const key = keyFor(item.part_id, item.color_id);
    available.set(key, (available.get(key) ?? 0) + item.count);
  }

  return available;
}

function removedBrickFor(brick, reason, message) {
  return {
    id: brick.id,
    feature: brick.feature,
    part_id: brick.part_id,
    color_id: brick.color_id,
    reason,
    message,
  };
}

export function cleanupIllegalInventoryUsage(model, inventory) {
  const available = buildAvailableInventory(inventory);
  const keptCounts = new Map();
  const keptBricks = [];
  const removedBricks = [];

  for (const brick of model.bricks) {
    if (!SUPPORTED_PARTS[brick.part_id]) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "unsupported_part",
          `${brick.id} uses unsupported part ${brick.part_id}.`,
        ),
      );
      continue;
    }

    const inventoryKey = keyFor(brick.part_id, brick.color_id);
    const availableCount = available.get(inventoryKey) ?? 0;

    if (availableCount === 0) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "inventory_missing",
          `${brick.id} uses part ${brick.part_id} color ${brick.color_id}, which is not in the confirmed supported inventory.`,
        ),
      );
      continue;
    }

    const keptCount = keptCounts.get(inventoryKey) ?? 0;

    if (keptCount >= availableCount) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "inventory_exceeded",
          `${brick.id} exceeds available inventory for part ${brick.part_id} color ${brick.color_id}.`,
        ),
      );
      continue;
    }

    keptCounts.set(inventoryKey, keptCount + 1);
    keptBricks.push(brick);
  }

  return {
    model: {
      ...model,
      piece_count: keptBricks.length,
      bricks: keptBricks,
    },
    removedBricks,
  };
}

```

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

## src/generation/generationPrompts.js relevant sections

```js
import { MAX_MODEL_PIECES, SUPPORTED_PARTS } from "./partCatalog.js";

const GENERATION_MAX_TOKENS = 10000;
const JSON_GENERATION_CONFIG = {
  maxOutputTokens: GENERATION_MAX_TOKENS,
  responseMimeType: "application/json",
};

export const STRUCTURE_PLAN_SCHEMA = {
  type: "object",
  properties: {
    model_name: { type: "string" },
    primary_object: { type: "string" },
    target_piece_count: { type: "integer" },
    overall_shape: { type: "string" },
    required_features: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          visual_goal: { type: "string" },
          priority: { type: "string", enum: ["required", "optional"] },
          preferred_colors: { type: "array", items: { type: "string" } },
          approximate_piece_budget: { type: "integer" },
        },
        required: [
          "name",
          "visual_goal",
          "priority",
          "preferred_colors",
          "approximate_piece_budget",
        ],
      },
    },
    part_usage_plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          feature: { type: "string" },
          allowed_part_ids: { type: "array", items: { type: "string" } },
          allowed_color_ids: { type: "array", items: { type: "string" } },
          max_pieces: { type: "integer" },
          notes: { type: "string" },
        },
        required: [
          "feature",
          "allowed_part_ids",
          "allowed_color_ids",
          "max_pieces",
          "notes",
        ],
      },
    },
    build_strategy: {
      type: "object",
      properties: {
        base: { type: "string" },
        body: { type: "string" },
        raised_details: { type: "string" },
        stability_notes: { type: "string" },
      },
      required: ["base", "body", "raised_details", "stability_notes"],
    },
    fallback_priorities: { type: "array", items: { type: "string" } },
    user_facing_summary: { type: "string" },
  },
  required: [
    "model_name",
    "primary_object",
    "target_piece_count",
    "overall_shape",
    "required_features",
    "part_usage_plan",
    "build_strategy",
    "fallback_priorities",
    "user_facing_summary",
  ],
};

export const GENERATED_MODEL_SCHEMA = {
  type: "object",
  properties: {
    model_name: { type: "string" },
    prompt: { type: "string" },
    piece_count: { type: "integer" },
    dimensions: {
      type: "object",
      properties: {
        width_studs: { type: "number" },
        depth_studs: { type: "number" },
        height_layers: { type: "number" },
      },
      required: ["width_studs", "depth_studs", "height_layers"],
    },
    created_from_inventory_id: { type: "string" },
    generator_version: { type: "string" },
    bricks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          part_id: { type: "string" },
          ldraw_id: { type: "string" },
          label: { type: "string" },
          color_id: { type: "string" },
          color_name: { type: "string" },
          position: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
            required: ["x", "y", "z"],
          },
          rotation: { type: "integer" },
          feature: { type: "string" },
          step: { type: "integer" },
        },
        required: [
          "id",
          "part_id",
          "ldraw_id",
          "label",
          "color_id",
          "color_name",
          "position",
          "rotation",
          "feature",
          "step",
        ],
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "model_name",
    "prompt",
    "piece_count",
    "dimensions",
    "created_from_inventory_id",
    "generator_version",
    "bricks",
    "notes",
  ],
};

function clampTargetPieceCount(targetPieceCount) {
  if (!Number.isFinite(targetPieceCount)) {
    return Math.min(40, MAX_MODEL_PIECES);
  }

  return Math.max(1, Math.min(Math.floor(targetPieceCount), MAX_MODEL_PIECES));
}

export function summarizeSupportedInventory(inventory) {
  return {
    inventory_id: inventory.inventory_id,
    source: inventory.source,
    items: inventory.items
      .filter((item) => item.supported && SUPPORTED_PARTS[item.part_id])
      .map((item) => ({
        part_id: item.part_id,
        ldraw_id: item.ldraw_id,
        color_name: item.color_name,
        color_id: item.color_id,
        count: item.count,
        dimensions: {
          width: SUPPORTED_PARTS[item.part_id].width,
          depth: SUPPORTED_PARTS[item.part_id].depth,
          height_layers: SUPPORTED_PARTS[item.part_id].category === "plate" ? 1 : 3,
        },
      })),
  };
}

function textPart(text) {
  return { text };
}

function buildGeminiJsonRequest({ model, systemText, userPayload, responseSchema }) {
  return {
    model,
    systemInstruction: {
      parts: [textPart(systemText)],
    },
    contents: [
      {
        role: "user",
        parts: [textPart(JSON.stringify(userPayload, null, 2))],
      },
    ],
    generationConfig: {
      ...JSON_GENERATION_CONFIG,
      ...(responseSchema ? { responseSchema } : {}),
    },
  };
}

export function buildStructurePrompt({
  userPrompt,
  inventory,
  targetPieceCount,
  model,
}) {
  const cappedTarget = clampTargetPieceCount(targetPieceCount);
  const inventorySummary = summarizeSupportedInventory(inventory);

  return buildGeminiJsonRequest({
    model,
    systemText: [
      "You are a LEGO model planning agent for a local LEGO generation app.",
      "Your job is to convert a user's request and confirmed LEGO inventory into a high-level build plan.",
      "Return exactly one JSON object matching generationConfig.responseSchema.",
      "No markdown, no commentary, and no text before or after the JSON object.",
      "Do not output exact brick coordinates.",
      "Do not output LDraw.",
      "Do not output meshes, vertices, or arbitrary 3D geometry.",
      "Do not invent parts, colors, or quantities outside the provided inventory.",
      "The generated model must be one small free-standing connected LEGO object, not a scene.",
      `Prefer 10-40 pieces and never exceed the requested target count or the ${MAX_MODEL_PIECES}-piece MVP cap.`,
      "Prioritize recognizable silhouette, required object features, inventory availability, stable construction, and color match in that order.",
    ].join("\n"),
    userPayload: {
      user_prompt: userPrompt,
      target_piece_count: cappedTarget,
      inventory: inventorySummary,
    },
    responseSchema: STRUCTURE_PLAN_SCHEMA,
  });
}

export function buildPlacementPrompt({
  userPrompt,
  inventory,
  structurePlan,
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
      "The pruned model is the starting point.",
      "Do not rebuild from scratch.",
      "Preserve the requested object, major features, and recognizable silhouette.",
      "Prefer the smallest set of changes that can pass validation.",
      "You may modify any remaining brick if needed.",
      "You may add legal supported inventory pieces if available.",
      "Do not re-add removed illegal bricks.",
      "Use only supported parts and part/color combinations present in inventory.",
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
      original_failed_generated_model: originalFailedModel ?? invalidModel,
      pruned_generated_model: prunedModel ?? invalidModel,
      removed_bricks: removedBricks,
      invalid_generated_model: invalidModel,
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

```

## server/generationServer.js

```js
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { corsHeadersForOrigin } from "./cors.js";
import { createGeminiClient } from "../src/generation/geminiClient.js";
import { resolveGenerationModels } from "../src/generation/modelConfig.js";
import { generateModel } from "../src/generation/service.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.GENERATION_PORT ?? 8787);

export function formatSseEvent(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function sendJson(request, response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...corsHeadersForOrigin(request.headers.origin),
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateRequestBody(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Request body must be a JSON object."];
  }

  if (typeof body.userPrompt !== "string" || body.userPrompt.trim() === "") {
    errors.push("userPrompt must be a non-empty string.");
  }

  if (!body.inventory || !Array.isArray(body.inventory.items)) {
    errors.push("inventory.items must be an array.");
  }

  return errors;
}

function sendSseHeaders(request, response) {
  response.writeHead(200, {
    ...corsHeadersForOrigin(request.headers.origin),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}

function createFailureResult(stage, errors) {
  return {
    ok: false,
    stage,
    errors,
  };
}

async function createGenerationResult(body, onProgress) {
  const generationClient = createGeminiClient({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const models = resolveGenerationModels(process.env);

  return generateModel({
    userPrompt: body.userPrompt.trim(),
    inventory: body.inventory,
    targetPieceCount: body.targetPieceCount,
    generationClient,
    structureModel: models.structureModel,
    placementModel: models.placementModel,
    onProgress,
  });
}

async function handleGenerateJson(request, response) {
  if (!process.env.GEMINI_API_KEY) {
    sendJson(
      request,
      response,
      500,
      createFailureResult("configuration", ["GEMINI_API_KEY is required."]),
    );
    return;
  }

  const body = await readJson(request);
  const requestErrors = validateRequestBody(body);

  if (requestErrors.length > 0) {
    sendJson(request, response, 400, createFailureResult("request", requestErrors));
    return;
  }

  const result = await createGenerationResult(body);

  sendJson(request, response, result.ok ? 200 : 422, result);
}

async function handleGenerateStream(request, response) {
  let body;

  try {
    body = await readJson(request);
  } catch (error) {
    sendSseHeaders(request, response);
    response.end(formatSseEvent("result", createFailureResult("request", [error.message])));
    return;
  }

  sendSseHeaders(request, response);

  if (!process.env.GEMINI_API_KEY) {
    response.end(
      formatSseEvent(
        "result",
        createFailureResult("configuration", ["GEMINI_API_KEY is required."]),
      ),
    );
    return;
  }

  const requestErrors = validateRequestBody(body);

  if (requestErrors.length > 0) {
    response.end(formatSseEvent("result", createFailureResult("request", requestErrors)));
    return;
  }

  try {
    const result = await createGenerationResult(body, (event) => {
      if (event.type === "draft") {
        response.write(formatSseEvent("draft", event));
        return;
      }

      response.write(formatSseEvent("progress", event));
    });

    response.end(formatSseEvent("result", result));
  } catch (error) {
    response.end(formatSseEvent("result", createFailureResult("server", [error.message])));
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }

  if (request.method !== "POST") {
    sendJson(request, response, 404, { ok: false, errors: ["Not found."] });
    return;
  }

  if (request.url === "/api/generate/stream") {
    await handleGenerateStream(request, response);
    return;
  }

  try {
    if (request.url === "/api/generate") {
      await handleGenerateJson(request, response);
      return;
    }
  } catch (error) {
    sendJson(request, response, 500, {
      ok: false,
      stage: "server",
      errors: [error.message],
    });
    return;
  }

  sendJson(request, response, 404, { ok: false, errors: ["Not found."] });
});

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(PORT, HOST, () => {
    console.log(`Generation service listening at http://${HOST}:${PORT}`);
  });
}

```

## src/preview/main.js

```js
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";

import { carInventory } from "../generation/fixtures/carInventory.js";
import { daisyInventory } from "../generation/fixtures/daisyInventory.js";
import { duckInventory } from "../generation/fixtures/duckInventory.js";
import { horseInventory } from "../generation/fixtures/horseInventory.js";
import { houseFlyInventory } from "../generation/fixtures/houseFlyInventory.js";
import { sandcastleInventory } from "../generation/fixtures/sandcastleInventory.js";
import { buildSmallDuckModel } from "../generation/fixtures/smallDuckModel.js";
import { validateGeneratedModelShape } from "../generation/generatedModelSchema.js";
import { validateModel } from "../generation/validator.js";
import { exportModelToLDraw } from "../ldraw/exportLDraw.js";

const canvas = document.querySelector("#preview-canvas");
const modelName = document.querySelector("#model-name");
const pieceCount = document.querySelector("#piece-count");
const validationStatus = document.querySelector("#validation-status");
const form = document.querySelector("#generation-form");
const promptInput = document.querySelector("#prompt-input");
const inventorySelect = document.querySelector("#inventory-select");
const targetPiecesInput = document.querySelector("#target-pieces");
const generateButton = document.querySelector("#generate-button");
const notesList = document.querySelector("#generation-notes");
const validationErrors = document.querySelector("#validation-errors");
const timelineList = document.querySelector("#generation-timeline");

const timelineStages = [
  { id: "structure_generate", label: "Structure generation" },
  { id: "structure_parse", label: "Structure JSON parse" },
  { id: "structure_repair", label: "Structure JSON repair" },
  { id: "placement_generate", label: "Placement generation" },
  { id: "placement_parse", label: "Placement JSON parse" },
  { id: "placement_repair", label: "Placement JSON repair" },
  { id: "validation", label: "Validation" },
  { id: "validation_repair", label: "Validation repair" },
];

const timelineStatusLabels = {
  pending: "Pending",
  running: "Running",
  complete: "Complete",
  skipped: "Skipped",
  failed: "Failed",
};

const resultStageTimelineMap = {
  structure_parse: "structure_repair",
  placement_parse: "placement_repair",
  placement_shape: "validation",
  validation: "validation",
  validation_repair_parse: "validation_repair",
  validation_repair_shape: "validation_repair",
};

let timelineState = timelineStages.map((stage) => ({
  ...stage,
  status: "pending",
}));

const inventories = [
  { id: "duck", label: "Duck demo pieces", inventory: duckInventory },
  { id: "car", label: "Car demo pieces", inventory: carInventory },
  { id: "daisy", label: "Daisy demo pieces", inventory: daisyInventory },
  { id: "horse", label: "Horse demo pieces", inventory: horseInventory },
  { id: "house-fly", label: "House fly demo pieces", inventory: houseFlyInventory },
  { id: "sandcastle", label: "Sandcastle demo pieces", inventory: sandcastleInventory },
];

for (const option of inventories) {
  const element = document.createElement("option");
  element.value = option.id;
  element.textContent = option.label;
  inventorySelect.append(element);
}

function selectedInventory() {
  return inventories.find((entry) => entry.id === inventorySelect.value)?.inventory ?? duckInventory;
}

function renderTimeline() {
  timelineList.replaceChildren();

  for (const stage of timelineState) {
    const item = document.createElement("li");
    item.className = "timeline-stage";
    item.dataset.status = stage.status;

    const marker = document.createElement("span");
    marker.className = "timeline-marker";
    marker.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "timeline-label";
    label.textContent = stage.label;

    const status = document.createElement("span");
    status.className = "timeline-status";
    status.textContent = timelineStatusLabels[stage.status] ?? stage.status;

    item.append(marker, label, status);
    timelineList.append(item);
  }
}

function resetTimeline() {
  timelineState = timelineStages.map((stage) => ({
    ...stage,
    status: "pending",
  }));
  renderTimeline();
}

function updateTimelineStage(stageId, status) {
  timelineState = timelineState.map((stage) =>
    stage.id === stageId ? { ...stage, status } : stage,
  );
  renderTimeline();
}

function markTimelineFailureFromResult(stage) {
  if (timelineState.some((timelineStage) => timelineStage.status === "failed")) {
    return;
  }

  const timelineStage = resultStageTimelineMap[stage];

  if (timelineStage) {
    updateTimelineStage(timelineStage, "failed");
  }
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111318);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  3000,
);
camera.position.set(180, 150, 230);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(20, -40, 35);
controls.minDistance = 90;
controls.maxDistance = 650;

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x252a32, 1.8);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(180, 260, 140);
keyLight.castShadow = true;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8fb7ff, 0.9);
fillLight.position.set(-160, 90, -120);
scene.add(fillLight);

const grid = new THREE.GridHelper(420, 21, 0x445064, 0x252b35);
grid.position.y = 8;
scene.add(grid);

let currentModelGroup = null;

function clearCurrentModel() {
  if (!currentModelGroup) {
    return;
  }

  scene.remove(currentModelGroup);
  currentModelGroup.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
  currentModelGroup = null;
}

function renderModel(model) {
  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  const ldrawText = exportModelToLDraw(model);

  loader.parse(
    ldrawText,
    (group) => {
      clearCurrentModel();
      group.rotation.x = Math.PI;
      group.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      group.position.sub(center);

      scene.add(group);
      currentModelGroup = group;
      controls.target.set(0, 0, 0);

      const maxDimension = Math.max(size.x, size.y, size.z);
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = (maxDimension / (2 * Math.tan(fov / 2))) * 1.45;
      const viewDirection = new THREE.Vector3(1.1, 0.75, 1.35).normalize();

      camera.position.copy(viewDirection.multiplyScalar(distance));
      camera.near = Math.max(0.1, distance / 100);
      camera.far = distance * 10;
      camera.updateProjectionMatrix();
      controls.minDistance = distance * 0.35;
      controls.maxDistance = distance * 2.2;
      controls.update();
    },
    (error) => {
      validationStatus.textContent = "Load error";
      validationErrors.hidden = false;
      validationErrors.textContent = error.message;
    },
  );
}

function setNotes(notes) {
  notesList.replaceChildren();

  for (const note of notes ?? []) {
    const item = document.createElement("li");
    item.textContent = note;
    notesList.append(item);
  }
}

function showErrors(errors) {
  validationErrors.hidden = false;
  validationErrors.textContent = JSON.stringify(errors, null, 2);
}

function hideErrors() {
  validationErrors.hidden = true;
  validationErrors.textContent = "";
}

function showModel(model, validation, options = {}) {
  modelName.textContent = model.model_name;
  pieceCount.textContent = String(model.piece_count);
  validationStatus.textContent =
    options.statusText ?? (validation.valid ? "Valid" : "Invalid");
  setNotes(model.notes);

  if (validation.valid || options.hideErrors) {
    hideErrors();
  } else {
    showErrors(validation.errors);
  }

  renderModel(model);
}

async function requestGeneration() {
  const response = await fetch("http://127.0.0.1:8787/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPrompt: promptInput.value,
      inventory: selectedInventory(),
      targetPieceCount: Number(targetPiecesInput.value),
    }),
  });

  const result = await readGenerationStream(response);

  if (!response.ok || !result.ok) {
    throw result;
  }

  return result;
}

function parseSseBlock(block) {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    eventName,
    payload: JSON.parse(dataLines.join("\n")),
  };
}

function handleSseBlock(block) {
  if (block.trim() === "") {
    return undefined;
  }

  const event = parseSseBlock(block);

  if (!event) {
    return undefined;
  }

  if (event.eventName === "progress") {
    updateTimelineStage(event.payload.stage, event.payload.status);
    return undefined;
  }

  if (event.eventName === "draft") {
    handleDraftEvent(event.payload);
    return undefined;
  }

  if (event.eventName === "result") {
    return event.payload;
  }

  return undefined;
}

function handleDraftEvent(payload) {
  const shapeResult = validateGeneratedModelShape(payload.model);

  if (!shapeResult.ok) {
    validationStatus.textContent = "Draft shape error";
    showErrors(shapeResult.errors);
    return;
  }

  const validation = payload.validation ?? {
    valid: false,
    errors: [],
    warnings: [],
    inventory_usage: [],
  };

  try {
    showModel(payload.model, validation, {
      statusText: payload.stage === "pruned_draft" ? "Repairing pruned draft" : "Repairing draft",
      hideErrors: payload.stage === "placement_draft",
    });
  } catch (error) {
    validationStatus.textContent = "Draft render error";
    showErrors([error?.message ?? "Unknown draft render error"]);
  }
}

async function readGenerationStream(response) {
  if (!response.body) {
    throw new Error("Generation response did not include a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;

  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      result = handleSseBlock(block) ?? result;
    }

    if (done) {
      break;
    }
  }

  result = handleSseBlock(buffer) ?? result;

  if (!result) {
    throw new Error("Generation stream ended without a result event.");
  }

  return result;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener("resize", resize);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  generateButton.disabled = true;
  validationStatus.textContent = "Generating";
  modelName.textContent = "Calling Gemini";
  pieceCount.textContent = "-";
  setNotes([]);
  hideErrors();
  resetTimeline();

  try {
    const result = await requestGeneration();
    showModel(result.model, result.validation);
  } catch (error) {
    validationStatus.textContent = "Failed";
    if (!currentModelGroup) {
      modelName.textContent = "Generation failed";
      pieceCount.textContent = "-";
      setNotes([]);
    }
    markTimelineFailureFromResult(error.stage);
    showErrors(error.errors ?? [error.message ?? "Unknown generation error"]);
  } finally {
    generateButton.disabled = false;
  }
});

const initialModel = buildSmallDuckModel(duckInventory);
const initialValidation = validateModel(initialModel, duckInventory);
renderTimeline();
showModel(initialModel, initialValidation);

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

```

## tests

### test/generation/inventoryCleanup.test.js
```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanupIllegalInventoryUsage } from "../../src/generation/inventoryCleanup.js";

const baseModel = {
  model_name: "Tiny Test",
  prompt: "build me a tiny test",
  piece_count: 1,
  dimensions: { width_studs: 4, depth_studs: 4, height_layers: 3 },
  created_from_inventory_id: "test-inventory",
  generator_version: "test",
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
  notes: ["test model"],
};

const inventory = {
  inventory_id: "test-inventory",
  source: "manual_test_fixture",
  items: [
    {
      label: "2x4 brick",
      category: "brick",
      part_id: "3001",
      ldraw_id: "3001.dat",
      color_name: "yellow",
      color_id: "14",
      count: 1,
      supported: true,
    },
    {
      label: "1x2 plate",
      category: "plate",
      part_id: "3023",
      ldraw_id: "3023.dat",
      color_name: "white",
      color_id: "15",
      count: 1,
      supported: true,
    },
  ],
};

function withBricks(bricks) {
  return {
    ...baseModel,
    piece_count: bricks.length,
    bricks,
  };
}

describe("cleanupIllegalInventoryUsage", () => {
  it("removes unsupported part ids and reports the removed feature", () => {
    const illegalBrick = {
      ...baseModel.bricks[0],
      id: "fake-eye",
      part_id: "9999",
      ldraw_id: "9999.dat",
      feature: "eye",
    };

    const result = cleanupIllegalInventoryUsage(withBricks([illegalBrick]), inventory);

    assert.deepEqual(result.model.bricks, []);
    assert.equal(result.model.piece_count, 0);
    assert.deepEqual(result.removedBricks, [
      {
        id: "fake-eye",
        feature: "eye",
        part_id: "9999",
        color_id: "14",
        reason: "unsupported_part",
        message: "fake-eye uses unsupported part 9999.",
      },
    ]);
  });

  it("removes supported part/color combinations absent from inventory", () => {
    const absentColorBrick = {
      ...baseModel.bricks[0],
      id: "red-body",
      color_id: "4",
      color_name: "red",
    };

    const result = cleanupIllegalInventoryUsage(withBricks([absentColorBrick]), inventory);

    assert.deepEqual(result.model.bricks, []);
    assert.equal(result.removedBricks[0].reason, "inventory_missing");
    assert.equal(
      result.removedBricks[0].message,
      "red-body uses part 3001 color 4, which is not in the confirmed supported inventory.",
    );
  });

  it("keeps the first allowed bricks and removes later excess bricks by model order", () => {
    const first = { ...baseModel.bricks[0], id: "body-1" };
    const second = { ...baseModel.bricks[0], id: "body-2", position: { x: 0, y: 0, z: 3 } };
    const third = { ...baseModel.bricks[0], id: "body-3", position: { x: 0, y: 0, z: 6 } };

    const result = cleanupIllegalInventoryUsage(withBricks([first, second, third]), inventory);

    assert.deepEqual(
      result.model.bricks.map((brick) => brick.id),
      ["body-1"],
    );
    assert.equal(result.model.piece_count, 1);
    assert.deepEqual(
      result.removedBricks.map((brick) => brick.id),
      ["body-2", "body-3"],
    );
    assert.deepEqual(
      result.removedBricks.map((brick) => brick.reason),
      ["inventory_exceeded", "inventory_exceeded"],
    );
  });

  it("leaves legal inventory usage unchanged", () => {
    const result = cleanupIllegalInventoryUsage(baseModel, inventory);

    assert.deepEqual(result.model, baseModel);
    assert.deepEqual(result.removedBricks, []);
  });
});

```

### test/generation/service.test.js
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


```

### test/generation/generationPrompts.test.js
```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { duckInventory } from "../../src/generation/fixtures/duckInventory.js";
import {
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

function assertGeminiJsonRequest(request) {
  assert.equal(request.generationConfig.maxOutputTokens, 10000);
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
    assert.match(text, /50-piece MVP cap/);
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
    assertGeminiJsonRequest(request);
    assert.equal(request.generationConfig.responseSchema.properties.bricks.type, "array");
    assert.equal(firstUserPayload(request).required_output_shape, undefined);
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
    assertGeminiJsonRequest(request);
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

```

### test/server/generationServerEvents.test.js
```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatSseEvent } from "../../server/generationServer.js";

describe("generation server SSE events", () => {
  it("formats named SSE events with a JSON payload", () => {
    const event = formatSseEvent("progress", {
      stage: "validation",
      status: "running",
    });

    assert.equal(
      event,
      'event: progress\ndata: {"stage":"validation","status":"running"}\n\n',
    );
  });

  it("formats draft SSE events with model payloads", () => {
    const event = formatSseEvent("draft", {
      type: "draft",
      stage: "placement_draft",
      model: { model_name: "Draft Duck" },
    });

    assert.equal(
      event,
      'event: draft\ndata: {"type":"draft","stage":"placement_draft","model":{"model_name":"Draft Duck"}}\n\n',
    );
  });
});

```
