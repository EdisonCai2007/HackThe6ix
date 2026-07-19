# Electric Guitar Hero Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sparse 95-piece guitar with a 180–220-piece top-facing Strat-style showcase whose stepped body contour and surface hardware are recognizable in the existing UI.

**Architecture:** Keep the existing deterministic fixture boundary and stable showcase ID. Rewrite the guitar builder as six focused placement stages, validate the resulting `GeneratedModel` against the fixed inventory, and preserve the existing fixture-picker and streaming integration without adding a provider dependency.

**Tech Stack:** Node.js ES modules, `node:test`, project `GeneratedModel` schema and validator, Vite/Three.js preview.

## Global Constraints

- Use the full fixed 787-piece inventory independently; do not require the guitar, bonsai, and duck to coexist.
- Target 180–220 pieces, at least 48 studs overall length, and at least 16 studs across the body.
- Use red only for the body; white for pickguard, controls, and markers; black for pickups, fretboard, and cradle; dark gray for bridge, strings, selector, and tuners; brown for neck and headstock.
- Include three pickups, three controls, six distinct string lanes, six tuners, a shaped pickguard, bridge, selector, asymmetric horns, and deep double cutaways.
- Keep stable showcase ID `crimson-strat-electric-guitar`, its current label, fixture-picker entry, and credential-free animated streaming behavior.
- Use only exact supported part/color pairs and never substitute fallback colors.

## File map

- Modify `test/generation/showcaseElectricGuitarModel.test.js`: encode the new piece, dimension, silhouette, hardware, lane, palette, and independent-inventory contract.
- Delete `test/generation/showcaseCollectionInventory.test.js`: remove the obsolete simultaneous three-model inventory constraint.
- Rewrite `src/generation/fixtures/showcaseElectricGuitarModel.js`: produce the larger six-stage deterministic model.
- Verify `src/generation/showcaseBuilds.js` and `src/preview/fixturePreviewPicker.js` without changing their stable guitar identifiers.

---

### Task 1: Lock the hero-guitar acceptance contract

**Files:**
- Modify: `test/generation/showcaseElectricGuitarModel.test.js`
- Delete: `test/generation/showcaseCollectionInventory.test.js`

**Interfaces:**
- Consumes: `buildShowcaseElectricGuitarModel(inventory): GeneratedModel`
- Produces: the executable acceptance contract for the rewritten fixture

- [ ] **Step 1: Replace the old size assertions with the hero target**

```js
assert.ok(model.piece_count >= 180);
assert.ok(model.piece_count <= 220);
assert.ok(model.dimensions.width_studs >= 48);
assert.ok(model.dimensions.depth_studs >= 16);
assert.ok(model.dimensions.height_layers <= 12);
```

- [ ] **Step 2: Add exact hardware and string-lane assertions**

```js
assert.equal(featureBricks(model, "pickup").length, 3);
assert.equal(featureBricks(model, "control-knob").length, 3);
assert.equal(featureBricks(model, "selector-switch").length, 1);
assert.equal(featureBricks(model, "tuning-peg").length, 6);

const stringLanes = new Set(
  featureBricks(model, "string-detail").map(({ id }) =>
    Number(/^string-(\d+)-/.exec(id)?.[1]),
  ),
);
assert.deepEqual([...stringLanes].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
```

- [ ] **Step 3: Add silhouette assertions based on named contour placements**

```js
const contour = featureBricks(model, "guitar-body");
const bodyXs = contour.map(({ position }) => position.x);
const bodyYs = contour.map(({ position }) => position.y);

assert.ok(Math.max(...bodyXs) - Math.min(...bodyXs) >= 20);
assert.ok(Math.max(...bodyYs) - Math.min(...bodyYs) >= 16);
assert.ok(contour.some(({ id }) => id.startsWith("lower-bout-")));
assert.ok(contour.some(({ id }) => id.startsWith("waist-")));
assert.ok(contour.some(({ id }) => id.startsWith("long-horn-")));
assert.ok(contour.some(({ id }) => id.startsWith("short-horn-")));
assert.ok(contour.some(({ id }) => id.startsWith("upper-cutaway-")));
assert.ok(contour.some(({ id }) => id.startsWith("lower-cutaway-")));
```

- [ ] **Step 4: Update the palette contract**

