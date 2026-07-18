import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_INITIAL_DISTANCE_MULTIPLIER,
  MODEL_MIN_ZOOM_DISTANCE_MULTIPLIER,
  MODEL_MAX_ZOOM_DISTANCE_MULTIPLIER,
  cameraFrameForModelSize,
} from "../../src/preview/cameraFraming.js";

test("cameraFrameForModelSize keeps initial framing while allowing more zoom-out range", () => {
  const fov = Math.PI / 4;
  const size = { x: 120, y: 80, z: 60 };
  const baseDistance = size.x / (2 * Math.tan(fov / 2));
  const frame = cameraFrameForModelSize(size, fov);

  assert.equal(MODEL_INITIAL_DISTANCE_MULTIPLIER, 1.45);
  assert.equal(MODEL_MAX_ZOOM_DISTANCE_MULTIPLIER, 3.2);
  assert.equal(frame.distance, baseDistance * MODEL_INITIAL_DISTANCE_MULTIPLIER);
  assert.equal(frame.maxDistance, frame.distance * MODEL_MAX_ZOOM_DISTANCE_MULTIPLIER);
});

test("cameraFrameForModelSize can select max-distance framing for generation", () => {
  const fov = Math.PI / 4;
  const size = { x: 120, y: 80, z: 60 };
  const baseDistance = size.x / (2 * Math.tan(fov / 2));
  const initialDistance = baseDistance * MODEL_INITIAL_DISTANCE_MULTIPLIER;

  const frame = cameraFrameForModelSize(size, fov, { distanceMode: "max" });

  assert.equal(frame.distance, initialDistance * MODEL_MAX_ZOOM_DISTANCE_MULTIPLIER);
  assert.equal(frame.maxDistance, initialDistance * MODEL_MAX_ZOOM_DISTANCE_MULTIPLIER);
  assert.equal(frame.minDistance, initialDistance * MODEL_MIN_ZOOM_DISTANCE_MULTIPLIER);
});
