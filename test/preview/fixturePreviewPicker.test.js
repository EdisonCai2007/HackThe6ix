import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { randomInventoryV2 } from "../../src/generation/fixtures/randomInventoryV2.js";
import { validateModel } from "../../src/generation/validator.js";
import {
  buildFixturePreviewModel,
  FIXTURE_PREVIEWS,
} from "../../src/preview/fixturePreviewPicker.js";

describe("fixture preview picker", () => {
  it("exposes every active model fixture", () => {
    assert.deepEqual(
      FIXTURE_PREVIEWS.map(({ id }) => id),
      [
        "campfire",
        "mailbox",
        "horse",
        "castle-gate",
        "blocky-globe",
        "lighthouse",
      ],
    );
  });

  it("builds valid preview models from the selected fixture", () => {
    for (const fixture of FIXTURE_PREVIEWS) {
      const model = buildFixturePreviewModel(fixture.id, randomBuildInventory);
      const inventory = fixture.inventory ?? randomBuildInventory;
      const validation = validateModel(model, inventory);

      assert.equal(validation.valid, true, fixture.label);
      assert.equal(model.created_from_inventory_id, inventory.inventory_id);
    }
  });

  it("uses randomInventoryV2 for inventory-constrained previews", () => {
    const mailboxFixture = FIXTURE_PREVIEWS.find((fixture) => fixture.id === "mailbox");
    const horseFixture = FIXTURE_PREVIEWS.find((fixture) => fixture.id === "horse");

    assert.equal(mailboxFixture.inventory, randomInventoryV2);
    assert.equal(horseFixture.inventory, randomInventoryV2);
    assert.equal(
      buildFixturePreviewModel("mailbox", randomBuildInventory).created_from_inventory_id,
      randomInventoryV2.inventory_id,
    );
    assert.equal(
      buildFixturePreviewModel("horse", randomBuildInventory).created_from_inventory_id,
      randomInventoryV2.inventory_id,
    );
  });

  it("rejects unknown fixture ids", () => {
    assert.throws(
      () => buildFixturePreviewModel("missing", randomBuildInventory),
      /Unknown fixture preview: missing/,
    );
  });
});
