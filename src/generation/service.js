import {
  parseJsonObject,
  parseStructurePlanText,
  validateStructurePlan,
} from "./designPlan.js";
import { validateGeneratedModelShape } from "./generatedModelSchema.js";
import {
  BUILD_SUGGESTIONS_SCHEMA,
  buildBuildSuggestionsPrompt,
  buildJsonRepairPrompt,
  buildPlacementPrompt,
  buildRefinementPrompt,
  buildStructurePrompt,
} from "./generationPrompts.js";
import { cleanupIllegalInventoryUsage } from "./inventoryCleanup.js";
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
  });

  return parseJsonObject(repairedText, "build suggestions");
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
  const cleanup = cleanupIllegalInventoryUsage(originalModel, inventory);
  const validation = validateModel(cleanup.model, inventory);

  return {
    userPrompt,
    targetPieceCount,
    structurePlan,
    originalModel,
    cleanedModel: cleanup.model,
    removedBricks: cleanup.removedBricks,
    validation,
  };
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

function selectRefinementResult(context, parsedRefinement) {
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

    return successFromSelection(
      context,
      context.cleanedModel,
      context.validation,
      "cleaned_initial_schema_fallback",
      { errors: shapeResult.errors },
    );
  }

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
  const structureResult = parseStructurePlanText(structureText);
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

  if (!placementJson.ok && streamPlacement && typeof generationClient.complete === "function") {
    const repairRequest = buildJsonRepairPrompt({
      label: "placement model",
      malformedText: placementText,
      errorMessage: placementJson.errors[0]?.message ?? "Incomplete streamed placement JSON.",
      model: placementModel.trim(),
    });
    const repairedText = await generationClient.complete(repairRequest, {
      phase: "placing",
      stage: "placement_repair",
      label: "Placement JSON repair",
    });
    placementJson = parseJsonObject(repairedText, "placement model");
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

  await emitDraft(onProgress, "cleaned_placement_draft", {
    model: context.cleanedModel,
    validation: context.validation,
    removedBricks: context.removedBricks,
  });
  await emitProgress(onProgress, "validation", "complete");

  return {
    ok: true,
    stage: "awaiting_refinement",
    structurePlan: context.structurePlan,
    originalModel: context.originalModel,
    cleanedModel: context.cleanedModel,
    model: context.cleanedModel,
    validation: context.validation,
    removedBricks: context.removedBricks,
    targetPieceCount,
  };
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
    return successFromSelection(
      context,
      context.cleanedModel,
      context.validation,
      "cleaned_initial_provider_fallback",
      { errors: [{ message: error.message }] },
    );
  }

  const parsedRefinement = parseJsonObject(refinementText, "refinement model");
  if (streamRefinement && !parsedRefinement.ok) {
    return failure("refinement_parse", parsedRefinement.errors, {
      model: context.cleanedModel,
      validation: context.validation,
      structurePlan,
    });
  }
  return selectRefinementResult(context, parsedRefinement);
}
