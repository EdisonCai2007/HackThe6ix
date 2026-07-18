import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function createDevProcessSpecs() {
  return [
    {
      name: "generation",
      command: "npm",
      args: ["run", "serve:generation"],
      env: process.env,
    },
    {
      name: "preview",
      command: "npm",
      args: ["run", "dev:preview"],
      env: withoutSecretEnv(process.env),
    },
  ];
}

export function withoutSecretEnv(env) {
  const safeEnv = { ...env };
  delete safeEnv.GEMINI_API_KEY;
  return safeEnv;
}

export function startDevProcesses({ spawnProcess = spawn } = {}) {
  const specs = createDevProcessSpecs();
  const children = [];
  let isShuttingDown = false;
  let exitCode = 0;

  const stopAll = (signal = "SIGTERM") => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    }
  };

  const exitWhenDone = () => {
    if (children.every((child) => child.exitCode !== null || child.signalCode !== null)) {
      process.exit(exitCode);
    }
  };

  for (const spec of specs) {
    const child = spawnProcess(spec.command, spec.args, {
      env: spec.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    children.push(child);

    child.on("error", (error) => {
      console.error(`[dev:${spec.name}] ${error.message}`);
      exitCode = 1;
      stopAll();
    });

    child.on("exit", (code, signal) => {
      if (!isShuttingDown) {
        exitCode = code ?? (signal ? 1 : 0);
        stopAll();
      }

      exitWhenDone();
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      stopAll(signal);

      const timeout = setTimeout(() => {
        process.exit(exitCode);
      }, 5000);
      timeout.unref();
    });
  }

  return children;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startDevProcesses();
}
