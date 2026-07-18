# MVP Scope And Stretch

## MVP Goal

Build a local app that can:

1. accept a confirmed LEGO inventory,
2. accept an unrestricted user prompt,
3. generate a small free-standing LEGO model using only available pieces,
4. validate the model against MVP buildability rules,
5. show it in a Three.js 3D preview.

## MVP Must-Haves

- React/Vite frontend
- local generation service
- confirmed inventory input
- unrestricted text prompt
- OpenRouter-compatible AI calls
- hybrid AI + constrained builder architecture
- deterministic validation
- LDraw export
- Three.js preview

## MVP Model Constraints

- 10-40 pieces preferred
- 50 pieces maximum
- one connected object
- free-standing
- rectangular bricks and plates only
- no baseplate requirement
- no multi-object scenes
- no loose accessories
- prioritize buildability over visual perfection
- prioritize recognizable silhouette over exact color

## MVP Prompt Behavior

The prompt should be unrestricted.

The system should not force users into presets. Instead, it should extract build intent:

- primary object
- key features
- size/style hints
- preferred colors

If the prompt asks for multiple objects, the MVP should choose the primary object.

If the prompt is too ambitious for the inventory, generate the closest small version.

## MVP Generation Behavior

The generator should:

- never ask follow-up questions during generation
- use only confirmed inventory
- use fewer pieces when needed
- repair invalid candidates if possible
- return a valid model or a simple fallback

## Stretch Goals

### Instruction Mode

Add interactive step-by-step building in Three.js.

Possible behavior:

- bricks appear one step at a time
- user advances through steps
- camera focuses on the next placement

### Manual Export

Generate printable or page-style build instructions.

Could use:

- model JSON step ordering
- LDraw `0 STEP` markers
- screenshots from fixed camera angles

### More Parts

Add support for:

- slopes
- wheels
- hinges
- transparent pieces
- decorative pieces
- specialty parts

### Better Physical Reasoning

Add stronger structural rules:

- center of mass approximation
- weak-overhang warnings
- support-area thresholds
- anti-tower heuristics

### Better Prompt Scoring

Generate multiple valid candidates and choose the best one using a critic/scorer.

### User Inventory Editing

Allow the user to correct detected inventory before generation.

This is useful if CV confidence is imperfect.

## Explicit Non-Goals

- full LEGO CAD editor
- BrickLink Studio replacement
- arbitrary 3D model voxelization
- room-scale object generation
- public deployment
- perfect detection of every LEGO piece
- perfect structural simulation

