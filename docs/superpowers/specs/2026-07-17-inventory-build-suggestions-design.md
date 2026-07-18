# Inventory Build Suggestions Design

## Context

The current generation flow starts after the user types a prompt and submits the form. The app already receives a confirmed LEGO inventory before that point, and the inventory contains enough shape and color information to suggest buildable object ideas before the user writes anything.

This feature adds an automatic AI suggestion stage between confirmed inventory input and user prompt entry.

## Goals

- Generate up to 5 possible build ideas from the selected confirmed inventory.
- Base suggestions on available part shapes, part counts, part categories, and colors.
- Use larger brick-heavy inventories for bulkier objects and plate-heavy inventories for flatter objects.
- Show users only simple suggestion labels.
- Store richer hidden prompt metadata for each suggestion.
- When a user selects a suggestion, fill the existing prompt input with the hidden prompt metadata and allow editing before generation.
- Use a separate Gemini model setting for suggestions:
  - `GEMINI_SUGGESTION_MODEL=gemini-flash-lite-latest`

## Non-Goals

- No automatic generation after a suggestion click.
- No visual thumbnail generation for suggestions.
- No persistence of suggestion history.
- No deterministic build validation during suggestion generation.
- No changes to the existing placement, validation, repair, or editor flow.

## User Experience

The left panel column will contain three stacked panels:

1. Status/info panel.
2. Build suggestions panel.
3. Existing prompt form.

The suggestions panel appears after inventory is available. It automatically loads suggestions for the current inventory. During loading, it shows a compact loading state. On success, it shows up to 5 selectable labels such as `Sportscar`, `Robot`, or `Bridge`.

Each visible label maps to hidden prompt metadata. For example:

```json
{
  "label": "Sportscar",
  "prompt_metadata": "red sportscar with 4 wheels, windshield, and a thin spoiler"
}
```

When the user clicks `Sportscar`, the existing prompt input is set to:

```text
red sportscar with 4 wheels, windshield, and a thin spoiler
```

The user can then edit the prompt and press Generate manually.

## Suggestion Contract

The AI response should be one JSON object:

```json
{
  "suggestions": [
    {
      "label": "Sportscar",
      "prompt_metadata": "red sportscar with 4 wheels, windshield, and a thin spoiler",
      "inventory_reasoning": "red bricks support the body color and plates support a low profile"
    }
  ]
}
```

Field rules:

- `suggestions`: array with 1 to 5 entries.
- `label`: short user-facing title. This is the only field shown in the panel.
- `prompt_metadata`: richer build prompt copied into the existing prompt input on click.
- `inventory_reasoning`: internal explanation for tests/debugging and future tuning. It is not shown to the user.

## Prompt Behavior

The suggestion prompt should send the same supported inventory summary used by the structure and placement prompts:

- `inventory_id`
- `source`
- supported items only
- part id
- LDraw id
- color name and color id
- count
- dimensions
- category-derived height

The system instruction should tell Gemini to:

- return JSON only;
- generate at most 5 suggestions;
- avoid unsupported parts, colors, or feature assumptions;
- favor recognizable single objects, not scenes;
- use inventory shape and color as the main source of inspiration;
- prefer bulky objects when there are many bricks;
- prefer flatter objects when there are many plates;
- write labels as short titles;
- write prompt metadata as concrete generation-ready object descriptions.

## Backend Architecture

Add a suggestion prompt builder near the existing generation prompt builders. It will reuse `summarizeSupportedInventory()` so inventory semantics stay aligned with the rest of the generation pipeline.

Add a suggestion service function that:

1. validates that a suggestion model name is configured;
2. builds the Gemini JSON request;
3. calls the shared Gemini client;
4. parses the JSON object;
5. validates the response shape;
6. returns `{ ok: true, suggestions }` or `{ ok: false, stage, errors }`.

Add a new local server route:

```text
POST /api/suggest-builds
```

Request body:

```json
{
  "inventory": {
    "inventory_id": "car-demo",
    "source": "manual_test_fixture",
    "items": []
  }
}
```

The route will require `GEMINI_SUGGESTION_MODEL`. The intended local `.env` value is:

```text
GEMINI_SUGGESTION_MODEL=gemini-flash-lite-latest
```

## Frontend Architecture

Add a suggestions panel between the existing status card and prompt form in `index.html`.

The preview script will:

- track the selected inventory id;
- automatically request suggestions when the selected inventory changes;
- render loading, success, empty, and error states;
- ignore stale responses if the inventory changes while a request is in flight;
- copy `prompt_metadata` into `#prompt-input` when a suggestion is clicked;
- keep generation submission unchanged.

The panel will include a refresh button only for retrying failed or stale suggestions. It will not require a button for the normal automatic path.

## Error Handling

If suggestion generation fails, the panel should show a small error state:

```text
Couldn't load suggestions
```

The user can still type their own prompt and generate normally. Suggestion failure must not block the rest of the app.

If Gemini returns invalid JSON, the suggestion service will use the shared one-repair JSON helper once. If the repaired response is still invalid, it will fail with a clear parse stage. Repeated suggestion repair loops are out of scope.

If the response contains more than 5 suggestions, the local validator will reject it so the prompt contract remains strict.

## Manual Verification

Manual verification should include:

- start the local dev stack;
- confirm suggestions load automatically for the default inventory;
- change inventories and confirm the list refreshes;
- click a suggestion and confirm the prompt input receives hidden metadata;
- edit the prompt and generate using the existing flow.
