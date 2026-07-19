# Inventory Review Readable Crop Design

## Goal

Make each LEGO piece visually identifiable during inventory review without changing segmentation, predictions, or saved review data.

## Design

- Show the existing unmasked `view.crop` as the primary review image.
- Increase the primary image area from 150 px to approximately 420 px high while preserving the image aspect ratio with `object-fit: contain`.
- Provide a two-state `Clear` / `Mask` control. `Clear` displays `view.crop`; `Mask` displays `view.masked_crop` and remains available for segmentation verification.
- Clicking the primary image opens the currently selected clear or masked asset at full available resolution in a lightweight modal. Escape, clicking the backdrop, or the close button closes it.
- Switching between alternate observations preserves the selected display mode and updates the modal source.

## Scope

This is a presentation-only change. It does not regenerate assets, alter LabelMe polygons, reassociate pieces, call Brickognize, or rewrite historical session artifacts.

## Acceptance

- The clear crop is the default for every component with a crop asset.
- The black `human-unmatched-001` component in session `20260718-161438` visibly shows its complete source crop at a useful size.
- The user can switch to the masked crop and open either version full-resolution.
- Existing review edits and navigation continue to work.
- Frontend behavior has regression coverage and the relevant test suites pass.
