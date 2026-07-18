# Build Editor Design

## Context

The preview currently shows generated LEGO models in a Three.js scene after the AI generation flow finishes. The next step is to make that workspace editable so users can add, move, rotate, and fix pieces before moving into instructions.

The generated model JSON remains the source of truth. Editor actions should update that model state, while the Three.js scene updates smoothly from per-brick objects instead of reparsing and regenerating the entire model for every edit.

## Goals

- Add a build editor mode after AI generation completes.
- Show a right-side catalogue of available brick inventory.
- Allow users to drag new bricks from the catalogue into the 3D scene.
- Allow users to select and move existing generated bricks.
- Provide three editor tools: hand, axis, and rotate.
- Snap hand drops to the nearest LEGO grid cell.
- Place dragged bricks on top of existing bricks when the pointer is over an occupied footprint.
- Keep editing permissive so users can temporarily create invalid builds.
- Block the transition to instructions when validation fails.
- Highlight invalid bricks with a flashing red xray-style outline so the user can manually fix them.
- Replace the full generation timeline with a compact status message and loading spinner.

## Non-Goals

- No auto-fix behavior for invalid builds.
- No physics simulation.
- No change to AI generation behavior.
- No full instruction builder in this design.
- No broad rewrite of the generation service or inventory schema.

## Interaction Model

The top toolbar has three tools.

`Hand` is the default. The user can click a brick and drag it freely through the scene. While dragging, the piece follows the pointer smoothly. On release, it snaps to the nearest LEGO grid position. If the piece is being held over another brick footprint, the drop height snaps to the top surface of that stack.

`Axis` is for precise placement. Selecting a brick shows a transform gizmo with X, Y, and Z handles. Dragging a handle moves the selected brick only along that axis. Horizontal movement uses stud increments. Vertical movement uses plate-layer increments.

`Rotate` rotates the selected brick by 90 degrees around its visual center. Rotation does not attempt to repair placement. If rotation leaves the piece off-grid, overlapping, or unsupported, the editor allows it until the user tries to continue to instructions.

The editor is intentionally permissive. Once AI generation is done, users have full control over the build. Invalid states are allowed while editing and are only blocked at the instructions transition.

## Catalogue

The right side of the viewport contains a vertical catalogue of supported inventory items. Each card shows:

- a small visual preview of the brick model
- a short label such as `1x2 brick`
- a count such as `3 / 16`

Used-up pieces stay visible but are disabled and greyed out. Dragging from a card creates a new brick only when the remaining count is greater than zero.

Catalogue counts come from the current model state and selected inventory. Adding a brick decreases the remaining count. Removing a brick increases it. Moving or rotating an existing brick does not affect counts.

## Model And Scene Architecture

The model JSON is the persistent editor source of truth. It tracks brick IDs, part IDs, colors, grid positions, rotations, features, and steps.

The Three.js scene should maintain a `Map<brickId, Object3D>` for rendered brick objects. Initial generation can still use the current LDraw export/rendering path. Once in editor mode, local edits should update only the affected brick object whenever possible:

- moving one brick updates that object's transform
- rotating one brick updates that object's rotation and footprint metadata
- adding one brick creates one object
- removing one brick disposes one object

Full model re-rendering is reserved for generation completion, model replacement, or a hard reset. Normal editor interactions should feel seamless and should not visibly reload the scene.

The editor can reuse the existing part catalog dimensions and LDraw-style brick geometry, but it should expose enough per-brick object structure for selection, outlines, transform gizmos, and invalid highlights.

## Validation Gate

Editing does not block invalid states. The `Instructions` action is the validation gate.

When the user clicks `Instructions`, the app runs full validation against the current model and inventory. If validation passes, the app can continue to the instructions flow. If validation fails, the app remains in editor mode, updates the status message, and highlights the affected bricks.

Existing validation rules still apply:

- inventory counts must not be exceeded
- parts must be supported
- pieces must not overlap
- upper pieces need support
- the build must be one connected assembly
- the model needs ground contact

The validator should also catch editor-specific snapping issues before instructions:

- `position.x` must be a whole stud coordinate
- `position.y` must be a whole stud coordinate
- `position.z` must be a whole plate-layer coordinate
- `rotation` must be `0`, `90`, `180`, or `270`

## Error Highlighting

Validation issues with a `brick_instance_id` map directly to scene objects. Those bricks receive:

- a flashing red outline
- a faint transparent red overlay
- depth-visible/xray styling so the user can identify bad pieces even when partially hidden

For model-level issues, the UI should highlight affected bricks when practical. For example, disconnected component errors should highlight the bricks in disconnected groups if the validator can report them. If the validator cannot identify exact bricks for a model-level issue, the status panel shows the issue without a brick highlight.

There is no auto-fix. The user repairs the build manually with hand, axis, and rotate tools.

## UI Layout

The viewport remains the main experience.

The top toolbar sits inside the 3D view and uses compact icon buttons for:

- hand
- axis
- rotate
- instructions

The selected tool is visually active. Actions that require a selected brick are disabled when no brick is selected.

The right catalogue is fixed on desktop. On small screens, it can collapse into a bottom drawer or horizontal strip, but desktop should keep the right-side vertical catalogue.

The model card is simplified to show:

- model name
- piece count
- current status

The existing multi-row generation timeline becomes one status line. During AI generation it shows the current stage and a loading spinner, such as `Generating: placement repair`. After generation, it shows editor statuses such as `Editing`, `Invalid: fix 3 pieces before instructions`, or `Ready for instructions`.

## Testing And Verification

Keep automated coverage focused on core model behavior:

- catalogue counts update from model state
- used-up catalogue items are disabled but still visible
- hand drops snap to whole stud and plate coordinates
- axis moves affect only the selected axis
- rotate changes rotation in 90-degree steps
- instructions validation blocks invalid models
- snapped-position validation catches off-grid coordinates and invalid rotations

Manual browser verification should confirm the editor feels seamless:

- drag a new brick from the catalogue into the scene
- place a brick on top of an existing brick
- move an existing generated brick
- rotate a selected brick
- intentionally create an invalid build
- click instructions and see flashing red xray highlights
- manually fix the highlighted blocks

## Implementation Scope

The first implementation should stay in the preview/editor path. It should introduce the editor state and per-brick scene update path without changing AI generation behavior.

The most important implementation constraint is smooth editing. Model JSON remains authoritative, but normal edits should update individual brick objects instead of reparsing or recreating the entire model.
