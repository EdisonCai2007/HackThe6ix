# Inventory Showcase Builds Design

**Date:** 2026-07-19

## Goal

Ship two polished LEGO showcase builds that can be selected from the existing suggestion UI, imported directly by another developer, and replayed through the current brick-by-brick build animation. Each build must be constructible independently from the fixed 787-piece inventory.

The deliverable is a pair of deterministic, hand-reviewed `GeneratedModel` assets rather than another external text-to-3D dependency. This removes API access, cost, latency, and model-quality risk from the time-critical demo.

## Showcase builds

The initial pair is:

1. **Scarlet Steam Locomotive** — a red-and-black display locomotive with a layered boiler, cab, smokestack, wheels, running boards, and gold/yellow mechanical accents.
2. **Midnight Grand Piano** — a black concert grand with a curved, layered case, contrasting keyboard, raised lid, pedals, legs, and bench.

The locomotive emphasizes mechanical detail and silhouette. The piano provides a different, elegant form with strong visual recognition. A build may use as many pieces as improve its result, but neither may exceed any part/color quantity in the supplied inventory.

## Asset contract

Each showcase is implemented as a deterministic builder that accepts the normal inventory array and returns the repository's existing `GeneratedModel` shape:

- stable brick IDs;
- real inventory `part_id`, `ldraw_id`, color, position, and rotation values;
- semantic `feature` labels;
- integer `step` values describing a stable assembly order;
- computed dimensions and total piece count.

A central showcase registry is the public import surface. It exposes:

- the two showcase descriptors;
- suggestion-compatible metadata;
- lookup by stable showcase ID;
- prompt matching for compatibility with older clients;
- model construction from an inventory.

This allows the friend's code to import one registry instead of knowing individual fixture filenames. The registry must remain free of server and browser dependencies.

## Suggestion and generation flow

The existing `/api/suggest-builds` response gains local showcase suggestions. A suggestion carries the existing `label` and `prompt_metadata` fields plus a stable `showcase_id`. Selecting it stores that ID alongside the generated prompt.

Generation requests may include `showcase_id`. When it is recognized, the server builds the deterministic asset before checking any AI-provider credentials. Prompt matching remains as a backward-compatible fallback, so an older UI that sends only the suggestion text still resolves the same build.

Unknown or absent showcase IDs continue through the existing hybrid or provider-backed path unchanged.

## Brick-by-brick replay

For JSON generation, the server returns the complete model through the existing result envelope.

For streaming generation, the server emits the same event types already consumed by the preview:

1. normal progress/stage events;
2. one `brick` event per brick, ordered by `step` and then source order;
3. the final complete result containing the same model.

The stream applies a short configurable interval between bricks in normal use so the browser visibly paints the construction instead of receiving the entire model in one render frame. Tests inject a zero interval. No new animation format is introduced.

## Inventory safety

Showcase construction uses a strict inventory-aware brick factory. Every requested part/color pair must exist, and every placement decrements its available quantity. Overuse, an unknown part, or an unknown color fails immediately with a descriptive error.

The completed model is also passed through the repository's standard model validation. Tests independently count the output by part and color and compare it with the fixed inventory.

Each build is checked against the full inventory separately. The two showcase models are not expected to be built simultaneously from a single physical set.

## Visual refinement

The final assets are curated locally. Public text-to-brick examples may be used for composition reference, but no runtime or committed-data dependency on StableText2Brick, BrickGPT, Tripo, Llama, or another gated service is required.

Both models are rendered from multiple angles during implementation. Refinement prioritizes:

- recognizable silhouette;
- connected, physically plausible layers;
- purposeful color blocking;
- small details that read clearly at preview scale;
- an assembly order that grows naturally from the base upward.

## Scope boundaries

This change does not build a general text-to-LEGO model, train a model, purchase API access, or replace the existing hybrid generator. It adds two reliable demo-quality assets and the narrow integration needed to select, import, and animate them.

## Acceptance criteria

- Two distinct showcase suggestions appear without external API credentials.
- Selecting either suggestion generates the matching model in the current UI.
- Each model can be imported and constructed through the standalone registry.
- Streaming generation visibly emits every brick in deterministic build order.
- Both models pass schema validation and fixed-inventory quantity checks.
- Existing non-showcase suggestion and generation behavior remains available.
- Automated tests cover the builders, registry, request contract, credential bypass, and stream ordering.
- Multi-angle visual review confirms both models are recognizable and presentation-ready.
