# Guitar, Bonsai, and Duck Showcase Design

## Goal

Add three deterministic, presentation-ready LEGO showcases that use only the fixed 787-piece physical inventory: a Strat-style electric guitar, a Japanese bonsai, and a yellow duck.

## Locked palettes

- Guitar: red body, white pickguard and fret markers, brown neck, black fretboard and stand, dark-gray hardware, and small yellow controls.
- Bonsai: brown trunk and branches, green foliage, black display base, red pot, and dark-gray soil.
- Duck: yellow body and head, orange beak, black eyes, and a blue water base with white ripples.

These colors are requirements. Builders must use exact part/color inventory entries and must throw if a required entry is unavailable. They must never substitute a fallback color.

## Model designs

### Electric guitar

The guitar is a horizontal display model with a stepped double-cutaway red body, exposed white pickguard, multiple black pickups, dark-gray bridge, yellow control knobs, long brown neck, black fretboard, white fret markers, brown headstock, six contrasting tuning pegs, and connected black display support. The top-facing orientation keeps the silhouette and essential hardware readable. Target: 95–125 pieces.

### Bonsai

The bonsai uses a connected black plinth and red tapered pot, a dark-gray soil surface, a thick asymmetrical brown trunk with exposed roots and multiple supported branches, and several separated green foliage pads. Natural irregularity is intentional, but every branch and canopy cluster must remain validator-connected. Target: 80–110 pieces.

### Duck

The duck is a recognizable yellow rubber duck on a connected blue water base. Its stepped body includes a raised chest, rounded head, short tail, two black eyes, and a deliberately orange projecting beak. White plates provide limited water ripples without changing the duck palette. Target: 70–100 pieces.

## Inventory guarantee

Each model must pass schema, geometry, connectivity, build-order, and fixed-inventory validation independently. A separate aggregate test must sum every part/color pair across all three models and prove the three can be built simultaneously from one fixed inventory. Aggregate validation is based on exact part IDs and colors, not only total color counts.

## Integration

Add all three descriptors to the existing showcase registry and fixture preview picker. Selecting a suggestion must continue to stream the deterministic model through the current animated generation UI without external API credentials.

Stable IDs:

- `crimson-strat-electric-guitar`
- `japanese-bonsai-display`
- `golden-rubber-duck`

## Acceptance criteria

- Locked colors are visible only on their intended features.
- No model contains unsupported, excess, overlapping, floating, or disconnected pieces.
- The aggregate part/color budget fits the fixed inventory.
- The three suggestions appear only for compatible inventories.
- The three previews render clearly enough to recognize without reading their labels.
- The complete automated suite and production build pass.
