import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSmallDuckModel } from "../../src/generation/fixtures/smallDuckModel.js";
import { duckInventory } from "../../src/generation/fixtures/duckInventory.js";
import { exportModelToLDraw } from "../../src/ldraw/exportLDraw.js";

describe("exportModelToLDraw", () => {
  it("exports a brick directly on top of a plate without a brick-height gap", () => {
    const model = {
      model_name: "Plate Stack",
      prompt: "stack a brick on a plate",
      piece_count: 2,
      dimensions: { width_studs: 2, depth_studs: 4, height_layers: 4 },
      created_from_inventory_id: "test",
      generator_version: "test",
      bricks: [
        {
          id: "base-plate",
          part_id: "3020",
          ldraw_id: "3020.dat",
          label: "2x4 plate",
          color_id: "14",
          color_name: "yellow",
          position: { x: 0, y: 0, z: 0 },
          rotation: 0,
          feature: "base",
          step: 1,
        },
        {
          id: "top-brick",
          part_id: "3001",
          ldraw_id: "3001.dat",
          label: "2x4 brick",
          color_id: "14",
          color_name: "yellow",
          position: { x: 0, y: 0, z: 1 },
          rotation: 0,
          feature: "body",
          step: 2,
        },
      ],
      notes: [],
    };

    const ldraw = exportModelToLDraw(model);

    assert.match(ldraw, /^1 14 20 -4 40 1 0 0 0 1 0 0 0 1 3020\.dat$/m);
    assert.match(ldraw, /^1 14 20 -20 40 1 0 0 0 1 0 0 0 1 3001\.dat$/m);
  });

  it("exports larger 4x8 plate geometry as an embedded part", () => {
    const model = {
      model_name: "Large Plate",
      prompt: "single large plate",
      piece_count: 1,
      dimensions: { width_studs: 8, depth_studs: 4, height_layers: 1 },
      created_from_inventory_id: "test",
      generator_version: "test",
      bricks: [
        {
          id: "large-plate",
          part_id: "3035",
          ldraw_id: "3035.dat",
          label: "4x8 plate",
          color_id: "4",
          color_name: "red",
          position: { x: 0, y: 0, z: 0 },
          rotation: 90,
          feature: "base",
          step: 1,
        },
      ],
      notes: [],
    };

    const ldraw = exportModelToLDraw(model);

    assert.match(ldraw, /^1 4 80 -4 40 0 0 1 0 1 0 -1 0 0 3035\.dat$/m);
    assert.match(ldraw, /^0 FILE 3035\.dat$/m);
    assert.match(ldraw, /^4 16 -40 -4 -80 40 -4 -80 40 -4 80 -40 -4 80$/m);
  });

  it("exports a 4x6 plate as an embedded part", () => {
    const model = {
      model_name: "4x6 Plate",
      prompt: "single 4x6 plate",
      piece_count: 1,
      dimensions: { width_studs: 4, depth_studs: 6, height_layers: 1 },
      created_from_inventory_id: "test",
      generator_version: "test",
      bricks: [
        {
          id: "four-by-six-plate",
          part_id: "3032",
          ldraw_id: "3032.dat",
          label: "4x6 plate",
          color_id: "4",
          color_name: "red",
          position: { x: 0, y: 0, z: 0 },
          rotation: 0,
          feature: "base",
          step: 1,
        },
      ],
      notes: [],
    };

    const ldraw = exportModelToLDraw(model);

    assert.match(ldraw, /^1 4 40 -4 60 1 0 0 0 1 0 0 0 1 3032\.dat$/m);
    assert.match(ldraw, /^0 FILE 3032\.dat$/m);
    assert.match(ldraw, /^4 16 -40 -4 -60 40 -4 -60 40 -4 60 -40 -4 60$/m);
  });

  it("exports longer 1-wide bricks and plates as embedded parts", () => {
    const model = {
      model_name: "Long 1-wide parts",
      prompt: "single row long parts",
      piece_count: 2,
      dimensions: { width_studs: 8, depth_studs: 2, height_layers: 4 },
      created_from_inventory_id: "test",
      generator_version: "test",
      bricks: [
        {
          id: "one-by-six-plate",
          part_id: "3666",
          ldraw_id: "3666.dat",
          label: "1x6 plate",
          color_id: "14",
          color_name: "yellow",
          position: { x: 0, y: 0, z: 0 },
          rotation: 90,
          feature: "base",
          step: 1,
        },
        {
          id: "one-by-eight-brick",
          part_id: "3008",
          ldraw_id: "3008.dat",
          label: "1x8 brick",
          color_id: "4",
          color_name: "red",
          position: { x: 0, y: 1, z: 1 },
          rotation: 90,
          feature: "wall",
          step: 2,
        },
      ],
      notes: [],
    };

    const ldraw = exportModelToLDraw(model);

    assert.match(ldraw, /^1 14 60 -4 10 0 0 1 0 1 0 -1 0 0 3666\.dat$/m);
    assert.match(ldraw, /^1 4 80 -20 30 0 0 1 0 1 0 -1 0 0 3008\.dat$/m);
    assert.match(ldraw, /^0 FILE 3666\.dat$/m);
    assert.match(ldraw, /^0 FILE 3008\.dat$/m);
    assert.match(ldraw, /^4 16 -10 -4 -60 10 -4 -60 10 -4 60 -10 -4 60$/m);
    assert.match(ldraw, /^4 16 -10 -12 -80 10 -12 -80 10 -12 80 -10 -12 80$/m);
  });

  it("exports studs with enough segments to render circular caps", () => {
    const model = {
      model_name: "Single Stud",
      prompt: "single stud",
      piece_count: 1,
      dimensions: { width_studs: 1, depth_studs: 1, height_layers: 1 },
      created_from_inventory_id: "test",
      generator_version: "test",
      bricks: [
        {
          id: "single-stud",
          part_id: "3005",
          ldraw_id: "3005.dat",
          label: "1x1 brick",
          color_id: "14",
          color_name: "yellow",
          position: { x: 0, y: 0, z: 0 },
          rotation: 0,
          feature: "test",
          step: 1,
        },
      ],
      notes: [],
    };

    const ldraw = exportModelToLDraw(model);
    const lines = ldraw.split("\n");
    const topCapTriangles = lines.filter((line) => line.startsWith("3 16 0 -16 0 "));
    const sideFaces = lines.filter((line) =>
      line.startsWith("4 16 ") && line.includes(" -12 ") && line.includes(" -16 ")
    );

    assert.equal(topCapTriangles.length, 16);
    assert.equal(sideFaces.length, 16);
  });

  it("exports the 15-piece duck as a packed LDraw model with embedded MVP parts", () => {
    const model = buildSmallDuckModel(duckInventory);

    const ldraw = exportModelToLDraw(model);

    assert.match(ldraw, /^0 15 Piece Duck/m);
    assert.match(ldraw, /^0 Name: 15-piece-duck.ldr/m);
    assert.match(ldraw, /^0 !LDRAW_ORG Model/m);
    assert.match(ldraw, /^0 !COLOUR Yellow CODE 14 VALUE #F2CD37 EDGE #333333$/m);
    assert.match(ldraw, /^0 !COLOUR Orange CODE 25 VALUE #FE8A18 EDGE #333333$/m);
    assert.match(ldraw, /^0 !COLOUR Black CODE 0 VALUE #05131D EDGE #595959$/m);
    assert.match(ldraw, /^0 STEP$/m);
    assert.match(ldraw, /^1 14 20 -20 40 1 0 0 0 1 0 0 0 1 3001.dat$/m);
    assert.match(ldraw, /^1 25 30 -92 0 1 0 0 0 1 0 0 0 1 3004.dat$/m);
    assert.match(ldraw, /^1 0 30 -92 30 1 0 0 0 1 0 0 0 1 3005.dat$/m);
    assert.match(ldraw, /^0 FILE 3001.dat$/m);
    assert.match(ldraw, /^0 FILE 3020.dat$/m);
    assert.match(ldraw, /^4 16 -20 -12 -40 20 -12 -40 20 -12 40 -20 -12 40$/m);
    assert.match(ldraw, /^0 Studs$/m);
    assert.match(ldraw, /^3 16 0 -16 0 6 -16 0 5.543 -16 2.296$/m);
    assert.match(ldraw, /^4 16 6 -12 0 5.543 -12 2.296 5.543 -16 2.296 6 -16 0$/m);
  });

  it("rejects unsupported part definitions before exporting", () => {
    const model = buildSmallDuckModel(duckInventory);
    model.bricks.push({
      id: "unsupported-wheel",
      part_id: "30027",
      ldraw_id: "30027.dat",
      label: "wheel",
      color_id: "0",
      color_name: "black",
      position: { x: 0, y: 0, z: 4 },
      rotation: 0,
      feature: "wheel",
      step: 6,
    });

    assert.throws(
      () => exportModelToLDraw(model),
      /Cannot export unsupported part 30027/,
    );
  });
});