```js
const expectedColors = new Map([
  ["display-stand", "black"],
  ["guitar-body", "red"],
  ["pickguard", "white"],
  ["pickup", "black"],
  ["bridge", "dark gray"],
  ["control-knob", "white"],
  ["selector-switch", "dark gray"],
  ["neck", "brown"],
  ["fretboard", "black"],
  ["fret-marker", "white"],
  ["string-detail", "dark gray"],
  ["headstock", "brown"],
  ["tuning-peg", "dark gray"],
]);
```

- [ ] **Step 5: Delete the aggregate collection test and run the focused test**

Run: `node --test test/generation/showcaseElectricGuitarModel.test.js`

Expected: FAIL on the 180-piece threshold, 48-stud length, 16-stud body, three pickups, three white controls, selector, and six lanes.

- [ ] **Step 6: Commit the red acceptance contract**

```bash
git add test/generation/showcaseElectricGuitarModel.test.js test/generation/showcaseCollectionInventory.test.js
git commit -m "test: require hero-quality electric guitar"
```

---

### Task 2: Rebuild the cradle and stepped body silhouette

**Files:**
- Modify: `src/generation/fixtures/showcaseElectricGuitarModel.js`
- Test: `test/generation/showcaseElectricGuitarModel.test.js`

**Interfaces:**
- Consumes: `createShowcaseBrickFactory(inventory, modelName)` and `completeShowcaseModel(options)`
- Produces: `addMinimalDisplayCradle`, `addBodyFoundation`, and `addBodyContour`, each appending valid ordered placements to `bricks`

- [ ] **Step 1: Replace the wide stand with a minimal connected cradle**

Use black plates at `z: 0` beneath the body and headstock. Keep the cradle between 8 and 14 pieces and ensure every rail touches another cradle or guitar placement.

```js
function addMinimalDisplayCradle(bricks, brick) {
  const rails = [
    [0, 3], [0, 9], [8, 5], [8, 9], [46, 7], [46, 9],
  ];
  for (const [index, [x, y]] of rails.entries()) {
    bricks.push(brick({
      id: `stand-rail-${index}`,
      part_id: "4282",
      color_name: "black",
      position: { x, y, z: 0 },
      rotation: 90,
      feature: "display-stand",
      step: 1,
    }));
  }
}
```

- [ ] **Step 2: Build a two-course structural red body**

Lay the body on `z: 1` and `z: 4`. Use the available red 1x1, 1x2, 2x2, 2x3, 2x4, 1x3, 1x4, and 1x6 bricks to fill a connected profile from `x: 0..22`, with the widest bout spanning at least `y: 0..17`. Reserve top space for hardware at `z: 7`.

```js
function addBodyFoundation(bricks, brick) {
  // Lower bout: x 0..8, y 1..16.
  // Waist: x 9..13, y 4..13.
  // Shoulder: x 14..17, y 3..14.
  // Long horn: x 18..22, y 12..17.
  // Short horn: x 18..20, y 1..6.
  // Keep y 7..11 open beyond x 18 for the neck joint.
}
```

- [ ] **Step 3: Add a finer stepped upper contour**

Use red plates and smaller red bricks to stagger the outer edge by one or two studs between adjacent profile bands. Prefix IDs with `lower-bout-`, `waist-`, `long-horn-`, `short-horn-`, `upper-cutaway-`, and `lower-cutaway-` so the silhouette contract remains readable.

- [ ] **Step 4: Run the focused test and inspect validator output**

Run: `node --test test/generation/showcaseElectricGuitarModel.test.js`

Expected: silhouette and independent inventory assertions pass; hardware, final piece target, and string assertions remain red.

- [ ] **Step 5: Commit the body rebuild**

```bash
git add src/generation/fixtures/showcaseElectricGuitarModel.js
git commit -m "feat: sculpt hero guitar body"
```

---

### Task 3: Add accurate top hardware, neck, strings, and headstock

**Files:**
- Modify: `src/generation/fixtures/showcaseElectricGuitarModel.js`
- Test: `test/generation/showcaseElectricGuitarModel.test.js`

**Interfaces:**
- Consumes: the connected body and cradle from Task 2
- Produces: `addSurfaceHardware`, `addNeckAndStrings`, and `addHeadstock` placements completing the model

- [ ] **Step 1: Shape the white pickguard and add the SSS pickup layout**

Use 15–25 white pieces at `z: 7` to form an asymmetric field following the waist and lower horn. Add exactly three separate black pickup bars across the string direction, with IDs `pickup-neck`, `pickup-middle`, and `pickup-bridge`.

