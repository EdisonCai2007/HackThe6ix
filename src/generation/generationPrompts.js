import { MAX_MODEL_PIECES, SUPPORTED_PARTS } from "./partCatalog.js";

const GENERATION_MAX_TOKENS = 10000;
export const PLACEMENT_GENERATION_MAX_TOKENS = 40000;
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

export const BUILD_SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          prompt_metadata: { type: "string" },
          inventory_reasoning: { type: "string" },
        },
        required: ["label", "prompt_metadata", "inventory_reasoning"],
      },
    },
  },
  required: ["suggestions"],
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

function buildGeminiJsonRequest({
  model,
  systemText,
  userPayload,
  responseSchema,
  maxOutputTokens = GENERATION_MAX_TOKENS,
  inlineImage,
}) {
  return {
    model,
    systemInstruction: {
      parts: [textPart(systemText)],
    },
    contents: [
      {
        role: "user",
        parts: [
          textPart(JSON.stringify(userPayload, null, 2)),
          ...(inlineImage
            ? [{
              inlineData: {
                mimeType: inlineImage.mimeType,
                data: inlineImage.data,
              },
            }]
            : []),
        ],
      },
    ],
    generationConfig: {
      ...JSON_GENERATION_CONFIG,
      maxOutputTokens,
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
      "The generated model must be one free-standing connected LEGO object, not a scene.",
      `Prefer more pieces but never exceed the requested target count or the ${MAX_MODEL_PIECES}-piece MVP cap.`,
      "Treat natural/requested colors as preferences: keep allowed_color_ids broad, plan coherent feature color blocks, and accept abstract colors when silhouette/features stay readable.",
    ].join("\n"),
    userPayload: {
      user_prompt: userPrompt,
      target_piece_count: cappedTarget,
      inventory: inventorySummary,
    },
    responseSchema: STRUCTURE_PLAN_SCHEMA,
  });
}

export function buildBuildSuggestionsPrompt({ inventory, model }) {
  return buildGeminiJsonRequest({
    model,
    systemText: [
      "You suggest build ideas for a local LEGO generation app from the confirmed inventory.",
      "Return exactly one JSON object matching generationConfig.responseSchema.",
      "No markdown, no commentary, and no text before or after the JSON object.",
      "Return exactly 5 suggestions when the inventory can support 5 meaningfully different ideas; otherwise return the feasible count.",
      "Each suggestion must describe one free-standing connected LEGO object, never a scene, diorama, landscape, or multi-object set.",
      "Make the menu diverse: no two suggestions should share the same object family, silhouette class, or primary functional feature unless the inventory is too constrained.",
      "Make each suggestion visibly responsive to this specific inventory, not a generic LEGO prior.",
      "Each suggestion must rely on a different mix of inventory signals, such as plate-vs-brick ratio, long-vs-short parts, repeated part dimensions, abundant colors, scarce colors, or color contrasts.",
      "Favor distinctive real-world single objects with clear silhouettes and recognizable functional details.",
      "Prioritize subjects whose identity can be expressed by the provided part shapes and quantities, not by exact color.",
      "Use color as a secondary creative cue: when a color is abundant, scarce, or high-contrast, prefer objects where that palette helps recognition, but never choose an object that is only color-matched and geometrically weak.",
      "Never use generic geometric masses, abstract structures, scenes, speculative devices, weapons, impossible moving parts, or builds that require unavailable specialty parts.",
      "Each label must be short, specific, and object-like; avoid color adjectives, vague category names, and made-up futuristic branding.",
      "Each prompt_metadata value must be a concise user-ready generation prompt that names concrete features and silhouette for that one object.",
      "For prompt_metadata, use shape first: describe the broad form, whether the object reads as flat or bulky, and the recognizable details.",
      "For prompt_metadata, do not include color words, color names, or palette guidance; the builder must choose colors from inventory availability instead of treating metadata colors as strict requirements.",
      "For prompt_metadata, avoid size adjectives.",
      "For prompt_metadata, Do not mention specific bricks, part IDs, dimensions, piece counts, or construction instructions; the planner decides exact LEGO parts and layout.",
      "Each inventory_reasoning value must name at least two concrete inventory signals and explain how the available part shapes, flat-or-bulky profile, quantities, dimensions, and color distribution support the object.",
      "Use only capabilities supported by the provided inventory; do not claim unavailable parts or colors.",
      "Use inventory shape heuristics before color: taller-piece inventory should favor bulky silhouettes, while flatter-piece inventory should favor flatter silhouettes; color alone is never enough to choose an object.",
      "In the inventory summary, height_layers 3 means a brick and height_layers 1 means a plate.",
    ].join("\n"),
    userPayload: {
      inventory: summarizeSupportedInventory(inventory),
    },
    responseSchema: BUILD_SUGGESTIONS_SCHEMA,
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
      "Use only inventory parts/colors; assign alternate colors as coherent feature blocks or symmetric patterns, not random scatter.",
      "Do not exceed inventory quantities; never shrink or simplify solely to stay within one matching color.",
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
    maxOutputTokens: PLACEMENT_GENERATION_MAX_TOKENS,
  });
}

