import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function checkBrickGptSetup({
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  const checks = [];

  if (typeof env.HF_TOKEN !== "string" || env.HF_TOKEN.trim() === "") {
    checks.push({
      ok: false,
      code: "missing_hf_token",
      message: "Set HF_TOKEN after receiving access to meta-llama/Llama-3.2-1B-Instruct.",
    });
    return { ok: false, checks };
  }

  checks.push({
    ok: true,
    code: "hf_token",
    message: "HF_TOKEN is configured.",
  });

  const pythonExecutable = env.BRICKGPT_PYTHON?.trim() || "python3";
  const probe = spawnSyncImpl(pythonExecutable, ["-c", "import brickgpt"], {
    encoding: null,
    env,
    timeout: 30_000,
  });

  if (probe.error || probe.status !== 0) {
    const stderr = Buffer.isBuffer(probe.stderr)
      ? probe.stderr.toString("utf8")
      : String(probe.stderr ?? "");
    checks.push({
      ok: false,
      code: "missing_package",
      message: `BrickGPT import failed with ${pythonExecutable}: ${
        probe.error?.message ?? (stderr.trim().slice(0, 500) || "unknown import error")
      }`,
    });
    return { ok: false, checks };
  }

  checks.push({
    ok: true,
    code: "python_package",
    message: `BrickGPT imports successfully with ${pythonExecutable}.`,
  });
  return { ok: true, checks };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = checkBrickGptSetup();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
