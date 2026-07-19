import { spawn } from "node:child_process";

export class BrickGptClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BrickGptClientError";
    this.code = code;
    this.details = details;
  }
}

function validateRequest(request) {
  if (typeof request.prompt !== "string" || request.prompt.trim() === "") {
    throw new BrickGptClientError("invalid_request", "prompt must be a non-empty string.");
  }

  for (const field of ["seed", "worldDim", "maxBricks"]) {
    if (!Number.isInteger(request[field]) || request[field] < (field === "seed" ? 0 : 1)) {
      throw new BrickGptClientError(
        "invalid_request",
        `${field} must be ${field === "seed" ? "a non-negative" : "a positive"} integer.`,
      );
    }
  }

  if (typeof request.useGurobi !== "boolean") {
    throw new BrickGptClientError("invalid_request", "useGurobi must be a boolean.");
  }
}

function parseOutput(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new BrickGptClientError(
      "invalid_output",
      `BrickGPT sidecar returned invalid JSON: ${error.message}`,
    );
  }

  if (payload?.ok === false) {
    throw new BrickGptClientError(
      payload.error?.code ?? "sidecar_error",
      payload.error?.message ?? "BrickGPT sidecar reported an error.",
      payload.error?.details,
    );
  }

  if (!payload || !Number.isInteger(payload.seed) || !Array.isArray(payload.bricks)) {
    throw new BrickGptClientError(
      "invalid_output",
      "BrickGPT sidecar output must include integer seed and bricks array.",
    );
  }

  payload.bricks.forEach((brick, index) => {
    const positive = [brick?.width, brick?.depth].every(
      (value) => Number.isInteger(value) && value > 0,
    );
    const positioned = [brick?.x, brick?.y, brick?.z].every(
      (value) => Number.isInteger(value) && value >= 0,
    );

    if (!positive || !positioned) {
      throw new BrickGptClientError(
        "invalid_output",
        `BrickGPT sidecar brick ${index} has invalid dimensions or position.`,
      );
    }
  });

  return {
    seed: payload.seed,
    bricks: payload.bricks,
    metadata: payload.metadata ?? {},
  };
}

export function createBrickGptClient({
  pythonExecutable,
  sidecarPath,
  timeoutMs = 10 * 60 * 1000,
  maxOutputBytes = 8 * 1024 * 1024,
  env = process.env,
}) {
  if (typeof pythonExecutable !== "string" || pythonExecutable.trim() === "") {
    throw new BrickGptClientError("configuration", "BrickGPT Python executable is required.");
  }
  if (typeof sidecarPath !== "string" || sidecarPath.trim() === "") {
    throw new BrickGptClientError("configuration", "BrickGPT sidecar path is required.");
  }

  return {
    async generate({ signal, ...request }) {
      validateRequest(request);

      if (signal?.aborted) {
        throw new BrickGptClientError("aborted", "BrickGPT generation was aborted.");
      }

      return new Promise((resolve, reject) => {
        const child = spawn(pythonExecutable, [sidecarPath], {
          env,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const stdout = [];
        const stderr = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;

        const cleanup = () => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abort);
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        const succeed = (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        const stop = () => {
          if (!child.killed) child.kill("SIGTERM");
        };
        const abort = () => {
          stop();
          fail(new BrickGptClientError("aborted", "BrickGPT generation was aborted."));
        };
        const timeout = setTimeout(() => {
          stop();
          fail(new BrickGptClientError(
            "timeout",
            `BrickGPT generation exceeded ${timeoutMs}ms.`,
          ));
        }, timeoutMs);

        signal?.addEventListener("abort", abort, { once: true });

        child.on("error", (error) => {
          fail(new BrickGptClientError(
            "process_start_failed",
            `Could not start BrickGPT sidecar: ${error.message}`,
          ));
        });

        child.stdout.on("data", (chunk) => {
          stdoutBytes += chunk.length;
          if (stdoutBytes > maxOutputBytes) {
            stop();
            fail(new BrickGptClientError(
              "output_too_large",
              `BrickGPT sidecar output exceeded ${maxOutputBytes} bytes.`,
            ));
            return;
          }
          stdout.push(chunk);
        });

        child.stderr.on("data", (chunk) => {
          if (stderrBytes >= maxOutputBytes) return;
          const remaining = maxOutputBytes - stderrBytes;
          const bounded = chunk.subarray(0, remaining);
          stderr.push(bounded);
          stderrBytes += bounded.length;
        });

        child.on("close", (code, closeSignal) => {
          if (settled) return;
          const errorText = Buffer.concat(stderr).toString("utf8").trim();

          if (code !== 0) {
            fail(new BrickGptClientError(
              "process_failed",
              `BrickGPT sidecar exited with code ${code}${
                closeSignal ? ` (${closeSignal})` : ""
              }${errorText ? `: ${errorText}` : "."}`,
              { exitCode: code, signal: closeSignal },
            ));
            return;
          }

          try {
            succeed(parseOutput(Buffer.concat(stdout).toString("utf8")));
          } catch (error) {
            fail(error);
          }
        });

        child.stdin.on("error", (error) => {
          fail(new BrickGptClientError(
            "process_input_failed",
            `Could not send request to BrickGPT sidecar: ${error.message}`,
          ));
        });
        child.stdin.end(JSON.stringify({
          prompt: request.prompt,
          seed: request.seed,
          world_dim: request.worldDim,
          max_bricks: request.maxBricks,
          use_gurobi: request.useGurobi,
        }));
      });
    },
  };
}
