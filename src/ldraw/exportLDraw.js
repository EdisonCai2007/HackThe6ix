import { SUPPORTED_PARTS } from "../generation/partCatalog.js";

const STUD_LDU = 20;
const PLATE_UNIT_LDU = 8;
const BRICK_HEIGHT_LDU = 24;
const PLATE_HEIGHT_LDU = 8;
const STUD_RADIUS_LDU = 6;
const STUD_HEIGHT_LDU = 4;
const STUD_SEGMENTS = 16;

const COLOUR_DIRECTIVES = [
  "0 !COLOUR Black CODE 0 VALUE #05131D EDGE #595959",
  "0 !COLOUR Blue CODE 1 VALUE #0055BF EDGE #333333",
  "0 !COLOUR Green CODE 2 VALUE #237841 EDGE #333333",
  "0 !COLOUR Brown CODE 6 VALUE #583927 EDGE #333333",
  "0 !COLOUR Red CODE 4 VALUE #C91A09 EDGE #333333",
  "0 !COLOUR Trans_Light_Blue CODE 43 VALUE #AEEFEC EDGE #333333 ALPHA 96",
  "0 !COLOUR Dark_Bluish_Gray CODE 72 VALUE #6C6E68 EDGE #333333",
  "0 !COLOUR Tan CODE 19 VALUE #E4CD9E EDGE #333333",
  "0 !COLOUR White CODE 15 VALUE #FFFFFF EDGE #333333",
  "0 !COLOUR Yellow CODE 14 VALUE #F2CD37 EDGE #333333",
  "0 !COLOUR Orange CODE 25 VALUE #FE8A18 EDGE #333333",
];

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function partHeight(part) {
  return part.category === "plate" ? PLATE_HEIGHT_LDU : BRICK_HEIGHT_LDU;
}

function modelLineForBrick(brick) {
  const part = SUPPORTED_PARTS[brick.part_id];

  if (!part) {
    throw new Error(`Cannot export unsupported part ${brick.part_id}.`);
  }

  const rotated = brick.rotation === 90 || brick.rotation === 270;
  const width = rotated ? part.depth : part.width;
  const depth = rotated ? part.width : part.depth;
  const x = (brick.position.x + width / 2) * STUD_LDU;
  const y = -(brick.position.z * PLATE_UNIT_LDU + partHeight(part) / 2);
  const z = (brick.position.y + depth / 2) * STUD_LDU;

  const matrix = rotationMatrix(brick.rotation);

  return [
    "1",
    brick.color_id,
    x,
    y,
    z,
    ...matrix,
    brick.ldraw_id,
  ].join(" ");
}

