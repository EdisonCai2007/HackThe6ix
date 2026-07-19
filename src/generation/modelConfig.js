import { fileURLToPath } from "node:url";

function cleanEnvValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function integerEnv(env, name, fallback, { allowZero = false } = {}) {
  const raw = cleanEnvValue(env[name]);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  const minimum = allowZero ? 0 : 1;

  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
  }

  return value;
}

export function resolveGenerationMode(env = process.env) {
  const mode = cleanEnvValue(env.GENERATION_MODE) ?? "legacy_ai";

  if (!new Set(["legacy_ai", "brickgpt_inventory"]).has(mode)) {
    throw new Error("GENERATION_MODE must be legacy_ai or brickgpt_inventory.");
  }

  return mode;
}

export function resolveHybridGenerationConfig(env = process.env) {
  const useGurobiValue = cleanEnvValue(env.BRICKGPT_USE_GUROBI) ?? "false";

  if (!new Set(["true", "false"]).has(useGurobiValue)) {
    throw new Error("BRICKGPT_USE_GUROBI must be true or false.");
  }

  return {
    pythonExecutable: cleanEnvValue(env.BRICKGPT_PYTHON) ?? "python3",
    sidecarPath: cleanEnvValue(env.BRICKGPT_SIDECAR_PATH) ?? fileURLToPath(
      new URL("../../python/brickgpt_sidecar.py", import.meta.url),
    ),
    timeoutMs: integerEnv(env, "BRICKGPT_TIMEOUT_MS", 600_000),
    maxOutputBytes: integerEnv(env, "BRICKGPT_MAX_OUTPUT_BYTES", 8 * 1024 * 1024),
    candidateCount: integerEnv(env, "BRICKGPT_CANDIDATE_COUNT", 4),
    seedBase: integerEnv(env, "BRICKGPT_SEED_BASE", 42, { allowZero: true }),
    worldDim: integerEnv(env, "BRICKGPT_WORLD_DIM", 20),
    useGurobi: useGurobiValue === "true",
    beamWidth: integerEnv(env, "HYBRID_COMPILER_BEAM_WIDTH", 12),
    variants: integerEnv(env, "HYBRID_COMPILER_VARIANTS", 3),
  };
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
