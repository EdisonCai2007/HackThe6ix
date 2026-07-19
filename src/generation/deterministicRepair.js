import { validateModel } from "./validator.js";

function removedBrickFor(brick, reason, message, metadata = {}) {
  return {
    id: brick.id,
    feature: brick.feature,
    part_id: brick.part_id,
    color_id: brick.color_id,
    reason,
    message,
    metadata,
  };
}

function modelWithBricks(model, bricks) {
  if (bricks.length === model.bricks.length) {
    return model;
  }

  return {
    ...model,
    piece_count: bricks.length,
    bricks,
  };
}

function floatingBrickIds(validation) {
  return new Set(
    validation.errors
      .filter((error) => error.type === "floating_brick" && error.brick_instance_id)
      .map((error) => error.brick_instance_id),
  );
}

function removeUnsupportedFloatingBricks(model, inventory, initialValidation) {
  let currentModel = model;
  let currentValidation = initialValidation;
  const removedBricks = [];
  const removedBrickIds = [];
  let iterations = 0;

  while (true) {
    const idsToRemove = floatingBrickIds(currentValidation);

    if (idsToRemove.size === 0) {
      break;
    }

    const kept = [];
    const removedThisPass = [];

    for (const brick of currentModel.bricks) {
      if (idsToRemove.has(brick.id)) {
        removedThisPass.push(brick);
      } else {
        kept.push(brick);
      }
    }

    if (removedThisPass.length === 0) {
      break;
    }

    iterations += 1;

    for (const brick of removedThisPass) {
      removedBrickIds.push(brick.id);
      removedBricks.push(
        removedBrickFor(
          brick,
          "floating_brick",
          `${brick.id} is above the ground layer without support underneath.`,
          {
            action: "remove_unsupported_floating_bricks",
            validation_error_type: "floating_brick",
            iteration: iterations,
          },
        ),
      );
    }

    currentModel = modelWithBricks(currentModel, kept);
    currentValidation = validateModel(currentModel, inventory);
  }

  return {
    model: currentModel,
    removedBricks,
    validationAfter: currentValidation,
    actions: removedBrickIds.length > 0
      ? [
        {
          action: "remove_unsupported_floating_bricks",
          reason: "floating_brick",
          validation_error_types: ["floating_brick"],
          removedBrickIds,
          iterations,
        },
      ]
      : [],
  };
}

function firstModelIndexByBrickId(model) {
  const indexById = new Map();

  model.bricks.forEach((brick, index) => {
    if (!indexById.has(brick.id)) {
      indexById.set(brick.id, index);
    }
  });

  return indexById;
}

function selectMainComponent(components, model) {
  const indexById = firstModelIndexByBrickId(model);

  return [...components].sort((first, second) => {
    if (second.length !== first.length) {
      return second.length - first.length;
    }

    const firstIndex = Math.min(...first.map((id) => indexById.get(id) ?? Infinity));
    const secondIndex = Math.min(...second.map((id) => indexById.get(id) ?? Infinity));

    return firstIndex - secondIndex;
  })[0];
}

function keepLargestConnectedComponent(model, inventory, initialValidation) {
  const disconnectedError = initialValidation.errors.find(
    (error) => error.type === "disconnected_component",
  );
  const components = disconnectedError?.component_brick_ids;

  if (!Array.isArray(components) || components.length <= 1) {
    return {
      model,
      removedBricks: [],
      validationAfter: initialValidation,
      actions: [],
    };
  }

  const mainComponent = selectMainComponent(components, model);
  const removedComponentIds = new Set(
    components
      .filter((component) => component !== mainComponent)
      .flat(),
  );
  const kept = [];
  const removed = [];

  for (const brick of model.bricks) {
    if (removedComponentIds.has(brick.id)) {
      removed.push(brick);
    } else {
      kept.push(brick);
    }
  }

  if (removed.length === 0) {
    return {
      model,
      removedBricks: [],
      validationAfter: initialValidation,
      actions: [],
    };
  }

  const removedBricks = removed.map((brick) =>
    removedBrickFor(
      brick,
      "disconnected_component",
      `${brick.id} is outside the main connected component.`,
      {
        action: "keep_largest_connected_component",
        validation_error_type: "disconnected_component",
        kept_component_brick_ids: mainComponent,
      },
    ),
  );
  const cleanedModel = modelWithBricks(model, kept);

  return {
    model: cleanedModel,
    removedBricks,
    validationAfter: validateModel(cleanedModel, inventory),
    actions: [
      {
        action: "keep_largest_connected_component",
        reason: "disconnected_component",
        validation_error_types: ["disconnected_component"],
        keptBrickIds: mainComponent,
        removedBrickIds: removed.map((brick) => brick.id),
        componentCount: components.length,
        componentBrickIds: components,
      },
    ],
  };
}

/**
 * Locally remove only obvious invalid geometry that the deterministic validator
 * already reports. This helper is intentionally not wired into generation yet.
 *
 * @param {import("./types.js").GeneratedModel} model
 * @param {import("./types.js").Inventory} inventory
 */
export function cleanupObviousInvalidGeometry(model, inventory) {
  const validationBefore = validateModel(model, inventory);

  if (validationBefore.valid) {
    return {
      model,
      removedBricks: [],
      validationBefore,
      validationAfter: validationBefore,
      reasonMetadata: {
        preservedAlreadyValid: true,
        actions: [
          {
            action: "preserve_already_valid_model",
            reason: "already_valid",
            validation_error_types: [],
            removedBrickIds: [],
          },
        ],
      },
    };
  }

  const floatingCleanup = removeUnsupportedFloatingBricks(
    model,
    inventory,
    validationBefore,
  );
  const componentCleanup = keepLargestConnectedComponent(
    floatingCleanup.model,
    inventory,
    floatingCleanup.validationAfter,
  );

  return {
    model: componentCleanup.model,
    removedBricks: [
      ...floatingCleanup.removedBricks,
      ...componentCleanup.removedBricks,
    ],
    validationBefore,
    validationAfter: componentCleanup.validationAfter,
    reasonMetadata: {
      preservedAlreadyValid: false,
      actions: [
        ...floatingCleanup.actions,
        ...componentCleanup.actions,
      ],
    },
  };
}
