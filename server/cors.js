const DEFAULT_CORS_ORIGIN = "http://127.0.0.1:5173";
const ALLOWED_CORS_ORIGINS = new Set([
  DEFAULT_CORS_ORIGIN,
  "http://localhost:5173",
]);

export function allowedCorsOrigin(origin) {
  return ALLOWED_CORS_ORIGINS.has(origin) ? origin : DEFAULT_CORS_ORIGIN;
}

export function corsHeadersForOrigin(origin) {
  return {
    "Access-Control-Allow-Origin": allowedCorsOrigin(origin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}
