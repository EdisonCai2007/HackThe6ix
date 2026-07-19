import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("server package scripts", () => {
  it("starts both the preview and generation server during local development", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));
    const { createDevProcessSpecs } = await import("../../scripts/dev.js");

    assert.equal(packageJson.scripts.dev, "node scripts/dev.js");
    assert.equal(packageJson.scripts["dev:preview"], "vite --host 127.0.0.1");
    const specs = createDevProcessSpecs();

    assert.deepEqual(
      specs.map(({ name, command, args }) => ({ name, command, args })),
      [
      {
        name: "generation",
        command: "npm",
        args: ["run", "serve:generation"],
      },
      {
        name: "preview",
        command: "npm",
        args: ["run", "dev:preview"],
      },
      ],
    );
  });

  it("does not pass Gemini secrets to the preview dev server", async () => {
    const { withoutSecretEnv } = await import("../../scripts/dev.js");
    const safeEnv = withoutSecretEnv({
      GEMINI_API_KEY: "secret",
      PATH: "/usr/bin",
    });

    assert.equal("GEMINI_API_KEY" in safeEnv, false);
    assert.equal(safeEnv.PATH, "/usr/bin");
  });

  it("loads local environment variables before starting the generation server", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));

    assert.equal(
      packageJson.scripts["serve:generation"],
      "node --env-file=.env server/generationServer.js",
    );
  });

  it("runs every nested Node test file explicitly", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));

    assert.equal(packageJson.scripts.test, "node --test test/**/*.test.js");
  });
});
