import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkBrickGptSetup } from "../../scripts/checkBrickGptSetup.js";

describe("BrickGPT setup checker", () => {
  it("reports a missing Hugging Face token without printing its value", () => {
    const result = checkBrickGptSetup({ env: {}, spawnSyncImpl: () => assert.fail("not called") });

    assert.equal(result.ok, false);
    assert.equal(result.checks[0].code, "missing_hf_token");
    assert.doesNotMatch(JSON.stringify(result), /secret/i);
  });

  it("reports a missing BrickGPT Python package", () => {
    const result = checkBrickGptSetup({
      env: { HF_TOKEN: "secret", BRICKGPT_PYTHON: "python-test" },
      spawnSyncImpl(command, args) {
        assert.equal(command, "python-test");
        assert.deepEqual(args, ["-c", "import brickgpt"]);
        return { status: 1, stderr: Buffer.from("No module named brickgpt") };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.checks.at(-1).code, "missing_package");
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  });

  it("reports a ready local runtime", () => {
    const result = checkBrickGptSetup({
      env: { HF_TOKEN: "secret" },
      spawnSyncImpl: () => ({ status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.checks.map((check) => check.code), ["hf_token", "python_package"]);
  });
});