function rotationMatrix(rotation) {
  const normalizedRotation = ((rotation % 360) + 360) % 360;

  if (normalizedRotation === 90) {
    return [0, 0, 1, 0, 1, 0, -1, 0, 0];
  }

  if (normalizedRotation === 180) {
    return [-1, 0, 0, 0, 1, 0, 0, 0, -1];
  }

  if (normalizedRotation === 270) {
    return [0, 0, -1, 0, 1, 0, 1, 0, 0];
  }

  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function partDefinition(part) {
  const halfWidth = (part.width * STUD_LDU) / 2;
  const halfDepth = (part.depth * STUD_LDU) / 2;
  const halfHeight = partHeight(part) / 2;
  const top = -halfHeight;
  const bottom = halfHeight;
  const left = -halfWidth;
  const right = halfWidth;
  const back = -halfDepth;
  const front = halfDepth;

  return [
    `0 FILE ${part.ldraw_id}`,
    `0 ${part.label}`,
    "0 !LDRAW_ORG Part UPDATE 2026-07",
    "0 BFC CERTIFY CCW",
    `4 16 ${left} ${top} ${back} ${right} ${top} ${back} ${right} ${top} ${front} ${left} ${top} ${front}`,
    `4 16 ${left} ${bottom} ${front} ${right} ${bottom} ${front} ${right} ${bottom} ${back} ${left} ${bottom} ${back}`,
    `4 16 ${left} ${bottom} ${back} ${right} ${bottom} ${back} ${right} ${top} ${back} ${left} ${top} ${back}`,
    `4 16 ${right} ${bottom} ${back} ${right} ${bottom} ${front} ${right} ${top} ${front} ${right} ${top} ${back}`,
    `4 16 ${right} ${bottom} ${front} ${left} ${bottom} ${front} ${left} ${top} ${front} ${right} ${top} ${front}`,
    `4 16 ${left} ${bottom} ${front} ${left} ${bottom} ${back} ${left} ${top} ${back} ${left} ${top} ${front}`,
    `2 24 ${left} ${top} ${back} ${right} ${top} ${back}`,
    `2 24 ${right} ${top} ${back} ${right} ${top} ${front}`,
    `2 24 ${right} ${top} ${front} ${left} ${top} ${front}`,
    `2 24 ${left} ${top} ${front} ${left} ${top} ${back}`,
    `2 24 ${left} ${bottom} ${back} ${right} ${bottom} ${back}`,
    `2 24 ${right} ${bottom} ${back} ${right} ${bottom} ${front}`,
    `2 24 ${right} ${bottom} ${front} ${left} ${bottom} ${front}`,
    `2 24 ${left} ${bottom} ${front} ${left} ${bottom} ${back}`,
    `2 24 ${left} ${top} ${back} ${left} ${bottom} ${back}`,
    `2 24 ${right} ${top} ${back} ${right} ${bottom} ${back}`,
    `2 24 ${right} ${top} ${front} ${right} ${bottom} ${front}`,
    `2 24 ${left} ${top} ${front} ${left} ${bottom} ${front}`,
    "0 Studs",
    ...studDefinitions(part, top),
  ].join("\n");
}

function studDefinitions(part, top) {
  const lines = [];
  const left = -(part.width * STUD_LDU) / 2;
  const back = -(part.depth * STUD_LDU) / 2;
  const bottom = top;
  const studTop = top - STUD_HEIGHT_LDU;
  const points = Array.from({ length: STUD_SEGMENTS }, (_, index) => {
    const angle = (index / STUD_SEGMENTS) * Math.PI * 2;

    return [
      Math.cos(angle) * STUD_RADIUS_LDU,
      Math.sin(angle) * STUD_RADIUS_LDU,
    ];
  });

  for (let xStud = 0; xStud < part.width; xStud += 1) {
    for (let zStud = 0; zStud < part.depth; zStud += 1) {
      const centerX = left + STUD_LDU / 2 + xStud * STUD_LDU;
      const centerZ = back + STUD_LDU / 2 + zStud * STUD_LDU;
      const topCenter = formatPoint([centerX, studTop, centerZ]);
      const topRing = points.map(([x, z]) => formatPoint([centerX + x, studTop, centerZ + z]));
      const bottomRing = points.map(([x, z]) => formatPoint([centerX + x, bottom, centerZ + z]));

      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const nextPointIndex = (pointIndex + 1) % points.length;
        lines.push(`3 16 ${topCenter} ${topRing[pointIndex]} ${topRing[nextPointIndex]}`);
        lines.push(
          `4 16 ${bottomRing[pointIndex]} ${bottomRing[nextPointIndex]} ${topRing[nextPointIndex]} ${topRing[pointIndex]}`,
        );
      }
    }
  }

  return lines;
}

function formatCoordinate(value) {
  const rounded = Number(value.toFixed(3));

  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatPoint(point) {
  return point.map(formatCoordinate).join(" ");
}

/**
 * Export model JSON into a packed LDraw/MPD string with embedded MVP part files.
 *
 * @param {import("../generation/types.js").GeneratedModel} model
 * @returns {string}
 */
export function exportModelToLDraw(model) {
  const lines = [
    `0 ${model.model_name}`,
    `0 Name: ${slugify(model.model_name)}.ldr`,
    "0 Author: HackThe6ix MVP Generator",
    "0 !LDRAW_ORG Model",
    `0 !KEYWORDS ${model.prompt}`,
    ...COLOUR_DIRECTIVES,
  ];

  let currentStep = null;

  for (const brick of model.bricks) {
    if (brick.step !== currentStep) {
      if (currentStep !== null) {
        lines.push("0 STEP");
      }

      currentStep = brick.step;
    }

    lines.push(modelLineForBrick(brick));
  }

  const usedParts = new Map();

  for (const brick of model.bricks) {
    const part = SUPPORTED_PARTS[brick.part_id];

    if (!part) {
      throw new Error(`Cannot export unsupported part ${brick.part_id}.`);
    }

    usedParts.set(part.ldraw_id, part);
  }

  for (const part of usedParts.values()) {
    lines.push(partDefinition(part));
  }

  return `${lines.join("\n")}\n`;
}
