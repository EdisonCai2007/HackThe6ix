export const PATCH_REPAIR_MAX_TOKENS = 3000;
export const PATCH_REPAIR_RETRY_MAX_TOKENS = 1500;

const JSON_GENERATION_CONFIG = {
  maxOutputTokens: PATCH_REPAIR_MAX_TOKENS,
  responseMimeType: "application/json",
};

const POSITION_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" },
  },
  required: ["x", "y", "z"],
};

const BRICK_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    part_id: { type: "string" },
    ldraw_id: { type: "string" },
    label: { type: "string" },
    color_id: { type: "string" },
    color_name: { type: "string" },
    position: POSITION_SCHEMA,
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
};

export const REPAIR_PATCH_SCHEMA = {
  type: "object",
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["remove", "move", "update", "add", "replace"] },
          id: { type: "string" },
          position: POSITION_SCHEMA,
          updates: {
            type: "object",
            properties: {
              part_id: { type: "string" },
              ldraw_id: { type: "string" },
              label: { type: "string" },
              color_id: { type: "string" },
              color_name: { type: "string" },
              position: POSITION_SCHEMA,
              rotation: { type: "integer" },
              feature: { type: "string" },
              step: { type: "integer" },
            },
          },
          brick: BRICK_SCHEMA,
        },
        required: ["type"],
      },
    },
  },
  required: ["operations"],
};

function textPart(text) {
  return { text };
}

function buildGeminiJsonRequest({
  model,
  systemText,
  userPayload,
  responseSchema,
  maxOutputTokens = PATCH_REPAIR_MAX_TOKENS,
}) {
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
      maxOutputTokens,
      responseSchema,
    },
  };
}

export function buildPlacementPatchRepairPrompt({
  repairContext,
  priorPatchFailure,
  model,
  maxOutputTokens = PATCH_REPAIR_MAX_TOKENS,
}) {
  return buildGeminiJsonRequest({
    model,
    systemText: [
      "You repair LEGO placement validation errors by returning a patch JSON object.",
      "Return exactly one JSON object matching generationConfig.responseSchema.",
      "No markdown, no commentary, and no text before or after the JSON object.",
      "Fix only listed invalid brick ids unless impossible; when another brick must change, use the fewest additional operations.",
      "Prefer remove/move over rebuilding.",
      "Output compact operations only: no rationale, no unchanged fields, and no no-op updates.",
      "Use { type: \"remove\", id } for bricks that cannot legally remain.",
      "Use { type: \"move\", id, position } for coordinate-only fixes.",
      "Use { type: \"update\", id, updates } only for changed brick fields such as rotation, part, color, feature, step, or position.",
      "Use { type: \"add\", brick } only when support or connection cannot be repaired otherwise.",
      "Use { type: \"replace\", id, brick } only when a brick must be swapped while preserving its id.",
      "For add and replace operations, include the complete brick record needed for the server to insert or replace that brick.",
      "Use only supported parts and part/color combinations listed with remaining availability, without exceeding quantities.",
      "Keep the requested object and recognizable features unless a listed invalid brick makes that impossible.",
      "Server will apply and validate patch locally; deterministic validation is authoritative.",
      "Do not return model metadata, dimensions, notes, a top-level bricks array, or a rewritten build.",
    ].join("\n"),
    userPayload: {
      repair_context: repairContext,
      ...(priorPatchFailure ? { prior_patch_failure: priorPatchFailure } : {}),
    },
    responseSchema: REPAIR_PATCH_SCHEMA,
    maxOutputTokens,
  });
}
