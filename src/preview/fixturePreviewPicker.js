import { buildBlockyGlobeModel } from "../generation/fixtures/blockyGlobeModel.js";
import { buildCampfireModel } from "../generation/fixtures/campfireModel.js";
import { buildCastleGateModel } from "../generation/fixtures/castleGateModel.js";
import { buildHorseModel } from "../generation/fixtures/horseModel.js";
import { buildLighthouseModel } from "../generation/fixtures/lighthouseModel.js";
import { buildMailboxModel } from "../generation/fixtures/mailboxModel.js";
import { randomInventoryV2 } from "../generation/fixtures/randomInventoryV2.js";

export const FIXTURE_PREVIEWS = Object.freeze([
  { id: "campfire", label: "Campfire Scene", buildModel: buildCampfireModel },
  {
    id: "mailbox",
    label: "Freestanding Mailbox",
    buildModel: buildMailboxModel,
    inventory: randomInventoryV2,
  },
  {
    id: "horse",
    label: "3D Horse",
    buildModel: buildHorseModel,
    inventory: randomInventoryV2,
  },
  { id: "castle-gate", label: "Royal Castle Gate", buildModel: buildCastleGateModel },
  { id: "blocky-globe", label: "Blocky Globe", buildModel: buildBlockyGlobeModel },
  { id: "lighthouse", label: "Lighthouse Island", buildModel: buildLighthouseModel },
]);

export function buildFixturePreviewModel(fixtureId, inventory) {
  const fixture = FIXTURE_PREVIEWS.find((candidate) => candidate.id === fixtureId);

  if (!fixture) {
    throw new Error(`Unknown fixture preview: ${fixtureId}`);
  }

  return fixture.buildModel(fixture.inventory ?? inventory);
}

export function installFixturePreviewPicker({
  form,
  beforeElement,
  inventory,
  disabledWhen = null,
  onSelect,
  initialFixtureId = "campfire",
}) {
  const document = form.ownerDocument;
  const label = document.createElement("label");
  const select = document.createElement("select");
  const defaultFixture = FIXTURE_PREVIEWS.find(
    (fixture) => fixture.id === initialFixtureId,
  ) ?? FIXTURE_PREVIEWS[0];
  let selectedFixtureId = defaultFixture.id;

  label.dataset.feature = "fixture-preview-picker";
  label.append("Fixture preview");
  select.id = "fixture-preview-select";
  select.name = "fixture-preview";
  select.setAttribute("aria-label", "Fixture preview");

  for (const fixture of FIXTURE_PREVIEWS) {
    const option = document.createElement("option");
    option.value = fixture.id;
    option.textContent = fixture.label;
    select.append(option);
  }

  select.value = selectedFixtureId;
  label.append(select);
  form.insertBefore(label, beforeElement);

  function syncDisabledState() {
    select.disabled = Boolean(disabledWhen?.disabled);
  }

  function handleSelection() {
    if (disabledWhen?.disabled) {
      select.value = selectedFixtureId;
      return;
    }

    const fixture = FIXTURE_PREVIEWS.find(
      (candidate) => candidate.id === select.value,
    );

    if (!fixture) {
      select.value = selectedFixtureId;
      return;
    }

    selectedFixtureId = fixture.id;
    const fixtureInventory = fixture.inventory ?? inventory;
    onSelect({
      fixture,
      inventory: fixtureInventory,
      model: buildFixturePreviewModel(fixture.id, fixtureInventory),
    });
  }

  select.addEventListener("change", handleSelection);
  syncDisabledState();

  const MutationObserver = document.defaultView?.MutationObserver;
  const disabledObserver = disabledWhen && MutationObserver
    ? new MutationObserver(syncDisabledState)
    : null;
  disabledObserver?.observe(disabledWhen, {
    attributes: true,
    attributeFilter: ["disabled"],
  });

  return {
    element: label,
    select,
    remove() {
      disabledObserver?.disconnect();
      select.removeEventListener("change", handleSelection);
      label.remove();
    },
  };
}
