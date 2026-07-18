import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStreamingBrickExtractor } from "../../src/generation/streamingBrickExtractor.js";

describe("streaming brick extractor", () => {
  it("emits complete bricks across arbitrary chunks and retains the trailing fragment", () => {
    const extractor = createStreamingBrickExtractor();
    const brickA = { id: "a", position: { x: 0, y: 0, z: 0 }, label: "A" };
    const brickB = { id: "b", position: { x: 1, y: 0, z: 0 }, label: "B" };
    const text = JSON.stringify({ bricks: [brickA, brickB] });
    const emitted = [];

    for (let index = 0; index < text.length; index += 3) {
      emitted.push(...extractor.push(text.slice(index, index + 3)));
    }

    assert.deepEqual(emitted, [brickA, brickB]);
    const final = extractor.finish();
    assert.equal(final.trailingFragment, "");
    assert.deepEqual(final.errors, []);
    // A second finish must not rescan the outer object after the array closes.
    assert.deepEqual(extractor.finish().errors, []);
  });

  it("handles nested objects, escaped quotes, and braces inside strings", () => {
    const extractor = createStreamingBrickExtractor();
    const brick = {
      id: "quoted-\\\"id",
      label: "contains { braces }",
      position: { x: 1, y: 2, z: 3 },
    };

    assert.deepEqual(extractor.push(`{"bricks":[${JSON.stringify(brick).slice(0, 12)}`), []);
    assert.deepEqual(extractor.push(`${JSON.stringify(brick).slice(12)}]}`), [brick]);
  });

  it("does not emit an incomplete trailing object", () => {
    const extractor = createStreamingBrickExtractor();
    const brick = { id: "complete" };
    const text = `{"bricks":[${JSON.stringify(brick)},{"id":"partial"`;
    assert.deepEqual(extractor.push(text), [brick]);
    const final = extractor.finish();
    assert.match(final.trailingFragment, /partial/);
    assert.deepEqual(final.bricks, [brick]);
  });

  it("reports malformed complete brick objects while preserving earlier bricks", () => {
    const extractor = createStreamingBrickExtractor();
    assert.deepEqual(extractor.push('{"bricks":[{"id":"ok"}, {bad}]'), [{ id: "ok" }]);
    const final = extractor.finish();
    assert.equal(final.errors.length, 1);
    assert.match(final.errors[0].message, /brick/i);
  });
});