```js
for (const [id, x] of [["neck", 15], ["middle", 12], ["bridge", 9]]) {
  bricks.push(brick({
    id: `pickup-${id}`,
    part_id: "3710",
    color_name: "black",
    position: { x, y: 7, z: 8 },
    rotation: 90,
    feature: "pickup",
    step: 5,
  }));
}
```

- [ ] **Step 2: Add bridge, three controls, and selector**

Place a dark-gray bridge behind the bridge pickup. Use exactly three separate white 1x1 pieces for the volume/tone controls and one dark-gray piece for the selector, all supported by the pickguard or body.

- [ ] **Step 3: Extend and taper the neck**

Build a brown structural neck from `x: 18` through `x: 47`, centered on six string lanes. Add a black fretboard above it, narrow its outer edge for the final six studs, and place white position markers at `x: 24`, `x: 32`, `x: 40`, and `x: 44` rather than replacing entire black fretboard courses.

- [ ] **Step 4: Add six distinct dark-gray string lanes**

Give every lane at least one supported segment above the body hardware and one above the fretboard. IDs must follow `string-<1..6>-<segment>` so tests can prove all lanes exist.

```js
const stringPartIds = [
  ["3010", "3004", "3004"],
  ["3010", "3004", "3004"],
  ["3010", "3004", "3004"],
  ["3010", "3004", "3004"],
  ["3010", "3004", "3004"],
  ["3010", "3004", "3004"],
];

for (let lane = 1; lane <= 6; lane += 1) {
  const y = 5 + lane;
  const segments = [["body", 7], ["neck", 24], ["upper", 38]];
  for (const [index, [segment, x]] of segments.entries()) {
    bricks.push(brick({
      id: `string-${lane}-${segment}`,
      part_id: stringPartIds[lane - 1][index],
      color_name: "dark gray",
      position: { x, y, z: 10 },
      rotation: 90,
      feature: "string-detail",
      step: 8,
    }));
  }
}
```

- [ ] **Step 5: Refine the headstock and arrange six tuners**

Build a brown asymmetric headstock from `x: 47..53`, wider than the neck and visually offset toward one edge. Add exactly six dark-gray tuners in two staggered rows without overlaps.

- [ ] **Step 6: Update model metadata**

Set `generatorVersion` to `showcase-electric-guitar-v3`. Update notes to describe the larger independent-inventory hero model, stepped Strat contour, SSS hardware, and six string lanes.

- [ ] **Step 7: Run the focused test until green**

Run: `node --test test/generation/showcaseElectricGuitarModel.test.js`

Expected: all guitar tests PASS with 180–220 pieces and no validator errors.

- [ ] **Step 8: Commit the completed guitar**

```bash
git add src/generation/fixtures/showcaseElectricGuitarModel.js test/generation/showcaseElectricGuitarModel.test.js
git commit -m "feat: finish hero electric guitar details"
```

---

### Task 4: Verify integration and visual quality

**Files:**
- Verify: `src/generation/showcaseBuilds.js`
- Verify: `src/preview/fixturePreviewPicker.js`
- Verify: `src/generation/fixtures/showcaseElectricGuitarModel.js`

**Interfaces:**
- Consumes: stable ID `crimson-strat-electric-guitar` and completed v3 fixture
- Produces: verified UI suggestion, fixture preview, and animated generation behavior

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run the production build and whitespace check**

Run: `npm run build`

Expected: Vite build exits 0. The existing Node-version and bundle-size warnings may remain.

Run: `git diff --check`

Expected: no output and exit 0.

- [ ] **Step 3: Inspect the live fixture preview**

Open `http://127.0.0.1:5173/`, select `Crimson Strat Electric Guitar` from `Fixture preview`, and confirm:

- the outline reads as a guitar before reading its label;
- the lower bout, waist, unequal horns, and both cutaways are visible;
- the white pickguard does not cover the red outline;
- three pickups, three controls, bridge, selector, fret markers, six string lanes, and six tuners are distinguishable;
- the cradle is visually secondary;
- the model status is `Valid`.

- [ ] **Step 4: Verify animated showcase selection**

Click `Crimson Strat Electric Guitar` in Build ideas, click Generate, and confirm the existing streaming sequence rebuilds the deterministic v3 model without external credentials.

- [ ] **Step 5: Commit any visual corrections and push**

```bash
git add src/generation/fixtures/showcaseElectricGuitarModel.js test/generation/showcaseElectricGuitarModel.test.js
git commit -m "refine: polish hero guitar presentation"
git push origin codex/lego-generation-experiments
```
