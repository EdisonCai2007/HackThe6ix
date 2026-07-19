# Electric Guitar Hero Redesign

## Goal

Replace the current 95-piece electric-guitar showcase with a presentation-ready, top-facing Strat-style display model whose body silhouette and surface hardware are recognizable without reading its label.

## Inventory rule

The guitar may use the full fixed 787-piece inventory independently. It does not need to coexist physically with the bonsai or duck. Every placement must still use an exact supported part/color pair within its available quantity, and no fallback colors are allowed.

## Visual design

Target 180–220 pieces, an overall length of at least 48 studs, and a body at least 16 studs across its widest bout. The body must have a rounded lower bout, pinched waist, asymmetric upper and lower horns, and deep double cutaways. Because the inventory contains rectangular bricks and plates rather than curved slopes, the larger scale must create finer stepped contours instead of adding decorative bulk.

The top surface must include a shaped multi-piece white pickguard, three distinct black pickups, a dark-gray bridge, three white control knobs, a small selector switch, and six distinct parallel string lanes that continue from the bridge along the fretboard toward the headstock. The neck must be longer and slightly tapered, with a black fretboard, white position markers, a refined brown headstock, and six realistically arranged dark-gray tuners.

Use a minimal black display cradle so the inventory budget goes primarily toward the guitar. The locked palette is:

- Red: body
- White: pickguard, control knobs, and fret markers
- Black: pickups, fretboard, and display cradle
- Dark gray: bridge, strings, selector, and tuning hardware
- Brown: neck and headstock

## Construction

Rewrite the deterministic fixture in six ordered stages:

1. Minimal connected display cradle
2. Structural red body foundation
3. Stepped body contour and cutaways
4. Pickguard, pickups, bridge, controls, and selector
5. Neck, fretboard, markers, frets, and six string lines
6. Headstock and six tuners

Keep the existing stable showcase ID, fixture-picker entry, suggestion label, and streaming route so the current UI and animated build sequence require no integration changes. Increment the fixture generator version.

## Validation and testing

Remove the aggregate test that requires the guitar, bonsai, and duck to fit simultaneously. Keep independent exact-inventory validation for every showcase.

The redesigned guitar must:

- contain 180–220 pieces;
- be deterministic and schema-valid;
- pass geometry, connectivity, overlap, floating-piece, build-order, and exact-inventory validation;
- include three pickups, three controls, six distinct string lanes, six tuners, a shaped pickguard, bridge, selector, double cutaways, and asymmetric horns;
- be at least 48 studs long with a body at least 16 studs across its widest bout;
- use only the locked feature colors;
- retain the existing showcase ID and animated generation behavior;
- pass the complete automated test suite and production build;
- be visually inspected in the live preview, with body silhouette and hardware readability prioritized over raw piece count.
