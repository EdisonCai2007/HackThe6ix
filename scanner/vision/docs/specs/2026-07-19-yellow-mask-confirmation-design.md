# Yellow Mask Confirmation Design

## Goal

Replace the obstructive numbered waypoint rectangle with the piece's real segmentation silhouette and reduce the confirmation experience to a compact yellow-themed Yes/No interaction with a focused type-correction slide.

## Confirmation state

- The selected piece is visualized from `assets.views[0].mask` positioned by `assets.views[0].crop_box_original` over its source frame.
- A small client-side canvas converts the binary mask's luminance into transparency and paints the surviving pixels LEGO yellow. CSS drop-shadows add the halo to that transparent silhouette, so no crop rectangle can appear. The underlying button remains an invisible hit target; it has no border and no visible waypoint number.
- A thin yellow leader line connects the segmentation to a compact callout.
- The callout contains the prediction, confidence, and two small buttons labeled exactly `Yes` and `No`.
- `Yes` keeps the existing behavior: accept the prediction, save it, and advance to the highest-confidence unresolved piece.

## Correction state

- `No` hides the quick-confirmation callout and replaces the normal inspector contents with a focused correction slide.
- The slide shows the piece crop, the heading `What LEGO piece is this?`, one type input with placeholder `e.g. Brick 2 x 8`, an example hint, and compact `Back` and `Save` buttons.
- `Back` returns to the confirmation state without saving.
- `Save` clears the incompatible predicted part ID, copies the entered type into the existing review form, marks the segmentation correct, saves through the existing component API, and advances normally.
- Color is not requested on this slide; the existing predicted/review color is retained.

## Scope and compatibility

- Keep the existing inventory review API and review document unchanged.
- Keep detailed annotation controls in the DOM for existing workflows, but hide them during the focused correction state.
- Preserve keyboard/navigation behavior outside the correction input.
- Use the repository's existing mask assets; do not generate new geometry or imagery.
- Apply the yellow theme to this confirmation interaction without changing semantic red/green duplicate and inclusion states.

## Verification

- Static client tests assert the mask asset/crop path, absence of a visible waypoint label, compact Yes/No copy, and correction slide controls.
- Browser testing on the disposable workspace verifies the real yellow silhouette, compact buttons, No → correction slide, Back, and Save/advance.
- Run the complete `lego-cv` test suite and JavaScript syntax check.
