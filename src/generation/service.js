import { parseJsonObject, parseStructurePlanText } from "./designPlan.js";
import { validateGeneratedModelShape } from "./generatedModelSchema.js";
import {
  BUILD_SUGGESTIONS_SCHEMA,
  buildJsonRepairPrompt,
  buildBuildSuggestionsPrompt,
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

const CLEANUP_RELEVANT_VALIDATION_TYPES = new Set([
  "unsupported_part",
  ...REPAIRABLE_INVENTORY_VALIDATION_TYPES,
]);

const BUILD_SUGGESTION_FIELDS = new Set([
  "label",
  "prompt_metadata",
  "inventory_reasoning",
]);

function validateBuildSuggestions(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      errors: [{ field: "suggestions", message: "Suggestion response must be an object." }],
    };
  }

  for (const field of Object.keys(payload)) {
    if (field !== "suggestions") {
      errors.push({
        field,
        message: `${field} is not a valid suggestion response field.`,
      });
    }
  }

  if (!Array.isArray(payload.suggestions)) {
    return {
      ok: false,
      errors: [{ field: "suggestions", message: "suggestions must be an array." }],
    };
  }

  if (payload.suggestions.length < 1) {
    errors.push({ field: "suggestions", message: "suggestions must contain at least 1 item." });
  }

  if (payload.suggestions.length > 5) {
    errors.push({ field: "suggestions", message: "suggestions must contain at most 5 items." });
  }

  payload.suggestions.forEach((suggestion, index) => {
    if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) {
      errors.push({ field: `suggestions[${index}]`, message: "Suggestion must be an object." });
      return;
    }

    for (const field of Object.keys(suggestion)) {
      if (!BUILD_SUGGESTION_FIELDS.has(field)) {
        errors.push({
          field: `suggestions[${index}].${field}`,
          message: `${field} is not a valid suggestion field.`,
        });
      }
    }

    for (const field of BUILD_SUGGESTION_FIELDS) {
      if (typeof suggestion[field] !== "string" || suggestion[field].trim() === "") {
        errors.push({
          field: `suggestions[${index}].${field}`,
          message: `${field} must be a non-empty string.`,
        });
      }
    }
  });

  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? payload.suggestions : undefined,
    errors,
  };
}

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
  repairMetadata,
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
  const repairedText = await generationClient.complete(
    repairRequest,
    repairMetadata ?? {
      phase: "json_repair",
      stage: repairStage,
      label: `${label} JSON repair`,
    },
  );

  const repairedResult = parse(repairedText);

  await emitProgress(onProgress, parseStage, repairedResult.ok ? "complete" : "failed");
  await emitProgress(onProgress, repairStage, repairedResult.ok ? "complete" : "failed");

  return repairedResult;
}

export async function generateBuildSuggestions({ inventory, generationClient, suggestionModel }) {
  if (typeof suggestionModel !== "string" || suggestionModel.trim() === "") {
    throw new Error(
      "suggestionModel is required. Resolve it from GEMINI_SUGGESTION_MODEL before calling generateBuildSuggestions.",
    );
  }

  const model = suggestionModel.trim();
  const suggestionRequest = buildBuildSuggestionsPrompt({ inventory, model });
  const suggestionText = await generationClient.complete(suggestionRequest, {
    phase: "suggestion",
    stage: "suggestion_generate",
    label: "Build suggestion generation",
  });
  const parsed = await parseWithOneRepair({
    text: suggestionText,
    label: "build suggestions",
    parse: (text) => parseJsonObject(text, "build suggestions"),
    generationClient,
    model,
    responseSchema: BUILD_SUGGESTIONS_SCHEMA,
    parseStage: "suggestion_parse",
    repairStage: "suggestion_repair",
    repairMetadata: {
      phase: "suggestion",
      stage: "suggestion_repair",
      label: "Build suggestion JSON repair",
    },
  });

  if (!parsed.ok) {
    return failure("suggestion_parse", parsed.errors);
  }

  const validation = validateBuildSuggestions(parsed.value);

  if (!validation.ok) {
    return failure("suggestion_validation", validation.errors);
  }

  return { ok: true, suggestions: validation.value };
}

