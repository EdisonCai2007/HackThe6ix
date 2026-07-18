import { randomUUID } from "node:crypto";

const REFINEMENT_ID_PATTERN = /^ref_[A-Za-z0-9_-]+$/;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function defaultCreateId() {
  return `ref_${randomUUID().replaceAll("-", "")}`;
}

export class RefinementSessionError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "RefinementSessionError";
    this.statusCode = statusCode;
  }
}

function assertRefinementId(refinementId) {
  if (typeof refinementId !== "string" || !REFINEMENT_ID_PATTERN.test(refinementId)) {
    throw new RefinementSessionError("refinementId is invalid.", 400);
  }
}

export function createRefinementSessionStore({
  createId = defaultCreateId,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  const sessions = new Map();

  function pruneExpired(currentTime) {
    for (const [refinementId, session] of sessions) {
      if (session.expiresAtMs <= currentTime) {
        sessions.delete(refinementId);
      }
    }
  }

  function create(context) {
    const currentTime = now();
    pruneExpired(currentTime);

    const refinementId = createId();
    assertRefinementId(refinementId);
    const expiresAtMs = currentTime + ttlMs;

    sessions.set(refinementId, { context, expiresAtMs });

    return {
      refinementId,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  function consume(refinementId) {
    assertRefinementId(refinementId);

    const session = sessions.get(refinementId);
    sessions.delete(refinementId);

    if (!session || session.expiresAtMs <= now()) {
      throw new RefinementSessionError(
        "Refinement session is expired, invalid, or already used.",
        409,
      );
    }

    return session.context;
  }

  return { create, consume };
}
