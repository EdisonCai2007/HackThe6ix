import {
  parseJsonObject,
  validateStructurePlan,
} from "./designPlan.js";
import { validateGeneratedModelShape } from "./generatedModelSchema.js";
import {
  BUILD_SUGGESTIONS_SCHEMA,
  GENERATED_MODEL_SCHEMA,
  PLACEMENT_GENERATION_MAX_TOKENS,
  buildBuildSuggestionsPrompt,
  buildJsonRepairPrompt,
  buildPlacementPrompt,
  buildRefinementPrompt,
  buildStructurePrompt,
} from "./generationPrompts.js";
import { cleanupIllegalInventoryUsage } from "./inventoryCleanup.js";
import { cleanupObviousInvalidGeometry } from "./deterministicRepair.js";
import { applyModelPatch, ModelPatchError } from "./modelPatch.js";
import { buildCompactRepairContext } from "./repairContext.js";
import {
  PATCH_REPAIR_RETRY_MAX_TOKENS,
  buildPlacementPatchRepairPrompt,
} from "./repairPatchPrompts.js";
import { validateModel } from "./validator.js";
import { createStreamingBrickExtractor } from "./streamingBrickExtractor.js";

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
  placement_generate: "Placement generation",
  placement_parse: "Placement JSON parse",
  validation: "Deterministic cleanup and validation",
  refinement: "Isometric refinement",
};

const BUILD_SUGGESTION_FIELDS = new Set([
  "label",
  "prompt_metadata",
  "inventory_reasoning",
]);

const PATCH_REPAIR_RETRY_LIMITS = {
  maxNearbyOrSupportingBricks: 8,
  maxValidationSummaryBrickIds: 8,
  maxValidationMessageLength: 120,
};

const BRICK_UPDATE_FIELDS = new Set([
  "part_id",
  "ldraw_id",
  "label",
  "color_id",
  "color_name",
  "position",
  "rotation",
  "feature",
  "step",
]);

const ADD_BRICK_FIELDS = new Set([
  "id",
  ...BRICK_UPDATE_FIELDS,
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

function compactObject(entries) {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  );
}

function serviceErrors(errors = []) {
  return errors.map((error) => {
    if (!error || typeof error !== "object") {
      return { message: String(error) };
    }

    return compactObject({
      type: error.type,
      field: error.field,
      severity: error.severity,
      message: error.message,
    });
  });
}

function logServiceEvent(generationClient, event) {
  if (typeof generationClient?.logServiceEvent !== "function") {
    return;
  }

  generationClient.logServiceEvent({
    source: "generation_service",
    ...event,
  });
}

function logJsonParseFailure(generationClient, {
  phase,
  stage,
  label,
  text,
  errors,
  parseAttempt = 1,
}) {
  logServiceEvent(generationClient, {
    type: "json_parse_failure",
    phase,
    stage,
    label,
    parseAttempt,
    textLength: typeof text === "string" ? text.length : undefined,
    errors: serviceErrors(errors),
  });
}

function logLocalDeterministicRepair(generationClient, {
  phase,
  stage,
  removedBricks,
  validation,
}) {
  if (!Array.isArray(removedBricks) || removedBricks.length === 0) {
    return;
  }

  logServiceEvent(generationClient, {
    type: "local_deterministic_repair",
    repairKind: "local_deterministic_repair",
    phase,
    stage,
    removedBrickCount: removedBricks.length,
    removedBrickIds: removedBricks.map((brick) => brick.id),
    removedReasons: Array.from(new Set(removedBricks.map((brick) => brick.reason))),
    validationValidAfter: validation?.valid,
  });
}

function logFullModelFallback(generationClient, {
  phase = "refinement",
  stage = "refinement",
  outcome,
  reason,
  errors,
  cleanedInitialValid,
}) {
  logServiceEvent(generationClient, {
    type: "full_model_fallback",
    repairKind: "full_model_fallback",
    phase,
    stage,
    outcome,
    reason,
    cleanedInitialValid,
    errors: errors ? serviceErrors(errors) : undefined,
  });
}

function operationFieldSubset(operation, allowedFields) {
  return compactObject(
    Object.fromEntries(
      [...allowedFields]
        .filter((field) => operation[field] !== undefined)
        .map((field) => [field, operation[field]]),
    ),
  );
}

function normalizePatchOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    return operation;
  }

  const type = operation.type ?? operation.op;
  const normalized = {
    ...operation,
    ...(type !== undefined ? { type } : {}),
  };
  delete normalized.op;

  if (type === "add" && !normalized.brick) {
    normalized.brick = operationFieldSubset(operation, ADD_BRICK_FIELDS);
    for (const field of ADD_BRICK_FIELDS) {
      delete normalized[field];
    }
  }

  if (type === "update" && !normalized.updates) {
    normalized.updates = operationFieldSubset(operation, BRICK_UPDATE_FIELDS);
    for (const field of BRICK_UPDATE_FIELDS) {
      delete normalized[field];
    }
  }

  return normalized;
}

