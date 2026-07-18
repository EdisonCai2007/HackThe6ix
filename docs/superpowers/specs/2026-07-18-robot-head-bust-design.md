# Robot Head Bust Design

## Goal

Add one deterministic LEGO robot-head bust built exclusively from `randomBuildInventory`. The finished model must be recognizable from the front and from angled views, use the largest piece count allowed by the current validator, and pass all inventory and structural checks.

## Scope

The model will use exactly 100 pieces, matching the current `MAX_MODEL_PIECES` limit. It will not change the global piece limit, generation prompts, inventory contents, or part catalog. Brown and green inventory pieces will be used only as buried structural core material; the visible character palette will be white and black with blue eyes, a red mouth, and yellow antenna details.

## Model Design

The bust will have a broad, stable shoulder plinth, a narrower neck, and a fully three-dimensional angular head. The front face will combine a white mask with black helmet framing. Two symmetric blue inset eye regions will sit above a red mouth grille. Yellow pieces will form two supported antenna paddles joined by a top crown detail. The rear and side volumes will close the head silhouette so the result reads as a bust rather than a flat mosaic.

Large brown and green bricks and plates will form an internal core. Exterior white, black, blue, red, and yellow pieces will cover or surround that core on visible surfaces. Piece seams will alternate across layers where the available shapes allow it, keeping the construction visually LEGO-like and increasing stud connections between sections.

## Fixture Architecture

Create `src/generation/fixtures/robotHeadBustModel.js` in the same deterministic builder style as the archived fixtures. It will:

- import `getPartDimensions` and `randomBuildInventory`;
- create complete generated-brick records with part, LDraw, color, position, rotation, feature, and instruction-step metadata;
- divide construction into small helpers for the plinth, neck, head core and shell, face details, and antenna details;
- calculate model dimensions from the actual brick extents;
- export `buildRobotHeadBustModel(inventory = randomBuildInventory)`;
- return accurate model metadata, notes, dimensions, and piece count.

The preview will import this builder, retain the random assortment as the usable inventory, and display the robot bust as its initial deterministic model. Stale default-model imports that point at fixtures moved into `fixtures_old` will be replaced only where needed for this integration.

## Structural Rules

Every position will use integer stud and layer coordinates, and every rotation will be a quarter turn. No two brick volumes may occupy the same grid cell. Every raised piece must overlap at least one occupied stud cell immediately below it. All pieces must belong to one vertically stud-connected component, and the shoulder plinth must touch layer zero.

The implementation will use no more than each available part/color quantity in `randomBuildInventory`. It will not draw parts or colors from any archived inventory fixture.

## Error Handling and Repair

The model is deterministic, so build errors will be repaired in the placement tables or helper loops rather than hidden at runtime. After each meaningful construction stage, validation output will be inspected for inventory overuse, overlap, floating pieces, missing ground contact, or disconnected groups. Any reported brick IDs and occupied cells will be used to correct the offending placements, and validation will be rerun until no hard errors remain.

## Verification

Add a focused model test that builds the default robot and verifies:

- `piece_count` and `bricks.length` are exactly 100;
- `validateModel(model, randomBuildInventory)` reports `valid: true`;
- expected semantic features include head shell, face, eyes, mouth, antenna, neck, and shoulders;
- blue eyes, a red mouth, and yellow antenna details are present;
- no inventory combination exceeds its available quantity.

Run the focused model test while iterating. Before completion, run the relevant inventory, schema, validator, export, and preview tests that remain runnable in the current worktree, and report any unrelated pre-existing failures separately.
