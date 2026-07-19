import { scoreCompiledCandidate, selectBestCandidate } from "./candidateScorer.js";
import { compileTargetVolume } from "./inventoryCompiler.js";
import { normalizeBrickGptTarget } from "./targetVolume.js";

const STAGE_LABELS = {
  geometry_generate: "BrickGPT geometry generation",
  geometry_normalize: "Target-volume normalization",
  inventory_compile: "Exact-inventory compilation",
  candidate_validate: "Candidate validation",
  candidate_select: "Best-candidate selection",
};

async function emit(onProgress, stage, status, extra = {}) {
  await onProgress?.({
    type: "stage",
    stage,
    status,
    label: STAGE_LABELS[stage],
    ...extra,
  });
}

function errorSummary(error, seed, stage) {
  return {
    seed,
    stage,
    code: error?.code ?? "generation_failed",
    message: error?.message ?? String(error),
  };
}

function candidateDiagnostic(candidate) {
  const evaluation = scoreCompiledCandidate(candidate);
  return {
    seed: candidate.sourceSeed,
    variant: candidate.variant,
    valid: candidate.validation.valid,
    score: evaluation.score,
    coverage: candidate.coverage,
    exteriorCoverage: candidate.exteriorCoverage,
    colorCoherence: candidate.colorCoherence,
    pieceCount: candidate.model.piece_count,
    validationErrors: candidate.validation.errors.map((error) => error.type ?? error.message),
  };
}

function inventoryPieceCount(inventory) {
  return inventory.items.reduce(
    (total, item) => total + (item.supported && Number.isInteger(item.count) ? item.count : 0),
    0,
  );
}

export async function generateHybridModel({
  userPrompt,
  inventory,
  geometryProvider,
  candidateCount = 4,
  seedBase = 42,
  worldDim = 20,
  useGurobi = false,
  compilerOptions = {},
  onProgress,
  signal,
}) {
  if (typeof userPrompt !== "string" || userPrompt.trim() === "") {
    throw new Error("userPrompt must be a non-empty string.");
  }
  if (!inventory || !Array.isArray(inventory.items)) {
    throw new Error("inventory.items must be an array.");
  }
  if (!geometryProvider || typeof geometryProvider.generate !== "function") {
    throw new Error("geometryProvider.generate is required.");
  }

  const candidates = [];
  const seedFailures = [];
  const maxBricks = inventoryPieceCount(inventory);

  for (let offset = 0; offset < candidateCount; offset += 1) {
    const seed = seedBase + offset;
    let stage = "geometry_generate";

    try {
      await emit(onProgress, stage, "running", { seed, candidateIndex: offset + 1, candidateCount });
      const proposal = await geometryProvider.generate({
        prompt: userPrompt.trim(),
        seed,
        worldDim,
        maxBricks,
        useGurobi,
        signal,
      });
      await emit(onProgress, stage, "complete", { seed });

      stage = "geometry_normalize";
      await emit(onProgress, stage, "running", { seed });
      const target = normalizeBrickGptTarget({
        seed,
        bricks: proposal.bricks,
        worldDim,
      });
      await emit(onProgress, stage, "complete", { seed, targetCellCount: target.cells.size });

      stage = "inventory_compile";
      await emit(onProgress, stage, "running", { seed });
      const compiled = compileTargetVolume({
        target,
        inventory,
        prompt: userPrompt,
        ...compilerOptions,
      });
      candidates.push(...compiled);
      await emit(onProgress, stage, "complete", { seed, compiledCandidateCount: compiled.length });

      stage = "candidate_validate";
      await emit(onProgress, stage, "complete", {
        seed,
        validCandidateCount: compiled.filter((candidate) => candidate.validation.valid).length,
      });

      const currentBest = selectBestCandidate(
        candidates.filter((candidate) => candidate.validation.valid),
      );
      if (currentBest) {
        await onProgress?.({
          type: "draft",
          stage: "inventory_compile",
          model: currentBest.model,
          validation: currentBest.validation,
          hybrid: candidateDiagnostic(currentBest),
        });
      }
    } catch (error) {
      seedFailures.push(errorSummary(error, seed, stage));
      await emit(onProgress, stage, "failed", {
        seed,
        code: error?.code,
        message: error?.message ?? String(error),
      });
    }
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      stage: "geometry_generate",
      errors: seedFailures.map((failure) => ({
        type: failure.code,
        message: `Seed ${failure.seed}: ${failure.message}`,
      })),
      hybrid: { seedFailures, candidateScores: [] },
    };
  }

  await emit(onProgress, "candidate_select", "running");
  const validCandidates = candidates.filter((candidate) => candidate.validation.valid);
  const selected = selectBestCandidate(validCandidates);

  if (!selected) {
    await emit(onProgress, "candidate_select", "failed");
    return {
      ok: false,
      stage: "inventory_compile",
      errors: [{
        type: "no_valid_candidate",
        message: "No compiled candidate passed deterministic validation.",
      }],
      hybrid: {
        seedFailures,
        candidateScores: candidates.map(candidateDiagnostic),
      },
    };
  }

  await emit(onProgress, "candidate_select", "complete", { selectedSeed: selected.sourceSeed });

  return {
    ok: true,
    stage: "complete",
    complete: true,
    requiresRefinement: false,
    model: selected.model,
    validation: selected.validation,
    hybrid: {
      selectedSeed: selected.sourceSeed,
      selectedVariant: selected.variant,
      coverage: selected.coverage,
      exteriorCoverage: selected.exteriorCoverage,
      colorCoherence: selected.colorCoherence,
      seedsAttempted: candidateCount,
      targetsCompiled: new Set(candidates.map((candidate) => candidate.sourceSeed)).size,
      seedFailures,
      candidateScores: candidates.map(candidateDiagnostic),
    },
  };
}