function normalizeModelPatch(patch) {
  if (!patch || typeof patch !== "object" || !Array.isArray(patch.operations)) {
    return patch;
  }

  return {
    ...patch,
    operations: patch.operations.map(normalizePatchOperation),
  };
}

function patchFailureSummary(failureResult) {
  return compactObject({
    stage: failureResult.stage,
    reason: failureResult.reason,
    validationValid: failureResult.validation?.valid,
    errors: serviceErrors(failureResult.errors),
  });
}

function logPatchFailure(generationClient, {
  type = "ai_patch_repair_failed",
  phase = "repair",
  stage,
  repairKind,
  repairAttempt,
  reason,
  errors,
  validation,
}) {
  logServiceEvent(generationClient, {
    type,
    repairKind,
    phase,
    stage,
    repairAttempt,
    reason,
    validationValidAfter: validation?.valid,
    errors: errors ? serviceErrors(errors) : undefined,
  });
}

async function streamTextAndBricks({ generationClient, request, phase, onProgress, seenIds }) {
  const extractor = createStreamingBrickExtractor();
  let text = "";
  let sequence = 0;
  const emittedIds = seenIds ?? new Set();
  const stream = generationClient.streamWithMetadata(request, {
    phase,
    stage: `${phase}_generate`,
    label: phase === "placement" ? "Placement generation" : "Refinement",
  });
  for await (const item of stream) {
    const chunk = typeof item === "string" ? item : item?.text ?? "";
    text += chunk;
    for (const brick of extractor.push(chunk)) {
      sequence += 1;
      const replaced = emittedIds.has(brick.id);
      emittedIds.add(brick.id);
      await onProgress?.({
        type: "brick",
        phase,
        brick,
        sequence,
        replaced,
      });
    }
  }
  const finalState = extractor.finish();
  for (const error of finalState.errors) {
    await onProgress?.({ type: "warning", phase, warning: error.message });
  }
  return { text, trailingFragment: finalState.trailingFragment };
}

