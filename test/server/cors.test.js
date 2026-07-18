import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { corsHeadersForOrigin } from "../../server/cors.js";

describe("generation server CORS", () => {
  it("allows the Vite dev server over localhost", () => {
    const headers = corsHeadersForOrigin("http://localhost:5173");

    assert.equal(headers["Access-Control-Allow-Origin"], "http://localhost:5173");
  });

  it("allows the Vite dev server over 127.0.0.1", () => {
    const headers = corsHeadersForOrigin("http://127.0.0.1:5173");

    assert.equal(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5173");
  });

  it("falls back to 127.0.0.1 for requests without an allowed origin", () => {
    const headers = corsHeadersForOrigin("http://example.com");

    assert.equal(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5173");
  });
});
