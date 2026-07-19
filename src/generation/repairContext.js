import { getPartDimensions, SUPPORTED_PARTS } from "./partCatalog.js";

const DEFAULT_LIMITS = {
  maxNearbyOrSupportingBricks: 16,
  maxValidationSummaryBrickIds: 16,
  maxValidationMessageLength: 180,
  nearbyStudRadius: 1,
};

function compactObject(entries) {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  );
}

function bricksFromModel(model) {
  return Array.isArray(model?.bricks) ? model.bricks : [];
}

function brickKey(brick) {
  return brick?.id == null ? null : String(brick.id);
}

function inventoryKey(partId, colorId) {
  return `${partId}:${colorId}`;
}

function cellKey({ x, y, z }) {
  return `${x},${y},${z}`;
}

function addId(ids, value) {
  if (typeof value === "string" || typeof value === "number") {
    ids.add(String(value));
  }
}

function addIdsFromValue(ids, value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      addIdsFromValue(ids, item);
    }
    return;
  }

  addId(ids, value);
}

function uniqueBricksFromModels(models) {
  const bricksById = new Map();

  for (const model of models) {
    for (const brick of bricksFromModel(model)) {
      const id = brickKey(brick);

      if (id && !bricksById.has(id)) {
        bricksById.set(id, brick);
      }
    }
  }

  return [...bricksById.values()];
}

function brickMapFromModels(models) {
  return new Map(uniqueBricksFromModels(models).map((brick) => [brickKey(brick), brick]));
}

function sanitizedPosition(position) {
  if (!position) {
    return undefined;
  }

  return compactObject({
    x: position.x,
    y: position.y,
    z: position.z,
  });
}

function sanitizeBrickRecord(brick) {
  if (!brick) {
    return null;
  }

  return compactObject({
    id: brick.id,
    part_id: brick.part_id,
    ldraw_id: brick.ldraw_id,
    label: brick.label,
    color_id: brick.color_id,
    color_name: brick.color_name,
    position: sanitizedPosition(brick.position),
    rotation: brick.rotation,
    feature: brick.feature,
    step: brick.step,
  });
}

function dimensionsForBrick(brick) {
  const dimensions = getPartDimensions(brick?.part_id, brick?.rotation);

  if (dimensions) {
    return { ...dimensions, assumed: false };
  }

  return {
    width: 1,
    depth: 1,
    height: 1,
    assumed: true,
  };
}

function boundsForBrick(brick) {
  const position = brick?.position;

  if (
    !Number.isFinite(position?.x) ||
    !Number.isFinite(position?.y) ||
    !Number.isFinite(position?.z)
  ) {
    return null;
  }

  const dimensions = dimensionsForBrick(brick);

  return {
    minX: position.x,
    maxX: position.x + dimensions.width,
    minY: position.y,
    maxY: position.y + dimensions.depth,
    minZ: position.z,
    maxZ: position.z + dimensions.height,
    assumedDimensions: dimensions.assumed,
  };
}

function cellsForBrick(brick) {
  const bounds = boundsForBrick(brick);

  if (
    !bounds ||
    !Number.isInteger(bounds.minX) ||
    !Number.isInteger(bounds.minY) ||
    !Number.isInteger(bounds.minZ) ||
    !Number.isInteger(bounds.maxX) ||
    !Number.isInteger(bounds.maxY) ||
    !Number.isInteger(bounds.maxZ)
  ) {
    return [];
  }

  const cells = [];

  for (let x = bounds.minX; x < bounds.maxX; x += 1) {
    for (let y = bounds.minY; y < bounds.maxY; y += 1) {
      for (let z = bounds.minZ; z < bounds.maxZ; z += 1) {
        cells.push({ x, y, z });
      }
    }
  }

  return cells;
}

function axisGap(firstMin, firstMax, secondMin, secondMax) {
  if (firstMax < secondMin) {
    return secondMin - firstMax;
  }

  if (secondMax < firstMin) {
    return firstMin - secondMax;
  }

  return 0;
}

