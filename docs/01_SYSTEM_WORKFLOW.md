# System Workflow

## End-To-End Flow

```text
Camera/photo scan
  -> LEGO detection pipeline
  -> confirmed inventory payload
  -> user prompt
  -> prompt interpretation
  -> AI design plan
  -> constrained model builder
  -> deterministic validator
  -> repair loop if needed
  -> generated model JSON
  -> LDraw export
  -> Three.js 3D preview
```

## Workflow Ownership

### Emily's Pipeline

Emily's pipeline produces the inventory. It may use CV models, image processing, Rebrickable, LDraw part references, or other lookup systems. The generator does not need to know how detection works.

Expected responsibilities:

- accept camera/photo input
- detect individual LEGO pieces
- identify supported part type
- identify color
- map pieces to known identifiers when possible
- combine duplicates into counts
- return confirmed inventory

### Generator Pipeline

The generator receives inventory and prompt data. It should treat the inventory as the source of truth.

Expected responsibilities:

- accept unrestricted user prompts
- extract build intent from the prompt
- design a small object that approximates the prompt
- place only available pieces
- validate physical plausibility at the MVP rule level
- export a renderable model

## Local-First Architecture

The project is expected to run locally for the hackathon demo. It does not need public deployment.

Recommended local setup:

```text
React/Vite frontend
  - camera/upload UI
  - prompt input
  - generated model preview
  - Three.js scene

Local generation service
  - OpenRouter API calls
  - prompt interpretation
  - model generation
  - validation
  - repair loop
  - LDraw export
```

The local backend/service is recommended even for local-only usage because API keys should not live in browser code. It also keeps model-generation logic separate from UI rendering.

## Main User Flow

1. User opens the app locally.
2. User scans or uploads a photo of their LEGO pieces.
3. Detection pipeline returns confirmed inventory.
4. App shows or stores the detected inventory.
5. User types a custom prompt.
6. Generator builds the closest feasible object using only confirmed pieces.
7. App renders the generated LEGO model in a 3D viewer.
8. App optionally explains compromises, such as missing colors or simplified features.

## Failure Handling

The MVP should avoid blocking the user with follow-up questions. If inventory is limited, the system should generate the closest possible build automatically.

Examples:

- If the user asks for a dragon but has mostly rectangular red and blue bricks, generate a small dragon-inspired model with body, head, legs, and tail.
- If there are not enough pieces for wings, omit or simplify the wings.
- If requested colors are unavailable, prioritize silhouette over color.

The app can explain compromises after generation, but it should not stop the flow.

