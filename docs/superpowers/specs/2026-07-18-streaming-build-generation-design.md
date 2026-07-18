# Streaming Build Generation Design

## Goal

Let the LEGO builder show a locked, live 3D preview while the placement model and subsequent repair/refinement model are still generating. Complete brick objects should appear as soon as their JSON objects close; an incomplete trailing object must remain buffered until later chunks complete it.

## Decisions

- Streaming is one-way: model output flows into the app; the app does not send partial output back to the model during the stream.
- Preserve the existing generated-model JSON shape, including the `bricks` array.
- Stream the exact placement stage, then stream the repair/refinement stage after placement closes.
- Render each syntactically complete brick immediately and run full-model legality validation as the accumulated model changes. Invalid pieces may appear in the preview and use the existing invalid-state feedback.
- Merge bricks by `id`; a later complete object replaces the earlier provisional object with that id.
- The repair/refinement stream patches the same live canvas. The final repaired model is authoritative and may revise or remove earlier provisional bricks.
- If the stream ends with a trailing fragment, keep the complete bricks and send the assembled partial response through the existing repair path. Never commit the incomplete fragment as a brick.
- The live canvas is locked while generation is active. Editing tools become available only after the final result is accepted.
- Cancellation or unexpected stream failure preserves complete streamed bricks as an incomplete editable draft and exposes retry/recovery state.
- Backboard streaming is required; the provider adapters must expose one shared streaming contract.

## Architecture

### Provider streaming

Extend the direct Gemini client and Backboard client with a shared async stream method that yields text chunks and final metadata. The direct Gemini path consumes the provider's streaming response. The Backboard path forwards its streamed response instead of forcing `stream: false` and waiting for a completed message. Existing buffered `complete()` behavior remains available for non-streaming stages such as structure planning and suggestions.

The runtime logger must preserve request/response stage metadata and record streaming completion or failure without logging only a misleading stage-level success.

### Incremental JSON extraction

Add a small pure parser module that accepts arbitrary text chunks and keeps state across chunk boundaries. It must correctly handle quoted strings, escaped quotes, nested objects, and braces inside strings. Once an object inside the top-level `bricks` array is complete, emit that brick exactly once and retain any unfinished suffix for the next chunk. A malformed complete object is reported as a stream parse error; an incomplete suffix is not emitted.

The parser should also support the repair stream, where complete brick objects are merged by id into the same cumulative model. The final response still goes through the existing full generated-model shape and deterministic validation paths.

### Server events

The placement and repair endpoints emit named SSE events for:

- stage progress;
- each complete brick (`phase`, `brick`, sequence, and whether it replaced an existing id);
- parser/validation warnings that do not stop the stream;
- stream completion/failure;
- the existing final result payload.

Do not send the full cumulative model for every brick. The client owns the cumulative provisional model and applies brick patches in order.

The refinement endpoint must become an SSE endpoint with the same event contract. Existing session validation and final authoritative result behavior remain intact.

### Preview behavior

The frontend maintains a cumulative provisional model keyed by brick id. Placement brick events add or replace bricks; repair brick events patch the same model. The locked generation canvas updates through the existing editable-brick scene or an equivalent incremental scene path, without enabling selection, drag, rotate, delete, or catalogue tools. At completion, the final authoritative result replaces the provisional model and enters the normal editor/refinement flow.

Cancellation, superseded requests, and stream failures must not allow late events to mutate a newer generation request.

## Scope boundaries

- Do not change inventory semantics, part legality rules, model JSON field names, or final repair precedence.
- Do not add a second model-authority path in Three.js; the cumulative model state remains the source of truth.
- Keep structure planning buffered unless it is needed to start placement; only placement and repair/refinement stream brick objects.
- Preserve the existing non-streaming API behavior where callers do not opt into the streaming flow.

## Acceptance criteria

- A simulated response split in the middle of a brick object emits all earlier complete bricks immediately and emits the split brick only after its remainder arrives.
- Nested `position` objects, escaped strings, and arbitrary chunk boundaries do not break extraction.
- Placement and repair streams both reach the frontend as incremental brick events.
- Duplicate ids replace the provisional brick rather than creating a second scene object.
- A final incomplete suffix never becomes a committed brick.
- Complete streamed bricks survive cancellation and unexpected failure as an editable incomplete draft.
- Existing buffered generation and focused generation/server tests remain passing.
