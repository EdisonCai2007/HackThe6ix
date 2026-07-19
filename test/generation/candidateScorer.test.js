import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  scoreCompiledCandidate,
  selectBestCandidate,
} from "../../src/generation/hybrid/candidateScorer.js";

function candidate({ valid = true, coverage = 1, exteriorCoverage = 1, colorCoherence = 1 } = {}) {
  return {
    validation: { valid, errors: valid ? [] : [{ type: "floating_brick" }] },
    coverage,
    exteriorCoverage,
    colorCoherence,
    model: { piece_count: 1, bricks: [{}] },
  };
}

describe("hybrid candidate scoring", () => {
  it("disqualifies validator-invalid candidates", () => {
    const result = scoreCompiledCandidate(candidate({ valid: false }));

    assert.equal(result.score, Number.NEGATIVE_INFINITY);
    assert.equal(result.disqualified, true);
  });

  it("ranks exterior fidelity ahead of raw piece count", () => {
    const detailed = candidate({ coverage: 0.9, exteriorCoverage: 1 });
    detailed.model.piece_count = 2;
    const bulky = candidate({ coverage: 1, exteriorCoverage: 0.6 });
    bulky.model.piece_count = 100;

    assert.equal(selectBestCandidate([bulky, detailed]), detailed);
  });

  it("breaks equal-score ties deterministically", () => {
    const first = candidate();
    first.sourceSeed = 9;
    const second = candidate();
    second.sourceSeed = 4;

    assert.equal(selectBestCandidate([first, second]), second);
  });
});
