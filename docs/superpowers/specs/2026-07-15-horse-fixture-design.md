# Horse Fixture Design

## Goal

Add a deterministic brown horse LEGO fixture and render it in the existing Three.js preview. The fixture prioritizes physical LEGO buildability over visual detail.

## Requirements

- The horse is a single connected assembly.
- Connections come from vertical stud overlap only.
- Same-layer side contact does not count as a connection.
- Loose same-layer pieces are only allowed if a brick or plate above bridges them into the main structure.
- The horse has a body, head, four legs, hooves, mane, and tail.
- The horse stands on all four legs.
- The model has 3D volume, not a flat side profile.
- The model uses only supported rectangular MVP parts from `src/generation/partCatalog.js`.
- The model stays under the hard 50-piece limit.
- `validateModel()` must accept the horse fixture.

## Architecture

The feature follows the existing fixture pattern:

- `src/generation/fixtures/horseInventory.js` defines a manual test inventory with brown horse pieces and black detail pieces.
- `src/generation/fixtures/horseModel.js` exports `buildHorseModel(inventory = horseInventory)`.
- `test/generation/horseModel.test.js` verifies validity, feature coverage, piece count, and LDraw export colors.
- `src/preview/main.js` imports the horse fixture and renders it instead of the daisy fixture.

## Model Strategy

The horse uses a compact 3D footprint so support and overlap remain easy to reason about:

- Four black hoof bricks sit on the ground at the corners.
- Brown leg bricks sit directly above the hooves.
- A lower brown body layer overlaps the tops of all four legs, joining them into one assembly.
- A staggered upper body layer overlaps the lower body and gives the torso volume.
- A neck and head step upward from the front body cells with direct vertical overlap.
- Black mane pieces sit on top of the neck/head cells they decorate.
- A black tail attaches above the rear body through overlap.
- Brick-height hooves are used instead of plates so the preview geometry and validator both represent direct vertical stacking.

Visual detail is intentionally simplified when it would otherwise create a weak or floating connection.

## Testing

The horse test must fail before production code exists, then pass after the fixture is implemented. It checks:

- `validateModel(buildHorseModel(horseInventory), horseInventory).valid === true`
- the model is below 50 pieces
- there are exactly four leg features and four hoof features
- head, body, mane, and tail features exist
- exported LDraw includes brown and black colors

## Constraints

The current workspace is not a git checkout, so the spec and implementation cannot be committed from this folder.
