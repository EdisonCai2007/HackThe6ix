import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  BrickGptClientError,
  createBrickGptClient,
} from "../../src/generation/hybrid/brickGptClient.js";

const fakeSidecarPath = fileURLToPath(
  new URL("../fixtures/fakeBrickGptSidecar.js", import.meta.url),
);

function client(overrides = {}) {
  return createBrickGptClient({
    pythonExecutable: process.execPath,
    sidecarPath: fakeSidecarPath,
    timeoutMs: 1_000,
    maxOutputBytes: 4_096,
    ...overrides,
  });
}

function request(prompt = "red tower") {
  return {
    prompt,
    seed: 9,
    worldDim: 20,
    maxBricks: 50,
    useGurobi: false,
  };
}

describe("BrickGPT process client", () => {
  it("round-trips JSON and treats shell metacharacters as literal prompt text", async () => {
    const prompt = "$(touch /tmp/brickgpt-client-must-not-exist)";
    const result = await client().generate(request(prompt));

    assert.equal(result.seed, 9);
    assert.equal(result.bricks[0].width, 2);
    assert.equal(result.metadata.prompt, prompt);
  });

  it("terminates a sidecar that exceeds its timeout", async () => {
    await assert.rejects(
      () => client({ timeoutMs: 40 }).generate(request("timeout")),
      (error) => error instanceof BrickGptClientError && error.code === "timeout",
    );
  });

  it("reports nonzero process exits with bounded stderr", async () => {
    await assert.rejects(
      () => client().generate(request("fail")),
      (error) => (
        error instanceof BrickGptClientError &&
        error.code === "process_failed" &&
        /synthetic sidecar failure/.test(error.message)
      ),
    );
  });

  it("rejects malformed and oversized sidecar output", async () => {
    await assert.rejects(
      () => client().generate(request("malformed")),
      (error) => error.code === "invalid_output",
    );
    await assert.rejects(
      () => client({ maxOutputBytes: 100 }).generate(request("oversized")),
      (error) => error.code === "output_too_large",
    );
  });

  it("preserves actionable configuration failures from the sidecar", async () => {
    await assert.rejects(
      () => client().generate(request("missing token")),
      (error) => error.code === "missing_hf_token" && /HF_TOKEN/.test(error.message),
    );
  });

  it("terminates generation when its abort signal fires", async () => {
    const controller = new AbortController();
    const generation = client({ timeoutMs: 2_000 }).generate({
      ...request("timeout"),
      signal: controller.signal,
    });
    controller.abort();

    await assert.rejects(
      () => generation,
      (error) => error.code === "aborted",
    );
  });
});
