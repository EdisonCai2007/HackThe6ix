import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LDrawLoader } from "three/examples/jsm/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/examples/jsm/materials/LDrawConditionalLineMaterial.js";

import { buildSmallDuckModel } from "../../src/generation/fixtures/smallDuckModel.js";
import { duckInventory } from "../../src/generation/fixtures/duckInventory.js";
import { buildSandcastleModel } from "../../src/generation/fixtures/sandcastleModel.js";
import { sandcastleInventory } from "../../src/generation/fixtures/sandcastleInventory.js";
import { buildHouseFlyModel } from "../../src/generation/fixtures/houseFlyModel.js";
import { houseFlyInventory } from "../../src/generation/fixtures/houseFlyInventory.js";
import { buildDaisyModel } from "../../src/generation/fixtures/daisyModel.js";
import { daisyInventory } from "../../src/generation/fixtures/daisyInventory.js";
import { buildHorseModel } from "../../src/generation/fixtures/horseModel.js";
import { horseInventory } from "../../src/generation/fixtures/horseInventory.js";
import { exportModelToLDraw } from "../../src/ldraw/exportLDraw.js";

function parseLDraw(text) {
  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);

  return new Promise((resolve, reject) => {
    loader.parse(text, resolve, reject);
  });
}

describe("LDrawLoader integration", () => {
  it("parses the packed small duck without a parts-library path", async () => {
    const model = buildSmallDuckModel(duckInventory);
    const ldraw = exportModelToLDraw(model);

    const group = await parseLDraw(ldraw);

    assert.equal(group.type, "Group");
    assert.equal(group.children.length, model.bricks.length);
  });

  it("parses the packed sandcastle without a parts-library path", async () => {
    const model = buildSandcastleModel(sandcastleInventory);
    const ldraw = exportModelToLDraw(model);

    const group = await parseLDraw(ldraw);

    assert.equal(group.type, "Group");
    assert.equal(group.children.length, model.bricks.length);
  });

  it("parses the packed house fly without a parts-library path", async () => {
    const model = buildHouseFlyModel(houseFlyInventory);
    const ldraw = exportModelToLDraw(model);

    const group = await parseLDraw(ldraw);

    assert.equal(group.type, "Group");
    assert.equal(group.children.length, model.bricks.length);
  });

  it("parses the packed daisy without a parts-library path", async () => {
    const model = buildDaisyModel(daisyInventory);
    const ldraw = exportModelToLDraw(model);

    const group = await parseLDraw(ldraw);

    assert.equal(group.type, "Group");
    assert.equal(group.children.length, model.bricks.length);
  });

  it("parses the packed horse without a parts-library path", async () => {
    const model = buildHorseModel(horseInventory);
    const ldraw = exportModelToLDraw(model);

    const group = await parseLDraw(ldraw);

    assert.equal(group.type, "Group");
    assert.equal(group.children.length, model.bricks.length);
  });
});
