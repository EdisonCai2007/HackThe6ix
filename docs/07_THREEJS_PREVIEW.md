# Three.js Preview

## Purpose

The MVP preview should show the generated LEGO model in 3D so the user can inspect it before trying to build it.

The preview is the main visible payoff for the hackathon demo.

## Assumed Stack

```text
Vite
React
Three.js
Three.js LDrawLoader
```

## Visual Direction

The desired visual style is minimal and kid-friendly, with a polished 3D model viewer.

For the 3D model area:

- dark environment
- 360-degree orbit view
- model centered in scene
- simple lighting that makes brick shapes readable
- no cluttered UI around the model

The user mentioned a Blender-like dark environment. The viewer should feel like a focused 3D inspection space, not a marketing page.

## MVP Preview Features

Required:

- load generated LDraw model
- show model in 3D
- orbit/rotate camera
- zoom/pan if easy
- render individual LEGO pieces clearly

Optional:

- show model name
- show piece count
- show inventory usage summary
- show short generation notes

Deferred:

- step-by-step build playback
- animated bricks moving into place
- printable instruction manual
- AR view
- physics simulation

## Data Flow

```text
Local generation service
  -> generated model JSON
  -> LDraw text or file/blob
  -> React viewer
  -> Three.js LDrawLoader
  -> rendered scene
```

## Preview Does Not Validate

The Three.js preview should not be responsible for enforcing build rules.

Validation happens before rendering. The preview can assume the model is already accepted by the validator.

## UX Notes

The app should avoid overwhelming kids with technical controls.

Good controls:

- regenerate
- rotate/orbit naturally
- maybe "try another build"

Avoid for MVP:

- complex editor tools
- raw coordinate editing
- advanced material settings
- manual brick placement UI

## Future Instruction Mode

Future mode:

```text
model JSON step order
  -> group bricks by step
  -> show step N in Three.js
  -> animate next brick/group into place
```

This is explicitly not MVP, but the model data should preserve enough ordering to support it later.

