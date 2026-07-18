function cleanEnvValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function resolveGenerationModels(env = process.env) {
  const sharedModel = cleanEnvValue(env.GEMINI_MODEL);
  const structureModel = sharedModel ?? cleanEnvValue(env.GEMINI_STRUCTURE_MODEL);
  const placementModel = sharedModel ?? cleanEnvValue(env.GEMINI_PLACEMENT_MODEL);
  const repairModel = cleanEnvValue(env.GEMINI_REPAIR_MODEL) ?? sharedModel ?? placementModel;

  if (!structureModel || !placementModel) {
    throw new Error(
      "Gemini model configuration is required. Set GEMINI_MODEL or both GEMINI_STRUCTURE_MODEL and GEMINI_PLACEMENT_MODEL.",
    );
  }

  return {
    structureModel,
    placementModel,
    repairModel,
  };
}

export function resolveRefinementModel(env = process.env) {
  const refinementModel = cleanEnvValue(env.GEMINI_REFINEMENT_MODEL);

  if (refinementModel) {
    return refinementModel;
  }

  return resolveGenerationModels(env).placementModel;
}

export function resolveSuggestionModel(env = process.env) {
  const suggestionModel = cleanEnvValue(env.GEMINI_SUGGESTION_MODEL);

  if (!suggestionModel) {
    throw new Error("Gemini suggestion model configuration is required. Set GEMINI_SUGGESTION_MODEL.");
  }

  return suggestionModel;
}
