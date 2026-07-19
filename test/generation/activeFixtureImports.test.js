import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

function javascriptFiles(directoryUrl) {
  return readdirSync(directoryUrl, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.name, directoryUrl);

    if (entry.isDirectory()) {
      return javascriptFiles(new URL(`${entry.name}/`, directoryUrl));
    }

    return entry.name.endsWith(".js") ? [entryUrl] : [];
  });
}

describe("active fixture imports", () => {
  it("keeps UI and tests on files in the active fixtures directory", () => {
    const sourceFiles = [
      ...javascriptFiles(new URL("../../src/preview/", import.meta.url)),
      ...javascriptFiles(new URL("../", import.meta.url)),
    ];
    const staleImports = [];
    const missingImports = [];

    for (const sourceFile of sourceFiles) {
      const source = readFileSync(sourceFile, "utf8");
      const fixtureImports = source.matchAll(
        /from\s+["']([^"']*\/fixtures(?:_old)?\/[^"']+\.js)["']/g,
      );

      for (const [, fixtureImport] of fixtureImports) {
        const sourcePath = fileURLToPath(sourceFile);

        if (fixtureImport.includes("/fixtures_old/")) {
          staleImports.push(`${sourcePath}: ${fixtureImport}`);
        }

        if (!existsSync(new URL(fixtureImport, sourceFile))) {
          missingImports.push(`${sourcePath}: ${fixtureImport}`);
        }
      }
    }

    assert.deepEqual(staleImports, []);
    assert.deepEqual(missingImports, []);
  });
});
