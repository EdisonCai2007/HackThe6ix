# Floating Confirmation Card Design

## Accepted direction

The user selected the compact yellow quick-confirmation card shown in the current viewer and explicitly rejected the permanent right-hand review column. The camera image should occupy the full main width. A yellow segmentation silhouette and leader line identify the selected piece; no numbered box is shown.

## Interaction

- The floating card shows the proposed color/type, confidence, and only **Yes** and **No**.
- **Yes** saves the current model prediction and advances to the highest-confidence unresolved piece.
- **No** swaps the contents of the same floating card into a correction state. It does not open a sidebar or a separate page.
- The correction state asks only for the piece type, with the example `Brick 2 x 8`, plus compact **Back** and **Save** controls.
- **Save** persists the correction and advances; **Back** restores the question without writing.
- Existing maintenance dialogs and their internal inspectors remain available, but the primary quick-confirmation view has no permanent inspector column.

## Layout and accessibility

The stage fills the main area beneath the header. The floating card stays in the upper-right of the image stage and remains compact on narrow screens. Its controls retain accessible labels, keyboard focus, and visible locked/saving/error states. The leader line is hidden only while the correction content is open so the user can type without visual clutter.

## Verification

Automated tests assert that the primary main layout is single-column, the card owns the correction form, and no primary inspector is rendered. Browser QA checks full-width imagery, card placement, Yes/No sizing, No-to-correction transition, example text, Back, and Save without mutating the original review data.