function hasRepairableValidationError(validation) {
  return (
    validation.errors.length > 0 &&
    validation.errors.every((error) => REPAIRABLE_VALIDATION_TYPES.has(error.type))
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
  const repairedText = await generationClient.complete(repairRequest, {
    phase: "validation_repair",
    stage: "validation_repair",
    label: "Placement validation repair",
  });
  let repairedJson = parseJsonObject(repairedText, "placement validation repair model");

  if (!repairedJson.ok) {
    const syntaxRepairRequest = buildJsonRepairPrompt({
      label: "placement validation repair model",
      malformedText: repairedText,
      errorMessage:
        repairedJson.errors[0]?.message ??
        "Invalid placement validation repair model JSON.",
      model,
      responseSchema: GENERATED_MODEL_SCHEMA,
    });
    const syntaxRepairedText = await generationClient.complete(syntaxRepairRequest, {
      phase: "validation_repair",
      stage: "validation_repair_parse",
      label: "Placement validation repair JSON repair",
    });
    repairedJson = parseJsonObject(
      syntaxRepairedText,
      "placement validation repair model",
    );
  }

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
  let currentModel = invalidModel;
  let currentValidation = validation;
  let removedBricks = [];
  let prunedModel = currentModel;
  let prunedValidation = currentValidation;
  const shouldClean = hasValidationErrorType(
    currentValidation,
    CLEANUP_RELEVANT_VALIDATION_TYPES,
  );

  if (shouldClean) {
    await emitProgress(onProgress, "validation_repair", "running");
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

  const shouldAttemptRepair =
    hasRepairableValidationError(currentValidation) ||
    (removedBricks.length > 0 && currentValidation.valid);

  if (!shouldAttemptRepair) {
    await emitProgress(onProgress, "validation_repair", shouldClean ? "failed" : "skipped");
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

  if (!shouldClean) {
    await emitProgress(onProgress, "validation_repair", "running");
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
  repairModel,
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
  const resolvedRepairModel =
    typeof repairModel === "string" && repairModel.trim() !== ""
      ? repairModel.trim()
      : resolvedPlacementModel;

  const structureRequest = buildStructurePrompt({
    userPrompt,
    inventory,
    targetPieceCount,
    model: resolvedStructureModel,
  });

  await emitProgress(onProgress, "structure_generate", "running");
  const structureText = await generationClient.complete(structureRequest, {
    phase: "planning",
    stage: "structure_generate",
    label: "Structure planning",
  });
  await emitProgress(onProgress, "structure_generate", "complete");
  const structureResult = await parseWithOneRepair({
    text: structureText,
    label: "structure plan",
    parse: parseStructurePlanText,
    generationClient,
    model: resolvedRepairModel,
    responseSchema: STRUCTURE_PLAN_SCHEMA,
    onProgress,
    parseStage: "structure_parse",
    repairStage: "structure_repair",
    repairMetadata: {
      phase: "planning",
      stage: "structure_repair",
      label: "Structure JSON repair",
    },
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
  const placementText = await generationClient.complete(placementRequest, {
    phase: "placing",
    stage: "placement_generate",
    label: "Placement generation",
  });
  await emitProgress(onProgress, "placement_generate", "complete");
  const placementJson = await parseWithOneRepair({
    text: placementText,
    label: "placement model",
    parse: (text) => parseJsonObject(text, "placement model"),
    generationClient,
    model: resolvedRepairModel,
    responseSchema: GENERATED_MODEL_SCHEMA,
    onProgress,
    parseStage: "placement_parse",
    repairStage: "placement_repair",
    repairMetadata: {
      phase: "placing",
      stage: "placement_repair",
      label: "Placement JSON repair",
    },
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
      model: resolvedRepairModel,
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
