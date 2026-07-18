# Project Context

## Product Idea

This project is a local-first app that helps a user build something new from the LEGO pieces they already have.

The user takes a photo or live camera scan of a pile of LEGO pieces. The scan produces a confirmed inventory of parts and colors. The user then enters an unrestricted prompt such as "build me a duck", "make a tiny race car", or "a cyberpunk dragon with wings". The generation system creates a small LEGO model using only pieces from the detected inventory, then shows the result in a 3D preview.

The main product promise is:

> Scan your LEGO pieces, describe what you want, and get a buildable 3D LEGO model made only from your pieces.

## Target User

The target user is a kid or beginner LEGO builder. The app should feel simple, playful, and low-friction. The technical system can be complex internally, but the user-facing flow should stay minimal:

1. Scan pieces.
2. Ask for something to build.
3. View the generated model in 3D.

## Team Split

Emily owns the computer vision and camera/inventory side:

- camera/photo capture
- LEGO part detection
- color detection
- matching detected pieces to Rebrickable/LDraw-style identifiers
- producing a clean inventory payload

This generator side owns:

- consuming the confirmed inventory payload
- interpreting the user's prompt
- generating a LEGO model from the user's actual pieces
- validating that the model is inventory-safe and buildable enough for MVP
- exporting/rendering the generated model through LDraw/Three.js

The generator should not depend on raw camera images. It should start from structured inventory data.

## Core Constraint

The generator must not hallucinate pieces.

It is acceptable to use only some of the user's pieces. It is not acceptable to use a part, color, or quantity that the user does not have in their confirmed inventory.

## MVP Product Scope

The MVP should generate small, free-standing, one-object LEGO models:

- 10-40 pieces preferred
- 50 pieces maximum
- rectangular bricks and plates first
- no slopes, hinges, wheels, minifig pieces, printed decorations, or specialty pieces required
- one connected object, not a scene
- no mandatory baseplate
- 3D preview first
- build instructions deferred

## Non-Goals For MVP

The MVP does not need to:

- use every scanned piece
- generate a full room-scale or large sculpture
- support all LEGO part categories
- simulate perfect structural stability
- generate a printable instruction manual
- animate step-by-step building
- deploy publicly

## Chosen Direction

The chosen generation approach is a hybrid AI + deterministic validation system:

1. AI interprets the prompt and proposes a design.
2. A constrained builder converts the design into brick placements.
3. A deterministic validator checks inventory, geometry, and simplified LEGO connection rules.
4. A repair loop asks AI or builder logic to fix invalid output.
5. The final result is exported to LDraw and rendered in Three.js.

This keeps the project flexible and demo-friendly while preventing the most damaging failure mode: generating impossible models from pieces the user does not have.

