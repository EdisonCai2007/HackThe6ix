export const MODEL_INITIAL_DISTANCE_MULTIPLIER = 1.45;
export const MODEL_MIN_ZOOM_DISTANCE_MULTIPLIER = 0.35;
export const MODEL_MAX_ZOOM_DISTANCE_MULTIPLIER = 3.2;

export function cameraFrameForModelSize(size, verticalFovRadians) {
  const maxDimension = Math.max(size.x, size.y, size.z);
  const distance = (
    maxDimension /
    (2 * Math.tan(verticalFovRadians / 2))
  ) * MODEL_INITIAL_DISTANCE_MULTIPLIER;

  return {
    distance,
    near: Math.max(0.1, distance / 100),
    far: distance * 10,
    minDistance: distance * MODEL_MIN_ZOOM_DISTANCE_MULTIPLIER,
    maxDistance: distance * MODEL_MAX_ZOOM_DISTANCE_MULTIPLIER,
  };
}
