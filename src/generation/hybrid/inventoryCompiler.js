import { validateGeneratedModelShape } from "../generatedModelSchema.js";
import { getPartDimensions, SUPPORTED_PARTS } from "../partCatalog.js";
import { validateModel } from "../validator.js";
import { parseTargetCellKey, targetCellKey } from "./targetVolume.js";

function inventoryKey(item) {
  return `${item.part_id}:${item.color_id}`;
}

function cloneState(state) {
  return {
    placements: [...state.placements],
    covered: new Set(state.covered),
    omitted: new Set(state.omitted),
    remaining: new Map(state.remaining),
  };
}

function colorPreference(item, normalizedPrompt) {
  const color = item.color_name.toLowerCase();
  return normalizedPrompt.includes(color) ? 1 : 0;
}

function usableInventory(inventory, prompt, variant) {
  const normalizedPrompt = String(prompt).toLowerCase();

  return inventory.items
    .filter((item) => item.supported && item.count > 0 && SUPPORTED_PARTS[item.part_id])
    .map((item) => ({
      item,
      part: SUPPORTED_PARTS[item.part_id],
      key: inventoryKey(item),
      preferredColor: colorPreference(item, normalizedPrompt),
    }))
    .sort((first, second) => {
      if (second.preferredColor !== first.preferredColor) {
        return second.preferredColor - first.preferredColor;
      }

      const firstVolume = first.part.width * first.part.depth * (
        first.part.category === "plate" ? 1 : 3
      );
      const secondVolume = second.part.width * second.part.depth * (
        second.part.category === "plate" ? 1 : 3
      );
      const volumeOrder = variant % 2 === 0
        ? secondVolume - firstVolume
        : firstVolume - secondVolume;

      return volumeOrder || first.key.localeCompare(second.key);
    });
}

function sortedTargetCells(target) {
  return [...target.cells].sort((first, second) => {
    const [firstX, firstY, firstZ] = parseTargetCellKey(first);
    const [secondX, secondY, secondZ] = parseTargetCellKey(second);
    return firstZ - secondZ || firstY - secondY || firstX - secondX;
  });
}

function nextUncoveredCell(state, orderedCells) {
  return orderedCells.find((key) => !state.covered.has(key) && !state.omitted.has(key));
}

function cellsForPlacement(partId, rotation, position) {
  const dimensions = getPartDimensions(partId, rotation);
  const cells = [];

  for (let x = position.x; x < position.x + dimensions.width; x += 1) {
    for (let y = position.y; y < position.y + dimensions.depth; y += 1) {
      for (let z = position.z; z < position.z + dimensions.height; z += 1) {
        cells.push(targetCellKey(x, y, z));
      }
    }
  }

  return cells;
}

function placementIsSupported(cells, position, covered) {
  if (position.z === 0) {
    return true;
  }

  return cells.some((key) => {
    const [x, y, z] = parseTargetCellKey(key);
    return z === position.z && covered.has(targetCellKey(x, y, z - 1));
  });
}

function enumeratePlacements({ state, nextKey, target, descriptors }) {
  const [x, y, z] = parseTargetCellKey(nextKey);
  const position = { x, y, z };
  const placements = [];
  const footprintColors = new Set();

  for (const descriptor of descriptors) {
    if ((state.remaining.get(descriptor.key) ?? 0) <= 0) {
      continue;
    }

    for (const rotation of descriptor.part.width === descriptor.part.depth ? [0] : [0, 90]) {
      const cells = cellsForPlacement(descriptor.item.part_id, rotation, position);

      if (
        cells.every((key) => target.cells.has(key) && !state.covered.has(key)) &&
        placementIsSupported(cells, position, state.covered)
      ) {
        const dimensions = getPartDimensions(descriptor.item.part_id, rotation);
        const shapeKey = `${dimensions.width}x${dimensions.depth}x${dimensions.height}:${rotation}`;
        const colorShapeKey = `${shapeKey}:${descriptor.item.color_id}`;

        if (!footprintColors.has(colorShapeKey)) {
          footprintColors.add(colorShapeKey);
          placements.push({ descriptor, rotation, position, cells });
        }
      }
    }
  }

  return placements;
}

function applyPlacement(state, placement) {
  const next = cloneState(state);

  next.placements.push({
    item: placement.descriptor.item,
    rotation: placement.rotation,
    position: placement.position,
    cells: placement.cells,
  });
  placement.cells.forEach((key) => next.covered.add(key));
  next.remaining.set(
    placement.descriptor.key,
    next.remaining.get(placement.descriptor.key) - 1,
  );
  return next;
}

function partialStateScore(state, target) {
  let coveredExterior = 0;
  let omittedExterior = 0;

  for (const key of state.covered) {
    if (target.exteriorCells.has(key)) coveredExterior += 1;
  }
  for (const key of state.omitted) {
    if (target.exteriorCells.has(key)) omittedExterior += 1;
  }

  return coveredExterior * 100 + state.covered.size * 10 - omittedExterior * 150 - state.placements.length;
}