async function parseSuggestionWithOneRepair({
  text,
  generationClient,
  model,
}) {
  const initialResult = parseJsonObject(text, "build suggestions");

  if (initialResult.ok) {
    return initialResult;
  }

  logJsonParseFailure(generationClient, {
    phase: "suggestion",
    stage: "suggestion_parse",
    label: "Build suggestion JSON parse",
    text,
    errors: initialResult.errors,
  });

  const repairRequest = buildJsonRepairPrompt({
    label: "build suggestions",
    malformedText: text,
    errorMessage: initialResult.errors[0]?.message ?? "Invalid build suggestions JSON.",
    model,
    responseSchema: BUILD_SUGGESTIONS_SCHEMA,
  });
  const repairedText = await generationClient.complete(repairRequest, {
    phase: "suggestion",
    stage: "suggestion_repair",
    label: "Build suggestion JSON repair",
    repairKind: "ai_json_repair",
    repairAttempt: 1,
    retryOf: "suggestion_generate",
  });

  const repairedResult = parseJsonObject(repairedText, "build suggestions");

  if (!repairedResult.ok) {
    logJsonParseFailure(generationClient, {
      phase: "suggestion",
      stage: "suggestion_repair_parse",
      label: "Build suggestion repaired JSON parse",
      text: repairedText,
      errors: repairedResult.errors,
      parseAttempt: 2,
    });
  }

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
  const parsed = await parseSuggestionWithOneRepair({
    text: suggestionText,
    generationClient,
    model,
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

function initialPlacementContext({
  userPrompt,
  targetPieceCount,
  structurePlan,
  originalModel,
  inventory,
}) {
  const inventoryCleanup = cleanupIllegalInventoryUsage(originalModel, inventory);
  const geometryCleanup = cleanupObviousInvalidGeometry(
    inventoryCleanup.model,
    inventory,
  );
  const removedBricks = [
    ...inventoryCleanup.removedBricks,
    ...geometryCleanup.removedBricks,
  ];

  return {
    userPrompt,
    targetPieceCount,
    structurePlan,
    originalModel,
    inventory,
    cleanedModel: geometryCleanup.model,
    removedBricks,
    validation: geometryCleanup.validationAfter,
    deterministicCleanup: {
      inventoryRemovedBricks: inventoryCleanup.removedBricks,
      geometryRemovedBricks: geometryCleanup.removedBricks,
      geometryReasonMetadata: geometryCleanup.reasonMetadata,
      validationBeforeGeometry: geometryCleanup.validationBefore,
    },
  };
}

function successFromInitialGeneration(context, model, validation, repairOutcome, extra = {}) {
  return {
    ok: true,
    stage: "complete",
    complete: true,
    requiresRefinement: false,
    structurePlan: context.structurePlan,
    originalModel: context.originalModel,
    cleanedModel: context.cleanedModel,
    model,
    validation,
    removedBricks: context.removedBricks,
    targetPieceCount: context.targetPieceCount,
    repair: {
      outcome: repairOutcome,
      ...extra,
    },
  };
}

function awaitingFullModelFallback(context, generationClient, {
  reason,
  errors,
  patchFailures,
}) {
  logFullModelFallback(generationClient, {
    phase: "repair",
    stage: "patch_repair",
    outcome: "awaiting_refinement",
    reason,
    errors,
    cleanedInitialValid: context.validation.valid,
  });

  return {
    ok: true,
    stage: "awaiting_refinement",
    complete: false,
    requiresRefinement: true,
    structurePlan: context.structurePlan,
    originalModel: context.originalModel,
    cleanedModel: context.cleanedModel,
    model: context.cleanedModel,
    validation: context.validation,
    removedBricks: context.removedBricks,
    targetPieceCount: context.targetPieceCount,
    refinement: {
      outcome: "awaiting_refinement",
      reason,
      patchFailures,
    },
  };
}

function buildPatchRepairContext(context, {
  currentModel = context.cleanedModel,
  validation = context.validation,
  retry = false,
} = {}) {
  return buildCompactRepairContext({
    userPrompt: context.userPrompt,
    structurePlan: context.structurePlan,
    inventory: context.inventory,
    currentModel,
    cleanedModel: context.cleanedModel,
    invalidModel: currentModel,
    originalModel: context.originalModel,
    validationErrors: validation.errors,
    targetPieceCount: context.targetPieceCount,
    limits: retry ? PATCH_REPAIR_RETRY_LIMITS : {},
  });
}

async function runPatchRepairAttempt({
  context,
  generationClient,
  repairModel,
  attempt,
  currentModel = context.cleanedModel,
  validation = context.validation,
  priorPatchFailure,
}) {
  const retry = attempt > 1;
  const repairKind = retry ? "ai_patch_retry" : "ai_patch_repair";
  const stage = retry ? "patch_retry" : "patch_repair";
  const label = retry ? "AI patch repair retry" : "AI patch repair";
  const repairContext = buildPatchRepairContext(context, {
    currentModel,
    validation,
    retry,
  });
  const request = buildPlacementPatchRepairPrompt({
    repairContext,
    priorPatchFailure,
    model: repairModel.trim(),
    maxOutputTokens: retry ? PATCH_REPAIR_RETRY_MAX_TOKENS : undefined,
  });
  let patchText;

  try {
    patchText = await generationClient.complete(request, {
      phase: "repair",
      stage,
      label,
      repairKind,
      repairAttempt: attempt,
      retryOf: retry ? "patch_repair" : "validation",
    });
  } catch (error) {
    const errors = [{ message: error.message }];
    logPatchFailure(generationClient, {
      stage,
      repairKind,
      repairAttempt: attempt,
      reason: "patch_provider_error",
      errors,
    });
    return {
      ok: false,
      stage,
      reason: "patch_provider_error",
      errors,
    };
  }

  const parsedPatch = parseJsonObject(patchText, "model patch");

  if (!parsedPatch.ok) {
    logJsonParseFailure(generationClient, {
      phase: "repair",
      stage: `${stage}_parse`,
      label: `${label} JSON parse`,
      text: patchText,
      errors: parsedPatch.errors,
      parseAttempt: attempt,
    });
    logPatchFailure(generationClient, {
      stage,
      repairKind,
      repairAttempt: attempt,
      reason: "patch_json_parse_failed",
      errors: parsedPatch.errors,
    });

    return {
      ok: false,
      stage,
      reason: "patch_json_parse_failed",
      errors: parsedPatch.errors,
    };
  }

  const patch = normalizeModelPatch(parsedPatch.value);
  let patchedModel;

  try {
    patchedModel = applyModelPatch(currentModel, patch);
  } catch (error) {
    const errors = error instanceof ModelPatchError
      ? error.errors
      : [{ message: error.message }];
    logPatchFailure(generationClient, {
      stage,
      repairKind,
      repairAttempt: attempt,
      reason: "patch_apply_failed",
      errors,
    });

    return {
      ok: false,
      stage,
      reason: "patch_apply_failed",
      errors,
    };
  }

  const patchedValidation = validateModel(patchedModel, context.inventory);

  if (patchedValidation.valid) {
    logServiceEvent(generationClient, {
      type: "ai_patch_repair_applied",
      repairKind,
      phase: "repair",
      stage,
      repairAttempt: attempt,
      operationCount: patch.operations.length,
      validationValidAfter: true,
    });

    return {
      ok: true,
      stage,
      model: patchedModel,
      validation: patchedValidation,
      patch,
      repairKind,
      repairAttempt: attempt,
    };
  }

  logPatchFailure(generationClient, {
    stage,
    repairKind,
    repairAttempt: attempt,
    reason: "patched_model_invalid",
    errors: patchedValidation.errors,
    validation: patchedValidation,
  });

  return {
    ok: false,
    stage,
    reason: "patched_model_invalid",
    errors: patchedValidation.errors,
    model: patchedModel,
    validation: patchedValidation,
  };
}

async function repairInitialPlacementIfNeeded({
  context,
  generationClient,
  repairModel,
}) {
  if (context.validation.valid) {
    return successFromInitialGeneration(
      context,
      context.cleanedModel,
      context.validation,
      "local_deterministic_valid",
    );
  }

  const firstPatchResult = await runPatchRepairAttempt({
    context,
    generationClient,
    repairModel,
    attempt: 1,
  });

  if (firstPatchResult.ok) {
    return successFromInitialGeneration(
      context,
      firstPatchResult.model,
      firstPatchResult.validation,
      "ai_patch_repair_valid",
      {
        patchRepair: {
          repairAttempt: firstPatchResult.repairAttempt,
          operationCount: firstPatchResult.patch.operations.length,
        },
      },
    );
  }

  const retryPatchResult = await runPatchRepairAttempt({
    context,
    generationClient,
    repairModel,
    attempt: 2,
    currentModel: firstPatchResult.model ?? context.cleanedModel,
    validation: firstPatchResult.validation ?? context.validation,
    priorPatchFailure: patchFailureSummary(firstPatchResult),
  });

  if (retryPatchResult.ok) {
    return successFromInitialGeneration(
      context,
      retryPatchResult.model,
      retryPatchResult.validation,
      "ai_patch_retry_valid",
      {
        patchRepair: {
          repairAttempt: retryPatchResult.repairAttempt,
          operationCount: retryPatchResult.patch.operations.length,
          previousFailure: patchFailureSummary(firstPatchResult),
        },
      },
    );
  }

  const patchFailures = [
    patchFailureSummary(firstPatchResult),
    patchFailureSummary(retryPatchResult),
  ];

  return awaitingFullModelFallback(context, generationClient, {
    reason: "patch_repair_failed",
    errors: retryPatchResult.errors ?? firstPatchResult.errors,
    patchFailures,
  });
}

function successFromSelection(context, model, validation, outcome, extra = {}) {
  return {
    ok: true,
    stage: "complete",
    structurePlan: context.structurePlan,
    model,
    validation,
    removedBricks: context.removedBricks,
    refinement: {
      outcome,
      ...extra,
    },
  };
}

function selectRefinementResult(context, parsedRefinement, generationClient) {
  if (parsedRefinement.ok) {
    const shapeResult = validateGeneratedModelShape(parsedRefinement.value);

    if (shapeResult.ok) {
      const refinedValidation = validateModel(parsedRefinement.value, context.inventory);

      if (refinedValidation.valid) {
        return successFromSelection(
          context,
          parsedRefinement.value,
          refinedValidation,
          "refined_valid",
        );
      }

      if (context.validation.valid) {
        logFullModelFallback(generationClient, {
          outcome: "cleaned_initial_valid_fallback",
          reason: "refined_model_invalid",
          errors: refinedValidation.errors,
          cleanedInitialValid: context.validation.valid,
        });

        return successFromSelection(
          context,
          context.cleanedModel,
          context.validation,
          "cleaned_initial_valid_fallback",
          { refinedValidation },
        );
      }

      return successFromSelection(
        context,
        parsedRefinement.value,
        refinedValidation,
        "refined_invalid_draft",
      );
    }

    logFullModelFallback(generationClient, {
      outcome: "cleaned_initial_schema_fallback",
      reason: "refined_model_shape_invalid",
      errors: shapeResult.errors,
      cleanedInitialValid: context.validation.valid,
    });

    return successFromSelection(
      context,
      context.cleanedModel,
      context.validation,
      "cleaned_initial_schema_fallback",
      { errors: shapeResult.errors },
    );
  }

  logFullModelFallback(generationClient, {
    outcome: "cleaned_initial_parse_fallback",
    reason: "refinement_json_parse_failed",
    errors: parsedRefinement.errors,
    cleanedInitialValid: context.validation.valid,
  });

  return successFromSelection(
    context,
    context.cleanedModel,
    context.validation,
    "cleaned_initial_parse_fallback",
    { errors: parsedRefinement.errors },
  );
}

/**
 * Runs the first two calls in the submitted-build budget and returns the
 * canonical cleaned placement context needed by browser-side refinement.
 */
export async function generateModel({
  userPrompt,
  inventory,
  targetPieceCount,
  generationClient,
  structureModel,
  placementModel,
  repairModel = placementModel,
  onProgress,
  streamPlacement = false,
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

  const structureRequest = buildStructurePrompt({
    userPrompt,
    inventory,
    targetPieceCount,
    model: structureModel.trim(),
  });

  await emitProgress(onProgress, "structure_generate", "running");
  const structureText = await generationClient.complete(structureRequest, {
    phase: "planning",
    stage: "structure_generate",
    label: "Structure planning",
  });
  await emitProgress(onProgress, "structure_generate", "complete");
  await emitProgress(onProgress, "structure_parse", "running");
  const parsedStructure = parseJsonObject(structureText, "structure plan");
  let structureResult;

  if (parsedStructure.ok) {
    const structureValidation = validateStructurePlan(parsedStructure.value);
    structureResult = {
      ok: structureValidation.ok,
      value: structureValidation.ok ? parsedStructure.value : undefined,
      errors: structureValidation.errors,
    };
  } else {
    logJsonParseFailure(generationClient, {
      phase: "planning",
      stage: "structure_parse",
      label: "Structure JSON parse",
      text: structureText,
      errors: parsedStructure.errors,
    });
    structureResult = parsedStructure;
  }

  await emitProgress(
    onProgress,
    "structure_parse",
    structureResult.ok ? "complete" : "failed",
  );

  if (!structureResult.ok) {
    return failure("structure_parse", structureResult.errors);
  }

  const placementRequest = buildPlacementPrompt({
    userPrompt,
    inventory,
    structurePlan: structureResult.value,
    targetPieceCount,
    model: placementModel.trim(),
  });

  await emitProgress(onProgress, "placement_generate", "running");
  const placementText = streamPlacement && typeof generationClient.streamWithMetadata === "function"
    ? (await streamTextAndBricks({
      generationClient,
      request: placementRequest,
      phase: "placement",
      onProgress,
    })).text
    : await generationClient.complete(placementRequest, {
      phase: "placing",
      stage: "placement_generate",
      label: "Placement generation",
    });
  await emitProgress(onProgress, "placement_generate", "complete");
  await emitProgress(onProgress, "placement_parse", "running");
  let placementJson = parseJsonObject(placementText, "placement model");

  if (!placementJson.ok) {
    logJsonParseFailure(generationClient, {
      phase: "placing",
      stage: "placement_parse",
      label: "Placement JSON parse",
      text: placementText,
      errors: placementJson.errors,
    });
  }

  if (!placementJson.ok && streamPlacement && typeof generationClient.complete === "function") {
    const repairRequest = buildJsonRepairPrompt({
      label: "placement model",
      malformedText: placementText,
      errorMessage: placementJson.errors[0]?.message ?? "Incomplete streamed placement JSON.",
      model: placementModel.trim(),
      responseSchema: GENERATED_MODEL_SCHEMA,
      maxOutputTokens: PLACEMENT_GENERATION_MAX_TOKENS,
    });
    const repairedText = await generationClient.complete(repairRequest, {
      phase: "placing",
      stage: "placement_repair",
      label: "Placement JSON repair",
      repairKind: "ai_json_repair",
      repairAttempt: 1,
      retryOf: "placement_generate",
    });
    placementJson = parseJsonObject(repairedText, "placement model");

    if (!placementJson.ok) {
      logJsonParseFailure(generationClient, {
        phase: "placing",
        stage: "placement_repair_parse",
        label: "Placement repaired JSON parse",
        text: repairedText,
        errors: placementJson.errors,
        parseAttempt: 2,
      });
    }
  }

  if (!placementJson.ok) {
    await emitProgress(onProgress, "placement_parse", "failed");
    return failure("placement_parse", placementJson.errors, {
      structurePlan: structureResult.value,
    });
  }

  const shapeResult = validateGeneratedModelShape(placementJson.value);

  if (!shapeResult.ok) {
    await emitProgress(onProgress, "placement_parse", "failed");
    return failure("placement_shape", shapeResult.errors, {
      structurePlan: structureResult.value,
    });
  }

  await emitProgress(onProgress, "placement_parse", "complete");
  await emitProgress(onProgress, "validation", "running");
  const context = initialPlacementContext({
    userPrompt,
    targetPieceCount,
    structurePlan: structureResult.value,
    originalModel: placementJson.value,
    inventory,
  });
  logLocalDeterministicRepair(generationClient, {
    phase: "placing",
    stage: "validation",
    removedBricks: context.removedBricks,
    validation: context.validation,
  });

  await emitDraft(onProgress, "cleaned_placement_draft", {
    model: context.cleanedModel,
    validation: context.validation,
    removedBricks: context.removedBricks,
  });
  const repairedResult = await repairInitialPlacementIfNeeded({
    context,
    generationClient,
    repairModel: typeof repairModel === "string" && repairModel.trim() !== ""
      ? repairModel
      : placementModel,
  });

  if (
    repairedResult.ok &&
    repairedResult.stage === "complete" &&
    repairedResult.repair?.outcome?.startsWith("ai_patch")
  ) {
    await emitDraft(onProgress, "patched_placement_draft", {
      model: repairedResult.model,
      validation: repairedResult.validation,
      removedBricks: repairedResult.removedBricks,
    });
  }

  await emitProgress(onProgress, "validation", "complete");

  return repairedResult;
}

/**
 * Runs exactly one final multimodal model call and selects a result using the
 * deterministic fallback order from the refinement design.
 */
export async function refineModel({
  userPrompt,
  inventory,
  targetPieceCount,
  structurePlan,
  originalModel,
  image,
  generationClient,
  refinementModel,
  streamRefinement = false,
  streamedBrickIds,
  onProgress,
}) {
  if (typeof refinementModel !== "string" || refinementModel.trim() === "") {
    throw new Error(
      "refinementModel is required. Resolve it from GEMINI_REFINEMENT_MODEL or the placement model before calling refineModel.",
    );
  }

  const structureValidation = validateStructurePlan(structurePlan);

  if (!structureValidation.ok) {
    return failure("refinement_context", structureValidation.errors);
  }

  const originalShape = validateGeneratedModelShape(originalModel);

  if (!originalShape.ok) {
    return failure("refinement_context", originalShape.errors);
  }

  // Rebuild all deterministic context server-side so browser-provided cleanup
  // or validation fields can never override the authoritative local rules.
  const initialContext = initialPlacementContext({
    userPrompt,
    targetPieceCount,
    structurePlan,
    originalModel,
    inventory,
  });
  const context = { ...initialContext, inventory };
  logLocalDeterministicRepair(generationClient, {
    phase: "refinement",
    stage: "refinement_context",
    removedBricks: context.removedBricks,
    validation: context.validation,
  });
  const refinementRequest = buildRefinementPrompt({
    userPrompt,
    inventory,
    structurePlan,
    originalModel,
    cleanedModel: context.cleanedModel,
    removedBricks: context.removedBricks,
    validationErrors: context.validation.errors,
    targetPieceCount,
    image,
    model: refinementModel.trim(),
  });

  let refinementText;

  try {
    refinementText = streamRefinement && typeof generationClient.streamWithMetadata === "function"
      ? (await streamTextAndBricks({
        generationClient,
        request: refinementRequest,
        phase: "repair",
        onProgress,
        seenIds: new Set(
          streamedBrickIds ?? (originalModel.bricks ?? []).map((brick) => brick.id),
        ),
      })).text
      : await generationClient.complete(refinementRequest, {
        phase: "refinement",
        stage: "refinement",
        label: "Isometric model refinement",
      });
  } catch (error) {
    if (streamRefinement) {
      throw error;
    }
    logFullModelFallback(generationClient, {
      outcome: "cleaned_initial_provider_fallback",
      reason: "refinement_provider_error",
      errors: [{ message: error.message }],
      cleanedInitialValid: context.validation.valid,
    });

    return successFromSelection(
      context,
      context.cleanedModel,
      context.validation,
      "cleaned_initial_provider_fallback",
      { errors: [{ message: error.message }] },
    );
  }

  const parsedRefinement = parseJsonObject(refinementText, "refinement model");
  if (!parsedRefinement.ok) {
    logJsonParseFailure(generationClient, {
      phase: streamRefinement ? "repair" : "refinement",
      stage: "refinement_parse",
      label: "Refinement JSON parse",
      text: refinementText,
      errors: parsedRefinement.errors,
    });
  }

  if (streamRefinement && !parsedRefinement.ok) {
    return failure("refinement_parse", parsedRefinement.errors, {
      model: context.cleanedModel,
      validation: context.validation,
      structurePlan,
    });
  }
  return selectRefinementResult(context, parsedRefinement, generationClient);
}