function truncateText(text, maxLength) {
  if (typeof text !== "string" || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function sortedIds(ids) {
  return [...ids].sort((first, second) => first.localeCompare(second));
}

function summarizeStructureFeatures(features = []) {
  return features.map((feature) =>
    compactObject({
      name: feature.name,
      visual_goal: feature.visual_goal,
      priority: feature.priority,
      preferred_colors: feature.preferred_colors,
      approximate_piece_budget: feature.approximate_piece_budget,
    }),
  );
}

function summarizePartUsagePlan(partUsagePlan = []) {
  return partUsagePlan.map((plan) =>
    compactObject({
      feature: plan.feature,
      allowed_part_ids: plan.allowed_part_ids,
      allowed_color_ids: plan.allowed_color_ids,
      max_pieces: plan.max_pieces,
      notes: plan.notes,
    }),
  );
}

export function summarizeStructurePlan(structurePlan = {}) {
  return compactObject({
    model_name: structurePlan.model_name,
    primary_object: structurePlan.primary_object,
    target_piece_count: structurePlan.target_piece_count,
    overall_shape: structurePlan.overall_shape,
    required_features: Array.isArray(structurePlan.required_features)
      ? summarizeStructureFeatures(structurePlan.required_features)
      : undefined,
    part_usage_plan: Array.isArray(structurePlan.part_usage_plan)
      ? summarizePartUsagePlan(structurePlan.part_usage_plan)
      : undefined,
    build_strategy: structurePlan.build_strategy
      ? compactObject({
        base: structurePlan.build_strategy.base,
        body: structurePlan.build_strategy.body,
        raised_details: structurePlan.build_strategy.raised_details,
        stability_notes: structurePlan.build_strategy.stability_notes,
      })
      : undefined,
    fallback_priorities: structurePlan.fallback_priorities,
    user_facing_summary: structurePlan.user_facing_summary,
  });
}

export function summarizeModelBounds(model = {}) {
  const bricks = bricksFromModel(model);

  if (bricks.length === 0) {
    return compactObject({
      model_name: model.model_name,
      piece_count: 0,
      reported_piece_count: model.piece_count,
      bounds: null,
    });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const assumedDimensionBrickIds = [];

  for (const brick of bricks) {
    const bounds = boundsForBrick(brick);

    if (!bounds) {
      continue;
    }

    minX = Math.min(minX, bounds.minX);
    maxX = Math.max(maxX, bounds.maxX);
    minY = Math.min(minY, bounds.minY);
    maxY = Math.max(maxY, bounds.maxY);
    minZ = Math.min(minZ, bounds.minZ);
    maxZ = Math.max(maxZ, bounds.maxZ);

    if (bounds.assumedDimensions) {
      const id = brickKey(brick);

      if (id) {
        assumedDimensionBrickIds.push(id);
      }
    }
  }

  const hasBounds = Number.isFinite(minX) &&
    Number.isFinite(maxX) &&
    Number.isFinite(minY) &&
    Number.isFinite(maxY) &&
    Number.isFinite(minZ) &&
    Number.isFinite(maxZ);

  return compactObject({
    model_name: model.model_name,
    piece_count: bricks.length,
    reported_piece_count: model.piece_count,
    reported_dimensions: model.dimensions,
    bounds: hasBounds
      ? {
        min_x: minX,
        max_x_exclusive: maxX,
        min_y: minY,
        max_y_exclusive: maxY,
        min_z: minZ,
        max_z_exclusive: maxZ,
        width_studs: maxX - minX,
        depth_studs: maxY - minY,
        height_layers: maxZ - minZ,
      }
      : null,
    assumed_dimension_brick_ids: assumedDimensionBrickIds.length > 0
      ? assumedDimensionBrickIds
      : undefined,
  });
}

export function collectInvalidBrickIds(
  validationErrors = [],
  bricks = [],
  explicitInvalidBrickIds = [],
) {
  const ids = new Set();

  addIdsFromValue(ids, explicitInvalidBrickIds);

  for (const error of validationErrors ?? []) {
    addId(ids, error?.brick_instance_id);
    addId(ids, error?.brick_id);
    addIdsFromValue(ids, error?.brick_ids);
    addIdsFromValue(ids, error?.component_brick_ids);

    if (error?.part_id != null && error?.color_id != null) {
      for (const brick of bricks) {
        if (
          String(brick?.part_id) === String(error.part_id) &&
          String(brick?.color_id) === String(error.color_id)
        ) {
          addId(ids, brick?.id);
        }
      }
    }
  }

  if (ids.size === 0 && validationErrors?.some((error) => error?.type === "no_ground_contact")) {
    let minZ = Infinity;

    for (const brick of bricks) {
      const bounds = boundsForBrick(brick);

      if (bounds) {
        minZ = Math.min(minZ, bounds.minZ);
      }
    }

    for (const brick of bricks) {
      const bounds = boundsForBrick(brick);

      if (bounds?.minZ === minZ) {
        addId(ids, brick?.id);
      }
    }
  }

  return sortedIds(ids);
}

export function summarizeRemainingInventory(inventory = {}, model = {}) {
  const available = new Map();
  const labels = new Map();
  const used = new Map();

  for (const item of inventory.items ?? []) {
    if (!item.supported || !SUPPORTED_PARTS[item.part_id]) {
      continue;
    }

    const key = inventoryKey(item.part_id, item.color_id);
    available.set(key, (available.get(key) ?? 0) + item.count);

    if (!labels.has(key)) {
      labels.set(key, {
        part_id: item.part_id,
        color_id: item.color_id,
        label: item.label,
        ldraw_id: item.ldraw_id,
        color_name: item.color_name,
      });
    }
  }

  for (const brick of bricksFromModel(model)) {
    if (brick?.part_id == null || brick?.color_id == null) {
      continue;
    }

    const key = inventoryKey(brick.part_id, brick.color_id);
    used.set(key, (used.get(key) ?? 0) + 1);

    if (!labels.has(key)) {
      labels.set(key, {
        part_id: brick.part_id,
        color_id: brick.color_id,
        label: brick.label,
        ldraw_id: brick.ldraw_id,
        color_name: brick.color_name,
      });
    }
  }

  return [...new Set([...available.keys(), ...used.keys()])]
    .sort((first, second) => first.localeCompare(second))
    .map((key) => {
      const item = labels.get(key) ?? {};
      const availableCount = available.get(key) ?? 0;
      const usedCount = used.get(key) ?? 0;

      return compactObject({
        part_id: item.part_id,
        color_id: item.color_id,
        label: item.label,
        ldraw_id: item.ldraw_id,
        color_name: item.color_name,
        available: availableCount,
        used: usedCount,
        remaining: availableCount - usedCount,
      });
    });
}

function collectErrorBrickIds(error) {
  const ids = new Set();

  addId(ids, error?.brick_instance_id);
  addId(ids, error?.brick_id);
  addIdsFromValue(ids, error?.brick_ids);
  addIdsFromValue(ids, error?.component_brick_ids);

  return sortedIds(ids);
}

export function summarizeValidationErrors(validationErrors = [], limits = {}) {
  const mergedLimits = { ...DEFAULT_LIMITS, ...limits };
  const groups = new Map();

  for (const error of validationErrors ?? []) {
    const key = [
      error?.type ?? "unknown",
      error?.severity ?? "",
      error?.part_id ?? "",
      error?.color_id ?? "",
      error?.available ?? "",
      error?.used ?? "",
    ].join("|");

    if (!groups.has(key)) {
      groups.set(key, {
        type: error?.type ?? "unknown",
        severity: error?.severity,
        count: 0,
        brick_ids: new Set(),
        part_id: error?.part_id,
        color_id: error?.color_id,
        available: error?.available,
        used: error?.used,
        message: truncateText(error?.message, mergedLimits.maxValidationMessageLength),
      });
    }

    const group = groups.get(key);
    group.count += 1;

    for (const id of collectErrorBrickIds(error)) {
      group.brick_ids.add(id);
    }
  }

  return [...groups.values()].map((group) => {
    const brickIds = sortedIds(group.brick_ids);

    return compactObject({
      type: group.type,
      severity: group.severity,
      count: group.count,
      brick_ids: brickIds.length > 0
        ? brickIds.slice(0, mergedLimits.maxValidationSummaryBrickIds)
        : undefined,
      omitted_brick_id_count: Math.max(
        0,
        brickIds.length - mergedLimits.maxValidationSummaryBrickIds,
      ) || undefined,
      part_id: group.part_id,
      color_id: group.color_id,
      available: group.available,
      used: group.used,
      message: group.message,
    });
  });
}

function relationPriority(reasons) {
  if (reasons.has("overlaps_invalid_brick")) {
    return 0;
  }

  if (reasons.has("supports_invalid_brick")) {
    return 1;
  }

  if (reasons.has("supported_by_invalid_brick")) {
    return 2;
  }

  return 3;
}

function addRelatedBrick(relatedById, candidate, invalidId, reason) {
  const id = brickKey(candidate);

  if (!id || id === invalidId) {
    return;
  }

  if (!relatedById.has(id)) {
    relatedById.set(id, {
      brick: candidate,
      invalidBrickIds: new Set(),
      reasons: new Set(),
    });
  }

  const related = relatedById.get(id);
  related.invalidBrickIds.add(invalidId);
  related.reasons.add(reason);
}

function horizontalAndVerticalGap(firstBounds, secondBounds) {
  return {
    horizontal: Math.max(
      axisGap(firstBounds.minX, firstBounds.maxX, secondBounds.minX, secondBounds.maxX),
      axisGap(firstBounds.minY, firstBounds.maxY, secondBounds.minY, secondBounds.maxY),
    ),
    vertical: axisGap(firstBounds.minZ, firstBounds.maxZ, secondBounds.minZ, secondBounds.maxZ),
  };
}

function addRelationsForInvalidBrick({
  invalidBrick,
  candidates,
  relatedById,
  nearbyStudRadius,
}) {
  const invalidId = brickKey(invalidBrick);
  const invalidBounds = boundsForBrick(invalidBrick);
  const invalidCells = cellsForBrick(invalidBrick);
  const invalidCellKeys = new Set(invalidCells.map(cellKey));

  if (!invalidId || !invalidBounds) {
    return;
  }

  for (const candidate of candidates) {
    const candidateId = brickKey(candidate);

    if (!candidateId || candidateId === invalidId) {
      continue;
    }

    const candidateBounds = boundsForBrick(candidate);

    if (!candidateBounds) {
      continue;
    }

    const candidateCells = cellsForBrick(candidate);
    const candidateCellKeys = new Set(candidateCells.map(cellKey));
    let hasCellRelation = false;

    for (const cell of invalidCells) {
      if (candidateCellKeys.has(cellKey(cell))) {
        addRelatedBrick(relatedById, candidate, invalidId, "overlaps_invalid_brick");
        hasCellRelation = true;
      }

      if (candidateCellKeys.has(cellKey({ x: cell.x, y: cell.y, z: cell.z - 1 }))) {
        addRelatedBrick(relatedById, candidate, invalidId, "supports_invalid_brick");
        hasCellRelation = true;
      }

      if (candidateCellKeys.has(cellKey({ x: cell.x, y: cell.y, z: cell.z + 1 }))) {
        addRelatedBrick(relatedById, candidate, invalidId, "supported_by_invalid_brick");
        hasCellRelation = true;
      }
    }

    if (!hasCellRelation) {
      for (const cell of candidateCells) {
        if (invalidCellKeys.has(cellKey(cell))) {
          addRelatedBrick(relatedById, candidate, invalidId, "overlaps_invalid_brick");
          hasCellRelation = true;
          break;
        }
      }
    }

    if (hasCellRelation) {
      continue;
    }

    const gap = horizontalAndVerticalGap(invalidBounds, candidateBounds);

    if (gap.horizontal <= nearbyStudRadius && gap.vertical <= 1) {
      addRelatedBrick(relatedById, candidate, invalidId, "near_invalid_brick");
    }
  }
}

export function collectNearbyOrSupportingBricks({
  invalidBricks = [],
  currentModel = {},
  candidateModels = [],
  limits = {},
} = {}) {
  const mergedLimits = { ...DEFAULT_LIMITS, ...limits };
  const candidates = uniqueBricksFromModels([currentModel, ...candidateModels]);
  const relatedById = new Map();

  for (const invalidBrick of invalidBricks) {
    addRelationsForInvalidBrick({
      invalidBrick,
      candidates,
      relatedById,
      nearbyStudRadius: mergedLimits.nearbyStudRadius,
    });
  }

  const relatedBricks = [...relatedById.values()]
    .sort((first, second) => {
      const priorityDiff = relationPriority(first.reasons) - relationPriority(second.reasons);

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const firstStep = first.brick.step ?? Number.MAX_SAFE_INTEGER;
      const secondStep = second.brick.step ?? Number.MAX_SAFE_INTEGER;

      if (firstStep !== secondStep) {
        return firstStep - secondStep;
      }

      return String(first.brick.id).localeCompare(String(second.brick.id));
    })
    .map((related) => ({
      invalid_brick_ids: sortedIds(related.invalidBrickIds),
      relationship: [...related.reasons].sort(),
      brick: sanitizeBrickRecord(related.brick),
    }));

  return {
    bricks: relatedBricks.slice(0, mergedLimits.maxNearbyOrSupportingBricks),
    omitted_count: Math.max(
      0,
      relatedBricks.length - mergedLimits.maxNearbyOrSupportingBricks,
    ),
  };
}

function resolveCurrentModel({
  currentModel,
  prunedModel,
  cleanedModel,
  invalidModel,
} = {}) {
  return currentModel ?? prunedModel ?? cleanedModel ?? invalidModel ?? {};
}

function targetObjectFor({ targetObject, structurePlan, currentModel, invalidModel }) {
  return targetObject ??
    structurePlan?.primary_object ??
    currentModel?.model_name ??
    invalidModel?.model_name;
}

export function buildCompactRepairContext({
  userPrompt,
  targetObject,
  structurePlan = {},
  inventory = {},
  currentModel,
  cleanedModel,
  prunedModel,
  invalidModel,
  originalModel,
  originalFailedModel,
  validationErrors = [],
  invalidBrickIds = [],
  targetPieceCount,
  limits = {},
} = {}) {
  const resolvedCurrentModel = resolveCurrentModel({
    currentModel,
    prunedModel,
    cleanedModel,
    invalidModel,
  });
  const recordModels = [
    invalidModel,
    originalFailedModel,
    originalModel,
    resolvedCurrentModel,
    prunedModel,
    cleanedModel,
  ];
  const candidateBricks = uniqueBricksFromModels(recordModels);
  const invalidIds = collectInvalidBrickIds(
    validationErrors,
    candidateBricks,
    invalidBrickIds,
  );
  const brickRecordsById = brickMapFromModels(recordModels);
  const invalidBricks = invalidIds
    .map((id) => brickRecordsById.get(id))
    .filter(Boolean);
  const related = collectNearbyOrSupportingBricks({
    invalidBricks,
    currentModel: resolvedCurrentModel,
    candidateModels: [invalidModel, originalFailedModel],
    limits,
  });

  return compactObject({
    user_prompt: userPrompt,
    target_object: targetObjectFor({
      targetObject,
      structurePlan,
      currentModel: resolvedCurrentModel,
      invalidModel,
    }),
    target_piece_count: targetPieceCount ?? structurePlan?.target_piece_count,
    structure_summary: summarizeStructurePlan(structurePlan),
    current_model_bounds: summarizeModelBounds(resolvedCurrentModel),
    invalid_brick_ids: invalidIds,
    invalid_bricks: invalidBricks.map(sanitizeBrickRecord),
    nearby_or_supporting_bricks: related.bricks,
    nearby_or_supporting_bricks_omitted_count: related.omitted_count || undefined,
    remaining_inventory: summarizeRemainingInventory(inventory, resolvedCurrentModel),
    validation_error_summary: summarizeValidationErrors(validationErrors, limits),
  });
}
