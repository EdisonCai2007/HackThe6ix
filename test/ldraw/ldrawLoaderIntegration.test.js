import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LDrawLoader } from "three/examples/jsm/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/examples/jsm/materials/LDrawConditionalLineMaterial.js";

import { buildBlockyGlobeModel } from "../../src/generation/fixtures/blockyGlobeModel.js";
import { buildCampfireModel } from "../../src/generation/fixtures/campfireModel.js";
import { buildLighthouseModel } from "../../src/generation/fixtures/lighthouseModel.js";
import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { exportModelToLDraw } from "../../src/ldraw/exportLDraw.js";

function parseLDraw(text) {
  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);

  return new Promise((resolve, reject) => {
    loader.parse(text, resolve, reject);
  });
}

describe("LDrawLoader integration", () => {
  it("parses the packed lighthouse without a parts-library path", async () => {
    const model = buildLighthouseModel(randomBuildInventory);
    const ldraw = exportModelToLDraw(model);

    const group = await parseLDraw(ldraw);

    assert.equal(group.type, "Group");
    assert.equal(group.children.length, model.bricks.length);
  });

  it("parses the packed blocky globe without a parts-library path", async () => {
    const model = buildBlockyGlobeModel(randomBuildInventory);
    const ldraw = exportModelToLDraw(model);

    const group = await parseLDraw(ldraw);

    assert.equal(group.type, "Group");
    assert.equal(group.children.length, model.bricks.length);
  });

  it("parses the packed campfire without a parts-library path", async () => {
    const model = buildCampfireModel(randomBuildInventory);
    const ldraw = exportModelToLDraw(model);

    const group = await parseLDraw(ldraw);

    assert.equal(group.type, "Group");
    assert.equal(group.children.length, model.bricks.length);
  });

});