function stateSignature(state) {
  return `${[...state.covered].sort().join(";")}|${[...state.omitted].sort().join(";")}|${[
    ...state.remaining,
  ].sort().join(";")}`;
}

function searchTarget({ target, inventory, prompt, beamWidth, variant }) {
  const descriptors = usableInventory(inventory, prompt, variant);
  const orderedCells = sortedTargetCells(target);
  const initial = {
    placements: [],
    covered: new Set(),
    omitted: new Set(),
    remaining: new Map(
      descriptors.map(({ key, item }) => [key, item.count]),
    ),
  };
  let states = [initial];

  for (let iteration = 0; iteration < orderedCells.length; iteration += 1) {
    if (states.every((state) => !nextUncoveredCell(state, orderedCells))) {
      break;
    }

    const expanded = [];

    for (const state of states) {
      const nextKey = nextUncoveredCell(state, orderedCells);

      if (!nextKey) {
        expanded.push(state);
        continue;
      }

      const placements = enumeratePlacements({
        state,
        nextKey,
        target,
        descriptors,
      });

      if (placements.length === 0) {
        const omitted = cloneState(state);
        omitted.omitted.add(nextKey);
        expanded.push(omitted);
      } else {
        for (const placement of placements) {
          expanded.push(applyPlacement(state, placement));
        }
      }
    }

    const unique = new Map();
    for (const state of expanded) {
      const signature = stateSignature(state);
      const existing = unique.get(signature);
      if (!existing || partialStateScore(state, target) > partialStateScore(existing, target)) {
        unique.set(signature, state);
      }
    }

    states = [...unique.values()]
      .sort((first, second) => partialStateScore(second, target) - partialStateScore(first, target))
      .slice(0, Math.max(1, beamWidth));
  }

  return states[0];
}

function colorCoherenceFor(placements) {
  if (placements.length === 0) return 0;
  const counts = new Map();
  for (const placement of placements) {
    counts.set(placement.item.color_id, (counts.get(placement.item.color_id) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / placements.length;
}

function modelFromState({ state, target, inventory, prompt, variant }) {
  const placements = [...state.placements].sort((first, second) => (
    first.position.z - second.position.z ||
    first.position.y - second.position.y ||
    first.position.x - second.position.x ||
    first.item.part_id.localeCompare(second.item.part_id)
  ));
  const bricks = placements.map((placement, index) => ({
    id: `hybrid-${target.seed}-${variant}-${index + 1}`,
    part_id: placement.item.part_id,
    ldraw_id: placement.item.ldraw_id,
    label: placement.item.label,
    color_id: placement.item.color_id,
    color_name: placement.item.color_name,
    position: { ...placement.position },
    rotation: placement.rotation,
    feature: "compiled target geometry",
    step: index + 1,
  }));
  const model = {
    model_name: `Hybrid ${String(prompt).trim() || "LEGO model"}`,
    prompt: String(prompt),
    piece_count: bricks.length,
    dimensions: {
      width_studs: target.bounds.width,
      depth_studs: target.bounds.depth,
      height_layers: target.bounds.height,
    },
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "brickgpt-inventory-v1",
    bricks,
    notes: [
      `Compiled from BrickGPT seed ${target.seed}.`,
      `Covered ${state.covered.size} of ${target.cells.size} target cells.`,
    ],
  };
  const shape = validateGeneratedModelShape(model);
  const validation = shape.ok
    ? validateModel(model, inventory)
    : { valid: false, errors: shape.errors, warnings: [], inventory_usage: [] };
  const coveredExterior = [...state.covered].filter((key) => target.exteriorCells.has(key)).length;

  return {
    model,
    validation,
    sourceSeed: target.seed,
    variant,
    targetCellCount: target.cells.size,
    coveredCells: new Set(state.covered),
    omittedCells: new Set(state.omitted),
    coverage: target.cells.size === 0 ? 0 : state.covered.size / target.cells.size,
    exteriorCoverage: target.exteriorCells.size === 0
      ? 0
      : coveredExterior / target.exteriorCells.size,
    colorCoherence: colorCoherenceFor(placements),
  };
}

export function compileTargetVolume({
  target,
  inventory,
  prompt = "",
  beamWidth = 12,
  variants = 3,
}) {
  if (!target?.cells || !(target.cells instanceof Set)) {
    throw new Error("target must be a normalized target volume.");
  }
  if (!inventory || !Array.isArray(inventory.items)) {
    throw new Error("inventory.items must be an array.");
  }

  return Array.from({ length: Math.max(1, Math.floor(variants)) }, (_, variant) => {
    const state = searchTarget({
      target,
      inventory,
      prompt,
      beamWidth: Math.max(1, Math.floor(beamWidth)),
      variant,
    });
    return modelFromState({ state, target, inventory, prompt, variant });
  });
}
