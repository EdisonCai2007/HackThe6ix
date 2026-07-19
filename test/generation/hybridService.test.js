import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateHybridModel } from "../../src/generation/hybrid/service.js";

const inventory = {
  inventory_id: "hybrid-service-test",
  source: "manual_test_fixture",
  items: [
    {
      label: "1x2 brick",
      category: "brick",
      part_id: "3004",
      ldraw_id: "3004.dat",
      color_name: "red",
      color_id: "4",
      count: 1,
      supported: true,
    },
    {
      label: "2x4 brick",
      category: "brick",
      part_id: "3001",
      ldraw_id: "3001.dat",
      color_name: "red",
      color_id: "4",
      count: 1,
      supported: true,
    },
  ],
};

function geometryProvider({ failSeeds = [] } = {}) {
  const seeds = [];

  return {
    seeds,
    async generate(request) {
      seeds.push(request.seed);
      if (failSeeds.includes(request.seed)) {
        const error = new Error(`seed ${request.seed} failed`);
        error.code = "synthetic_failure";
        throw error;
      }
      if (request.seed === 40) {
        return {
          seed: request.seed,
          bricks: [
            { width: 1, depth: 2, x: 0, y: 0, z: 0 },
            { width: 1, depth: 2, x: 0, y: 0, z: 1 },
          ],
          metadata: {},
        };
      }
      return {
        seed: request.seed,
        bricks: [{ width: 2, depth: 4, x: 0, y: 0, z: 0 }],
        metadata: {},
      };
    },
  };
}

describe("generateHybridModel", () => {
  it("tries deterministic seeds and selects the highest-fidelity valid candidate", async () => {
    const provider = geometryProvider();
    const events = [];
    const result = await generateHybridModel({
      userPrompt: "red tower",
      inventory,
      candidateCount: 3,
      seedBase: 40,
      worldDim: 20,
      geometryProvider: provider,
      compilerOptions: { beamWidth: 8, variants: 2 },
      onProgress: (event) => events.push(event),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(provider.seeds, [40, 41, 42]);
    assert.equal(result.model.generator_version, "brickgpt-inventory-v1");
    assert.equal(result.validation.valid, true);
    assert.equal(result.hybrid.selectedSeed, 41);
    assert.equal(result.hybrid.coverage, 1);
    assert.equal(events.some((event) => event.type === "draft"), true);
    assert.equal(events.some((event) => event.stage === "candidate_select"), true);
  });

  it("continues after a seed failure and reports diagnostics", async () => {
    const provider = geometryProvider({ failSeeds: [41] });
    const result = await generateHybridModel({
      userPrompt: "red tower",
      inventory,
      candidateCount: 2,
      seedBase: 40,
      worldDim: 20,
      geometryProvider: provider,
    });

    assert.equal(result.ok, true);
    assert.equal(result.hybrid.seedFailures.length, 1);
    assert.equal(result.hybrid.seedFailures[0].seed, 41);
    assert.equal(result.hybrid.seedFailures[0].code, "synthetic_failure");
  });

  it("returns a geometry failure when every seed fails", async () => {
    const result = await generateHybridModel({
      userPrompt: "red tower",
      inventory,
      candidateCount: 2,
      seedBase: 40,
      worldDim: 20,
      geometryProvider: geometryProvider({ failSeeds: [40, 41] }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "geometry_generate");
    assert.equal(result.hybrid.seedFailures.length, 2);
  });
});
