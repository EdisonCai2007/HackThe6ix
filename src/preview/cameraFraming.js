export const MODEL_INITIAL_DISTANCE_MULTIPLIER = 1.45;
export const MODEL_MIN_ZOOM_DISTANCE_MULTIPLIER = 0.35;
export const MODEL_MAX_ZOOM_DISTANCE_MULTIPLIER = 3.2;

export function generationCameraDistanceMode({ streaming }) {
  return streaming ? "max" : "initial";
}

export function cameraFrameForModelSize(
  size,
  verticalFovRadians,
  { distanceMode = "initial" } = {},
) {
  const maxDimension = Math.max(size.x, size.y, size.z);
  const initialDistance = (
    maxDimension /
    (2 * Math.tan(verticalFovRadians / 2))
  ) * MODEL_INITIAL_DISTANCE_MULTIPLIER;
  const maxDistance = initialDistance * MODEL_MAX_ZOOM_DISTANCE_MULTIPLIER;
  const distance = distanceMode === "max" ? maxDistance : initialDistance;

  return {
    distance,
    near: Math.max(0.1, distance / 100),
    far: distance * 10,
    minDistance: initialDistance * MODEL_MIN_ZOOM_DISTANCE_MULTIPLIER,
    maxDistance,
  };
}
