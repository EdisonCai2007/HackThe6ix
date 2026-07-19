import { buildShowcaseGrandPianoModel } from "./fixtures/showcaseGrandPianoModel.js";
import { buildShowcaseSteamLocomotiveModel } from "./fixtures/showcaseSteamLocomotiveModel.js";
import { validateGeneratedModelShape } from "./generatedModelSchema.js";
import { validateModel } from "./validator.js";

const STAGE_LABELS = Object.freeze({
  structure_generate: "Showcase design lookup",
  placement_generate: "Showcase brick placement",
  validation: "Showcase model validation",
});

function descriptor({
  id,
  label,
  promptMetadata,
  promptPhrases,
  buildModel,
}) {
  return Object.freeze({
    id,
    label,
    prompt_metadata: promptMetadata,
    promptPhrases: Object.freeze([...promptPhrases]),
    buildModel,
  });
}

export const SHOWCASE_BUILDS = Object.freeze([
  descriptor({
    id: "scarlet-steam-locomotive",
    label: "Scarlet Steam Locomotive",
    promptMetadata: "Detailed red-and-black display engine with driving wheels, coupling rods, cab, and smokestack",
    promptPhrases: ["scarlet steam locomotive"],
    buildModel: buildShowcaseSteamLocomotiveModel,
  }),
  descriptor({
    id: "midnight-grand-piano",
    label: "Midnight Grand Piano",
    promptMetadata: "Elegant black concert grand with contrasting keyboard, warm soundboard, raised lid, pedals, and bench",
    promptPhrases: ["midnight grand piano"],
    buildModel: buildShowcaseGrandPianoModel,
  }),
]);

function normalizedText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function supportsInventory(showcase, inventory) {
  try {
    const model = showcase.buildModel(inventory);
    const shape = validateGeneratedModelShape(model);

    return shape.ok && validateModel(model, inventory).valid;
  } catch {
    return false;
  }
}

export function listShowcaseBuildSuggestions(inventory) {
  const builds = inventory === undefined
    ? SHOWCASE_BUILDS
    : SHOWCASE_BUILDS.filter((showcase) => supportsInventory(showcase, inventory));

  return builds.map(({ id, label, prompt_metadata }) => ({
    showcase_id: id,
    label,
    prompt_metadata,
  }));
}

export function findShowcaseBuild({ showcaseId, userPrompt } = {}) {
  if (showcaseId !== undefined) {
    const normalizedId = typeof showcaseId === "string" ? showcaseId.trim() : "";
    return SHOWCASE_BUILDS.find(({ id }) => id === normalizedId);
  }

  const prompt = normalizedText(userPrompt);

  if (!prompt) {
    return undefined;
  }

  return SHOWCASE_BUILDS.find(({ promptPhrases }) =>
    promptPhrases.some((phrase) => prompt.includes(normalizedText(phrase))),
  );
}

export function isShowcaseBuildRequest(body) {
  return Boolean(findShowcaseBuild({
    showcaseId: body?.showcase_id,
    userPrompt: body?.userPrompt,
  }));
}

async function emitStage(onProgress, stage, status) {
  await onProgress?.({
    type: "stage",
    stage,
    status,
    label: STAGE_LABELS[stage],
  });
}

function wait(delayMs) {
  return delayMs > 0
    ? new Promise((resolve) => setTimeout(resolve, delayMs))
    : Promise.resolve();
}

function orderedBricks(bricks) {
  return bricks
    .map((brick, index) => ({ brick, index }))
    .sort((left, right) =>
      left.brick.step - right.brick.step || left.index - right.index,
    )
    .map(({ brick }) => brick);
}

function failure(stage, errors) {
  return { ok: false, stage, errors };
}

export async function generateShowcaseBuild({
  showcaseId,
  userPrompt,
  inventory,
  onProgress,
  delayMs = 0,
}) {
  const showcase = findShowcaseBuild({ showcaseId, userPrompt });

  if (!showcase) {
    return failure("showcase_lookup", [{
      type: "unknown_showcase",
      message: "No showcase build matches this request.",
    }]);
  }

  if (!inventory || !Array.isArray(inventory.items)) {
    throw new Error("inventory.items must be an array.");
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("delayMs must be a non-negative finite number.");
  }

  await emitStage(onProgress, "structure_generate", "running");
  const model = showcase.buildModel(inventory);
  await emitStage(onProgress, "structure_generate", "complete");

  const shape = validateGeneratedModelShape(model);
  if (!shape.ok) {
    return failure("placement_shape", shape.errors);
  }

  await emitStage(onProgress, "placement_generate", "running");
  const bricks = orderedBricks(model.bricks);

  for (const [index, brick] of bricks.entries()) {
    await onProgress?.({ type: "brick", phase: "placement", brick });
    if (index < bricks.length - 1 && typeof onProgress === "function") {
      await wait(delayMs);
    }
  }

  await emitStage(onProgress, "placement_generate", "complete");
  await emitStage(onProgress, "validation", "running");
  const validation = validateModel(model, inventory);
  await emitStage(onProgress, "validation", validation.valid ? "complete" : "failed");

  if (!validation.valid) {
    return failure("validation", validation.errors);
  }

  return {
    ok: true,
    stage: "complete",
    complete: true,
    requiresRefinement: false,
    model,
    validation,
    showcase: {
      id: showcase.id,
      label: showcase.label,
    },
  };
}
