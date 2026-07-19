import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getPartDimensions,
  MAX_MODEL_PIECES,
  SUPPORTED_PARTS,
} from "../../src/generation/partCatalog.js";

describe("supported part catalog", () => {
  it("uses the documented MVP max model piece count", () => {
    assert.equal(MAX_MODEL_PIECES, 100);
  });

  it("includes longer 1-wide bricks with brick-height dimensions", () => {
    assert.deepEqual(SUPPORTED_PARTS["3010"], {
      label: "1x4 brick",
      category: "brick",
      part_id: "3010",
      ldraw_id: "3010.dat",
      width: 1,
      depth: 4,
    });
    assert.deepEqual(getPartDimensions("3010", 90), {
      width: 4,
      depth: 1,
      height: 3,
    });

    assert.deepEqual(SUPPORTED_PARTS["3009"], {
      label: "1x6 brick",
      category: "brick",
      part_id: "3009",
      ldraw_id: "3009.dat",
      width: 1,
      depth: 6,
    });
    assert.deepEqual(getPartDimensions("3009"), {
      width: 1,
      depth: 6,
      height: 3,
    });

    assert.deepEqual(SUPPORTED_PARTS["3008"], {
      label: "1x8 brick",
      category: "brick",
      part_id: "3008",
      ldraw_id: "3008.dat",
      width: 1,
      depth: 8,
    });
    assert.deepEqual(getPartDimensions("3008", 270), {
      width: 8,
      depth: 1,
      height: 3,
    });
  });

  it("includes longer 1-wide plates with plate-height dimensions", () => {
    assert.deepEqual(SUPPORTED_PARTS["3623"], {
      label: "1x3 plate",
      category: "plate",
      part_id: "3623",
      ldraw_id: "3623.dat",
      width: 1,
      depth: 3,
    });
    assert.deepEqual(getPartDimensions("3623", 90), {
      width: 3,
      depth: 1,
      height: 1,
    });

    assert.deepEqual(SUPPORTED_PARTS["3710"], {
      label: "1x4 plate",
      category: "plate",
      part_id: "3710",
      ldraw_id: "3710.dat",
      width: 1,
      depth: 4,
    });
    assert.deepEqual(getPartDimensions("3710"), {
      width: 1,
      depth: 4,
      height: 1,
    });

    assert.deepEqual(SUPPORTED_PARTS["3666"], {
      label: "1x6 plate",
      category: "plate",
      part_id: "3666",
      ldraw_id: "3666.dat",
      width: 1,
      depth: 6,
    });
    assert.deepEqual(getPartDimensions("3666", 90), {
      width: 6,
      depth: 1,
      height: 1,
    });
  });

  it("includes 2-wide plates with plate-height dimensions", () => {
    assert.deepEqual(SUPPORTED_PARTS["3021"], {
      label: "2x3 plate",
      category: "plate",
      part_id: "3021",
      ldraw_id: "3021.dat",
      width: 2,
      depth: 3,
    });
    assert.deepEqual(getPartDimensions("3021"), {
      width: 2,
      depth: 3,
      height: 1,
    });

    assert.deepEqual(SUPPORTED_PARTS["3795"], {
      label: "2x6 plate",
      category: "plate",
      part_id: "3795",
      ldraw_id: "3795.dat",
      width: 2,
      depth: 6,
    });
    assert.deepEqual(getPartDimensions("3795", 270), {
      width: 6,
      depth: 2,
      height: 1,
    });

    assert.deepEqual(SUPPORTED_PARTS["3034"], {
      label: "2x8 plate",
      category: "plate",
      part_id: "3034",
      ldraw_id: "3034.dat",
      width: 2,
      depth: 8,
    });
    assert.deepEqual(getPartDimensions("3034", 90), {
      width: 8,
      depth: 2,
      height: 1,
    });
  });

  it("includes larger 4-wide plates with plate-height dimensions", () => {
    assert.deepEqual(SUPPORTED_PARTS["3031"], {
      label: "4x4 plate",
      category: "plate",
      part_id: "3031",
      ldraw_id: "3031.dat",
      width: 4,
      depth: 4,
    });
    assert.deepEqual(getPartDimensions("3031"), {
      width: 4,
      depth: 4,
      height: 1,
    });

    assert.deepEqual(SUPPORTED_PARTS["3032"], {
      label: "4x6 plate",
      category: "plate",
      part_id: "3032",
      ldraw_id: "3032.dat",
      width: 4,
      depth: 6,
    });
    assert.deepEqual(getPartDimensions("3032", 90), {
      width: 6,
      depth: 4,
      height: 1,
    });

    assert.deepEqual(SUPPORTED_PARTS["3035"], {
      label: "4x8 plate",
      category: "plate",
      part_id: "3035",
      ldraw_id: "3035.dat",
      width: 4,
      depth: 8,
    });
    assert.deepEqual(getPartDimensions("3035", 90), {
      width: 8,
      depth: 4,
      height: 1,
    });
  });

  it("includes every larger footprint in the fixed inventory", () => {
    const expected = {
      6112: ["brick", 1, 12],
      2456: ["brick", 2, 6],
      3007: ["brick", 2, 8],
      3460: ["plate", 1, 8],
      4477: ["plate", 1, 10],
      3832: ["plate", 2, 10],
      4282: ["plate", 2, 16],
      3030: ["plate", 4, 10],
      3029: ["plate", 4, 12],
      3958: ["plate", 6, 6],
      3036: ["plate", 6, 8],
      3033: ["plate", 6, 10],
    };

    for (const [partId, [category, width, depth]] of Object.entries(expected)) {
      assert.deepEqual(SUPPORTED_PARTS[partId], {
        label: `${width}x${depth} ${category}`,
        category,
        part_id: partId,
        ldraw_id: `${partId}.dat`,
        width,
        depth,
      });
    }
  });
});