export function buildRefinementPrompt({
  userPrompt,
  inventory,
  structurePlan,
  originalModel,
  cleanedModel,
  removedBricks = [],
  validationErrors = [],
  targetPieceCount,
  image,
  model,
}) {
  const cappedTarget = clampTargetPieceCount(
    targetPieceCount ?? structurePlan.target_piece_count,
  );

  return buildGeminiJsonRequest({
    model,
    systemText: [
      "You are the final visual evaluator and model generator for a local LEGO generation app.",
      "Inspect the fixed isometric image together with all structured generation context.",
      "Return exactly one complete GeneratedModel JSON object matching generationConfig.responseSchema.",
      "No markdown, no commentary, no KEEP or REBUILD decision, no wrapper object, and no text before or after the JSON object.",
      "The response must always contain the entire model, never a patch or list of edits.",
      "You may replace every brick when doing so improves prompt resemblance, recognizable silhouette, proportions, color placement, or physical validity.",
      "If the cleaned current model is already the best result, return that model with identical model contents.",
      "Use only supported parts and exact part/color combinations present in the full selected inventory, without exceeding quantities.",
      `Do not exceed ${MAX_MODEL_PIECES} pieces or the requested target count.`,
      "piece_count must equal the number of bricks in the returned model.",
      "Use x and y as integer stud-grid positions and z as an integer plate-layer height.",
      "Plates are 1 layer tall and bricks are 3 layers tall.",
      "Every brick rotation must be numeric 0, 90, 180, or 270.",
      "At least one brick must touch z 0, every raised brick must have occupied stud support directly below it, all bricks must connect through vertical stud overlap, and bricks must not overlap.",
      "Deterministic validation after this response is authoritative; visual plausibility does not override inventory or geometry rules.",
    ].join("\n"),
    userPayload: {
      user_prompt: userPrompt,
      target_piece_count: cappedTarget,
      structure_plan: structurePlan,
      full_selected_inventory: inventory,
      original_placement_model: originalModel,
      cleaned_current_model: cleanedModel,
      removed_bricks: removedBricks,
      deterministic_validation_errors: validationErrors,
      image_description: "One fixed browser-rendered isometric view of cleaned_current_model.",
    },
    inlineImage: image,
    responseSchema: GENERATED_MODEL_SCHEMA,
    maxOutputTokens: PLACEMENT_GENERATION_MAX_TOKENS,
  });
}

export function buildJsonRepairPrompt({
  label,
  malformedText,
  errorMessage,
  model,
  responseSchema = STRUCTURE_PLAN_SCHEMA,
  maxOutputTokens = GENERATION_MAX_TOKENS,
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
    maxOutputTokens,
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
    maxOutputTokens: PLACEMENT_GENERATION_MAX_TOKENS,
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
    maxOutputTokens: PLACEMENT_GENERATION_MAX_TOKENS,
  });
}
