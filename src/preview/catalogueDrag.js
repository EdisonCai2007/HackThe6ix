import {
  findDropZForFootprint,
  snapGridPosition,
} from "./editorGeometry.js";
import { addBrickFromCatalogue } from "./editorState.js";

export const CATALOGUE_PREVIEW_BRICK_ID = "catalogue-drag-preview";

export function createCataloguePreviewBrick(model, inventoryItem, draftPosition) {
  const horizontalPosition = snapGridPosition(draftPosition);
  const draftBrick = {
    id: CATALOGUE_PREVIEW_BRICK_ID,
    part_id: inventoryItem.part_id,
    ldraw_id: inventoryItem.ldraw_id,
    label: inventoryItem.label,
    color_id: inventoryItem.color_id,
    color_name: inventoryItem.color_name,
    position: horizontalPosition,
    rotation: 0,
    feature: "catalogue-drag-preview",
    step: Math.max(1, ...model.bricks.map((existing) => existing.step ?? 1)),
    preview: true,
  };

  return {
    ...draftBrick,
    position: {
      ...horizontalPosition,
      z: findDropZForFootprint(draftBrick, model.bricks),
    },
  };
}

export function commitCataloguePreview(model, inventoryItem, previewBrick) {
  const nextModel = addBrickFromCatalogue(
    model,
    inventoryItem,
    previewBrick.position,
  );
  const addedBrick = nextModel.bricks.at(-1);

  return {
    model: nextModel,
    brickId: addedBrick?.id ?? null,
  };
}
