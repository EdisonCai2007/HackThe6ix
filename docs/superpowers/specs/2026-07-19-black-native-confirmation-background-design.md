# Black Native Confirmation Background Design

## Goal

Make the native OpenCV confirmation screen use the project's black-and-yellow
theme by changing its outer canvas background to pure black.

## Scope

Change only the initial canvas fill in `opencv_confirmation.py` from the current
dark slate/brown value to BGR `(0, 0, 0)`. Preserve the camera image, yellow
segmentation tint, confirmation card, mascot, text, buttons, layout, keyboard
and mouse behavior, inventory constraints, persistence, and handoff behavior.

## Verification

Add or update a focused rendering assertion that an untouched outer-canvas
pixel is pure black. Run the OpenCV confirmation tests and confirm the diff
contains no unrelated source changes.
