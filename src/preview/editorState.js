import { validateModel } from "../generation/validator.js";
import { getPartDimensions } from "../generation/partCatalog.js";
import {
  findDropZForFootprint,
  normalizedRotation,
  snapGridPosition,
} from "./editorGeometry.js";

export function inventoryKey(partId, colorId) {
  return `${partId}:${colorId}`;
}

function cloneModel(model, bricks) {
  return {
    ...model,
    piece_count: bricks.length,
    bricks,
  };
}

function usageForModel(model) {
  const usage = new Map();

  for (const brick of model.bricks) {
    const key = inventoryKey(brick.part_id, brick.color_id);
    usage.set(key, (usage.get(key) ?? 0) + 1);
  }

  return usage;
}

export function catalogueItemsForModel(inventory, model) {
  const usage = usageForModel(model);
  const availableItems = [];
  const exhaustedItems = [];
  const supportedItems = inventory.items.filter((item) => item.supported);

  for (const item of supportedItems) {
    const key = inventoryKey(item.part_id, item.color_id);
    const used = usage.get(key) ?? 0;
    const remaining = Math.max(0, item.count - used);
    const catalogueItem = {
      key,
      label: item.label,
      category: item.category,
      part_id: item.part_id,
      ldraw_id: item.ldraw_id,
      color_id: item.color_id,
      color_name: item.color_name,
      count: item.count,
      used,
      remaining,
      disabled: remaining === 0,
      supported: item.supported,
    };

    if (remaining > 0) {
      availableItems.push(catalogueItem);
    } else {
      exhaustedItems.push(catalogueItem);
    }
  }

  return [...availableItems, ...exhaustedItems];
}

function nextBrickId(model, partId) {
  let index = model.bricks.length + 1;
  let id = `editor-${partId}-${index}`;

  while (model.bricks.some((brick) => brick.id === id)) {
    index += 1;
    id = `editor-${partId}-${index}`;
  }

  return id;
}

export function addBrickFromCatalogue(model, inventoryItem, draftPosition) {
  const brick = {
    id: nextBrickId(model, inventoryItem.part_id),
    part_id: inventoryItem.part_id,
    ldraw_id: inventoryItem.ldraw_id,
    label: inventoryItem.label,
    color_id: inventoryItem.color_id,
    color_name: inventoryItem.color_name,
    position: snapGridPosition(draftPosition),
    rotation: 0,
    feature: "editor-added",
    step: Math.max(1, ...model.bricks.map((existing) => existing.step ?? 1)),
  };

  return cloneModel(model, [...model.bricks, brick]);
}

export function moveBrick(model, brickId, position, options = {}) {
  const bricks = model.bricks.map((brick) => {
    if (brick.id !== brickId) {
      return brick;
    }

    const nextPosition = options.snap ? snapGridPosition(position) : position;
    const draftBrick = { ...brick, position: nextPosition };

    return {
      ...draftBrick,
      position: options.stackOnDrop
        ? { ...nextPosition, z: findDropZForFootprint(draftBrick, model.bricks) }
        : nextPosition,
    };
  });

  return cloneModel(model, bricks);
}

export function brickWithRotationPreservingCenter(brick, nextRotation) {
  const rotation = normalizedRotation(nextRotation);

  if (rotation === null) {
    return brick;
  }

  const oldDimensions = getPartDimensions(brick.part_id, brick.rotation);
  const newDimensions = getPartDimensions(brick.part_id, rotation);

  return {
    ...brick,
    position: oldDimensions && newDimensions
      ? {
        x: brick.position.x + oldDimensions.width / 2 - newDimensions.width / 2,
        y: brick.position.y + oldDimensions.depth / 2 - newDimensions.depth / 2,
        z: brick.position.z,
      }
      : brick.position,
    rotation,
  };
}

export function rotateBrickToRotation(model, brickId, nextRotation) {
  return cloneModel(
    model,
    model.bricks.map((brick) => {
      if (brick.id !== brickId) {
        return brick;
      }

      return brickWithRotationPreservingCenter(brick, nextRotation);
    }),
  );
}

export function rotateBrickQuarterTurn(model, brickId) {
  const brick = model.bricks.find((candidate) => candidate.id === brickId);
  return brick ? rotateBrickToRotation(model, brickId, brick.rotation + 90) : model;
}

export function removeBrick(model, brickId) {
  return cloneModel(
    model,
    model.bricks.filter((brick) => brick.id !== brickId),
  );
}

export function validateForInstructions(model, inventory) {
  return validateModel(model, inventory);
}
