# Guitar, Bonsai, and Duck Showcases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three detailed deterministic showcases with locked palettes and a combined exact-inventory guarantee.

**Architecture:** Each showcase is a focused fixture builder using `createShowcaseBrickFactory`, which rejects missing and excess exact part/color pairs. Registry and preview integration reuse the existing deterministic showcase route. A dedicated aggregate test independently sums the three models' exact inventory keys.

**Tech Stack:** JavaScript ES modules, Node test runner, existing GeneratedModel schema and geometry validator, Vite/Three.js preview.

## Global Constraints

- Use only supported entries from `fixedDemoInventory`.
- Never substitute or fall back to an unplanned color.
- All three models must fit the inventory simultaneously by exact `part_id:color_name` key.
- Preserve existing suggestion, streaming, preview, and instruction behavior.
- Use tests before production builders.

---

### Task 1: Electric guitar contract and builder

**Files:**
- Create: `test/generation/showcaseElectricGuitarModel.test.js`
- Create: `src/generation/fixtures/showcaseElectricGuitarModel.js`

**Interfaces:**
- Consumes: `fixedDemoInventory`, `createShowcaseBrickFactory`, `completeShowcaseModel`.
- Produces: `buildShowcaseElectricGuitarModel(inventory = fixedDemoInventory): GeneratedModel`.

- [ ] Write a failing test importing `buildShowcaseElectricGuitarModel`, asserting schema validity, determinism, 95–125 pieces, a horizontal display footprint, validator success, and features `display-stand`, `guitar-body`, `pickguard`, `pickup`, `bridge`, `control-knob`, `neck`, `fretboard`, `fret-marker`, `headstock`, and `tuning-peg`.
- [ ] Assert the locked feature colors: red body, white pickguard/markers, black pickups/fretboard/stand, brown neck/headstock, dark-gray bridge, and yellow knobs.
- [ ] Run `node --test test/generation/showcaseElectricGuitarModel.test.js`; expect module-not-found failure.
- [ ] Implement an inventory-safe horizontal double-cutaway model ordered from display support/body through neck/headstock.
- [ ] Re-run the focused test; expect all guitar cases to pass.

### Task 2: Bonsai contract and builder

**Files:**
- Create: `test/generation/showcaseBonsaiModel.test.js`
- Create: `src/generation/fixtures/showcaseBonsaiModel.js`

**Interfaces:**
- Consumes: the same strict showcase helpers and fixed inventory.
- Produces: `buildShowcaseBonsaiModel(inventory = fixedDemoInventory): GeneratedModel`.

- [ ] Write a failing test asserting schema validity, determinism, 80–110 pieces, validator success, and features `display-base`, `pot`, `soil`, `root`, `trunk`, `branch`, and `foliage`.
- [ ] Assert black base, red pot, dark-gray soil, brown woody features, and green foliage.
- [ ] Run the focused test; expect module-not-found failure.
- [ ] Implement the connected plinth, tapered pot, roots, asymmetrical supported trunk, branches, and separated foliage pads.
- [ ] Re-run the focused test; expect all bonsai cases to pass.

### Task 3: Duck contract and builder

**Files:**
- Create: `test/generation/showcaseDuckModel.test.js`
- Create: `src/generation/fixtures/showcaseDuckModel.js`

**Interfaces:**
- Consumes: the same strict showcase helpers and fixed inventory.
- Produces: `buildShowcaseDuckModel(inventory = fixedDemoInventory): GeneratedModel`.

- [ ] Write a failing test asserting schema validity, determinism, 70–100 pieces, validator success, and features `water`, `ripple`, `duck-body`, `wing`, `tail`, `neck`, `head`, `eye`, and `beak`.
- [ ] Assert blue water, white ripples, yellow duck features, black eyes, and orange beak.
- [ ] Run the focused test; expect module-not-found failure.
- [ ] Implement the connected water base and stepped yellow rubber-duck silhouette with a projecting orange beak.
- [ ] Re-run the focused test; expect all duck cases to pass.

### Task 4: Combined inventory budget

**Files:**
- Create: `test/generation/showcaseCollectionInventory.test.js`

**Interfaces:**
- Consumes: all three model builders and `fixedDemoInventory`.
- Produces: regression coverage for aggregate exact part/color usage.

- [ ] Build all three models, count bricks by `${part_id}:${color_name}`, and compare every aggregate count with the matching supported inventory item.
- [ ] Assert every brick key exists and every aggregate count is less than or equal to availability.
- [ ] Run all four new model tests. If the aggregate test fails, replace placements with available exact part/color pairs without changing locked feature colors.

### Task 5: Registry and preview integration

**Files:**
- Modify: `src/generation/showcaseBuilds.js`
- Modify: `src/preview/fixturePreviewPicker.js`
- Modify: `test/generation/showcaseBuilds.test.js`
- Modify: `test/preview/fixturePreviewPicker.test.js`
- Modify: `test/server/generationServerRoutes.test.js`

**Interfaces:**
- Consumes: the three new builders.
- Produces: stable showcase descriptors, suggestions, prompt matching, generation, and previews.

- [ ] Extend failing registry, preview, and route expectations with `crimson-strat-electric-guitar`, `japanese-bonsai-display`, and `golden-rubber-duck`.
- [ ] Run the focused integration tests; expect missing-descriptor failures.
- [ ] Register each builder with concise metadata and exact prompt phrases; add all three fixed-inventory previews.
- [ ] Re-run focused integration tests; expect all cases to pass.

### Task 6: Visual and release verification

**Files:**
- Modify fixture placement files only if visual defects are found.

- [ ] Restart the development server so the generation route loads the expanded registry.
- [ ] Generate all three suggestions through the UI and inspect silhouette, palette, framing, and build animation.
- [ ] Refine only defects that materially hurt recognition, then re-run focused tests.
- [ ] Run `npm test`; expect zero failures.
- [ ] Run `npm run build`; expect a successful production build, allowing the repository's existing Node-version and chunk-size warnings.
- [ ] Run `git diff --check`; expect no output.
- [ ] Commit the locked design, builders, tests, and integration; push the existing branch so draft PR #2 updates.
