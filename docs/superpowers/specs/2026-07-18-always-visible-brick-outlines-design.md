# Always-Visible Brick Outlines Design

## Goal

Make each committed LEGO brick visually distinct by showing a thin black body outline even when the brick is not selected. Preserve the editor's existing yellow selection and red invalid-state feedback.

## Visual Behavior

- A normal, unselected brick has a thin black outline around its body.
- A selected brick's outline changes from black to yellow.
- An invalid brick's outline stays red, including while selected, because invalid state has priority over selection.
- Temporary catalogue drag-preview bricks retain their current appearance and do not gain the permanent black outline.
- The outline continues to follow the brick through movement and rotation and continues to match the brick body's width, height, and depth.

## Implementation

Reuse the existing local `LineSegments` outline created for every brick in `src/preview/brickScene.js`. The outline already uses `EdgesGeometry` derived from the part's body dimensions, which avoids the alignment problems caused by world-space helpers.

Update the brick visual-state logic to apply this precedence:

1. Invalid: visible red outline.
2. Selected: visible yellow outline.
3. Normal committed brick: visible black outline.
4. Temporary preview brick: no permanent black outline.

Use the existing one-pixel `LineBasicMaterial` rendering for a thin outline. Normal black outlines remain depth-tested so rear edges do not show through the brick. Selected and invalid outlines preserve the current prominent, non-depth-tested highlight behavior.

## Scope

This change affects only editable brick rendering and visual-state transitions. It does not change model JSON, selection behavior, editor tools, brick geometry, validation, snapshots, or generated model data.

## Verification

Add a focused `brickScene` regression test that verifies:

- a committed unselected brick has a visible black outline;
- selecting it changes the outline to yellow;
- marking it invalid changes the outline to red and keeps red when selected;
- clearing invalid state restores yellow while selected;
- deselecting restores black;
- a temporary preview brick does not receive the permanent black outline.

Run the focused preview scene test first, then the existing preview test group. Browser/WebGL verification is excluded unless separately approved.
