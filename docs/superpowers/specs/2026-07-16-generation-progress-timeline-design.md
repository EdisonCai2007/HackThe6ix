# Generation Progress Timeline Design

## Context

The preview currently submits one blocking `POST /api/generate` request. The backend does know the internal generation stages, but the browser only sees a final success or failure. When OpenRouter returns prose such as `We need to...` instead of JSON, the user cannot tell whether the failure happened during structure planning, repair, placement planning, schema validation, or deterministic validation.

## Goals

- Show a visible timeline for the generation pipeline in the preview UI.
- Include all seven user-facing stages:
  - structure generation
  - structure JSON parse
  - structure JSON repair
  - placement generation
  - placement JSON parse
  - placement JSON repair
  - validation
- Mark each stage as pending, running, complete, skipped, or failed.
- Show the exact failed stage and existing error payload when a stage fails.
- Keep the existing non-streaming `/api/generate` endpoint working.
- Avoid exposing the OpenRouter API key to browser code.

## Non-Goals

- No job queue or persistence.
- No retry controls in the UI.
- No change to model validation rules.
- No silent fixture fallback when generation fails.

## Architecture

`generateModel()` will accept an optional `onProgress(event)` callback. The service will emit events at every stage boundary and include enough detail for the UI to update a deterministic timeline.

The local Node server will add `POST /api/generate/stream`, which returns Server-Sent Events. This route will validate the same request body as `/api/generate`, construct the OpenRouter client on the server, forward progress events, then send one final `result` event.

The preview will prefer the streaming endpoint. It will render the seven timeline rows in the existing overlay, update stage states from progress events, and still render the final model only after a successful final result.

## Event Contract

Progress events use this shape:

```js
{
  type: "stage",
  stage: "structure_generate",
  status: "running",
  label: "Structure generation"
}
```

Allowed statuses are:

- `pending`
- `running`
- `complete`
- `skipped`
- `failed`

The final SSE message uses event name `result` and contains the same result object as `/api/generate`.

## Error Handling

If initial parsing fails and repair succeeds, the parse stage is marked `complete` and the repair stage is marked `complete`.

If initial parsing succeeds, the matching repair stage is marked `skipped`.

If repair fails, the repair stage is marked `failed` and the final result preserves the existing `structure_parse` or `placement_parse` failure stage.

If schema or deterministic validation fails, the validation stage is marked `failed` and existing errors are shown.

## Testing

Use `node --test`.

Tests should cover:

- `generateModel()` emits stage progress for a fully successful generation.
- `generateModel()` marks repair stages as skipped when parsing succeeds.
- `generateModel()` emits a failed placement repair stage when malformed placement JSON remains invalid after one repair.
- SSE formatting sends named progress and result events.

Manual verification should include:

- Start the local generation service.
- Start Vite.
- Generate a model.
- Confirm the seven-stage timeline advances.
- Confirm malformed placement JSON shows the failed timeline row and exact parse error.
