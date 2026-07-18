import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOGUE_PREVIEW_BRICK_ID,
  commitCataloguePreview,
  createCataloguePreviewBrick,
} from "../../src/preview/catalogueDrag.js";
import { catalogueItemsForModel } from "../../src/preview/editorState.js";

const inventoryItem = {
  label: "1x1 brick",
  category: "brick",
  part_id: "3005",
  ldraw_id: "3005.dat",
  color_name: "red",
  color_id: "4",
  count: 2,
  supported: true,
};

function modelWith(bricks) {
  return {
    model_name: "Test",
    prompt: "test",
    piece_count: bricks.length,
    dimensions: { width_studs: 0, depth_studs: 0, height_layers: 0 },
    created_from_inventory_id: "test",
    generator_version: "test",
    notes: [],
    bricks,
  };
}

test("createCataloguePreviewBrick stacks a temporary brick without changing inventory usage", () => {
  const base = {
    id: "base",
    part_id: "3005",
    ldraw_id: "3005.dat",
    label: "1x1 brick",
    color_id: "14",
    color_name: "yellow",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    feature: "base",
    step: 1,
  };
  const model = modelWith([base]);

  const preview = createCataloguePreviewBrick(model, inventoryItem, {
    x: 0.2,
    y: -0.2,
    z: 0,
  });

  assert.equal(preview.id, CATALOGUE_PREVIEW_BRICK_ID);
  assert.equal(preview.feature, "catalogue-drag-preview");
  assert.deepEqual(preview.position, { x: 0, y: 0, z: 3 });
  assert.equal(model.bricks.length, 1);
  assert.equal(model.piece_count, 1);
  assert.equal(catalogueItemsForModel({ inventory_id: "test", items: [inventoryItem] }, model)[0].remaining, 2);
});

test("commitCataloguePreview adds the preview position as a real selected brick", () => {
  const model = modelWith([]);
  const preview = createCataloguePreviewBrick(model, inventoryItem, {
    x: 1.8,
    y: 2.2,
    z: 0,
  });

  const result = commitCataloguePreview(model, inventoryItem, preview);

  assert.equal(result.model.piece_count, 1);
  assert.equal(result.brickId, result.model.bricks[0].id);
  assert.notEqual(result.brickId, CATALOGUE_PREVIEW_BRICK_ID);
  assert.deepEqual(result.model.bricks[0].position, { x: 2, y: 2, z: 0 });
  assert.equal(catalogueItemsForModel({ inventory_id: "test", items: [inventoryItem] }, result.model)[0].remaining, 1);
});
