import { buildBlockyGlobeModel } from "../generation/fixtures/blockyGlobeModel.js";
import { buildCampfireModel } from "../generation/fixtures/campfireModel.js";
import { buildCastleGateModel } from "../generation/fixtures/castleGateModel.js";
import { buildHorseModel } from "../generation/fixtures/horseModel.js";
import { buildLighthouseModel } from "../generation/fixtures/lighthouseModel.js";
import { buildMailboxModel } from "../generation/fixtures/mailboxModel.js";
import { fixedDemoInventory } from "../generation/fixtures/fixedDemoInventory.js";
import { randomInventoryV2 } from "../generation/fixtures/randomInventoryV2.js";
import { buildShowcaseBonsaiModel } from "../generation/fixtures/showcaseBonsaiModel.js";
import { buildShowcaseGrandPianoModel } from "../generation/fixtures/showcaseGrandPianoModel.js";
import { buildShowcaseCoastalLighthouseModel } from "../generation/fixtures/showcaseCoastalLighthouseModel.js";
import { buildShowcaseDuckModel } from "../generation/fixtures/showcaseDuckModel.js";
import { buildShowcaseElectricGuitarModel } from "../generation/fixtures/showcaseElectricGuitarModel.js";
import { buildShowcaseFireEngineModel } from "../generation/fixtures/showcaseFireEngineModel.js";
import { buildShowcaseSteamLocomotiveModel } from "../generation/fixtures/showcaseSteamLocomotiveModel.js";

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
  {
    id: "scarlet-steam-locomotive",
    label: "Scarlet Steam Locomotive",
    buildModel: buildShowcaseSteamLocomotiveModel,
    inventory: fixedDemoInventory,
  },
  {
    id: "midnight-grand-piano",
    label: "Midnight Grand Piano",
    buildModel: buildShowcaseGrandPianoModel,
    inventory: fixedDemoInventory,
  },
  {
    id: "coastal-beacon-lighthouse",
    label: "Coastal Beacon Lighthouse",
    buildModel: buildShowcaseCoastalLighthouseModel,
    inventory: fixedDemoInventory,
  },
  {
    id: "red-rescue-fire-engine",
    label: "Red Rescue Fire Engine",
    buildModel: buildShowcaseFireEngineModel,
    inventory: fixedDemoInventory,
  },
  {
    id: "crimson-strat-electric-guitar",
    label: "Crimson Strat Electric Guitar",
    buildModel: buildShowcaseElectricGuitarModel,
    inventory: fixedDemoInventory,
  },
  {
    id: "japanese-bonsai-display",
    label: "Japanese Bonsai Display",
    buildModel: buildShowcaseBonsaiModel,
    inventory: fixedDemoInventory,
  },
  {
    id: "golden-rubber-duck",
    label: "Golden Rubber Duck",
    buildModel: buildShowcaseDuckModel,
    inventory: fixedDemoInventory,
  },
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
