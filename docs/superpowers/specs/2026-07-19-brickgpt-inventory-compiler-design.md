# BrickGPT-to-Inventory Compiler Design

## Goal

Generate the highest-quality recognizable LEGO model that can be physically built from the confirmed fixed inventory. Generation latency and piece count are secondary to model quality. The final build may use any number of pieces up to the quantities in the selected inventory.

The system will use BrickGPT as a geometry prior and a deterministic inventory compiler as the authority for the final model:

```text
prompt
  -> several BrickGPT geometry proposals
  -> target-volume normalization
  -> exact-inventory compilation and color assignment
  -> deterministic validation and scoring
  -> best valid GeneratedModel
  -> existing LDraw export and Three.js preview
```

BrickGPT is not the final placement generator. Its output is an uncolored shape target that the compiler may retile, repair, and recolor.

## Success criteria

- A generation request can use a local BrickGPT installation without Gemini or Backboard credentials.
- Every final brick is present in the selected inventory with the exact part/color quantity respected.
- The compiler can use all supported inventory pieces; it has no fixed 100-piece ceiling.
- Multiple seeded BrickGPT proposals are compiled and scored, and the best valid candidate is returned.
- The returned object preserves the existing `GeneratedModel` JSON shape, validator, LDraw export, editor, and preview interfaces.
- Missing BrickGPT prerequisites produce an actionable configuration error rather than silently falling back to the current coordinate-generating LLM pipeline.
- Unit and integration tests do not download model weights, require a GPU, call external APIs, or require Gurobi.

## Non-goals

- Vendoring or modifying BrickGPT's model weights.
- Training or fine-tuning a new model.
- Generating printable step-by-step building instructions.
- Claiming that rectangular bricks and plates can reproduce curved or specialty-part detail absent from the inventory.
- Requiring Gurobi for the first implementation. The existing deterministic validator remains authoritative for inventory legality and simplified buildability.
- Adding a multimodal cloud-model judge in the first implementation. The candidate scorer will expose a stable interface so a later multi-view judge can be added without changing generation or compilation.

## Constraints discovered in the current systems

The official BrickGPT implementation emits lines such as `2x4 (x,y,z)`. It supports eight rectangular brick footprints (`1x1`, `1x2`, `1x4`, `1x6`, `1x8`, `2x2`, `2x4`, and `2x6`), treats every emitted part as one standard brick tall, and produces no colors. Its default world is `20x20x20`, and its local Python package requires access to the gated Llama 3.2 1B base model through `HF_TOKEN`. Gurobi is optional.

The fixed demo inventory contains 787 pieces across 147 part/color rows and 32 rectangular brick/plate footprints. The current JavaScript catalog supports 750 pieces across 20 of those inventory footprints. Twelve larger footprints representing the remaining 37 pieces require catalog entries. The handoff contains human-readable dimensions but no part IDs, so the normalized fixture must provide reviewed LDraw mappings.

The existing application limits models to `MAX_MODEL_PIECES = 100`, asks Gemini or Backboard to generate exact coordinates, and validates the resulting `GeneratedModel`. The hybrid path will bypass AI coordinate placement, remove the fixed cap from shared validation, and keep the downstream model contract and validator. The legacy coordinate-generating prompts will retain a separate 100-piece cap so this change does not make their JSON outputs unmanageably large.

## Architecture

### 1. Fixed inventory normalization

Add a checked-in JavaScript inventory fixture generated from the committed CSV. It will contain one item for every CSV row with:

- canonical category and footprint;
- reviewed `part_id` and `ldraw_id`;
- canonical LDraw `color_id` and normalized color name;
- exact count;
- `supported: true` after the catalog entry exists.

The source CSV and XLSX remain immutable evidence. A conversion script will parse the CSV with a fixed part map and fixed color map and write deterministic JSON. Tests will assert 147 rows, 787 pieces, 32 footprints, and exact per-part/color totals. Unknown labels, colors, or duplicate mappings will fail conversion.

The part catalog will add the missing twelve rectangular parts. Preview color support will add every inventory color so compiled builds do not render unknown colors as the same gray fallback.

### 2. BrickGPT sidecar

BrickGPT runs as a separate Python process because the app is Node/JavaScript and the official package is Python/PyTorch. The repository will contain a small Python entry point, not a copy of BrickGPT. It imports the installed `brickgpt` package, accepts one JSON request on stdin, and writes one JSON response on stdout.

Request:

```json
{
  "prompt": "build a detailed red dragon",
  "seed": 42,
  "world_dim": 20,
  "max_bricks": 787,
  "use_gurobi": false
}
```

Response:

```json
{
  "seed": 42,
  "bricks": [
    { "width": 2, "depth": 4, "x": 4, "y": 6, "z": 0 }
  ],
  "metadata": {
    "rejections": 98,
    "regenerations": 4
  }
}
```

The Node adapter will spawn a configured Python executable with an argument array and `shell: false`, enforce a timeout and output-size limit, parse the response, and validate every field. It will never interpolate the user prompt into a command string. Runtime configuration will include the Python executable, sidecar path, candidate count, seed base, timeout, world dimension, and Gurobi flag.

The adapter will distinguish configuration failures (package missing, `HF_TOKEN` missing, model unavailable), timeouts, process failures, and invalid model output. These errors will be returned under a `geometry_generate` stage with setup instructions. There is no automatic fallback to Gemini/Backboard because that would obscure whether the requested hybrid system actually ran.

### 3. Target-volume normalization

Each BrickGPT placement becomes a set of occupied target cells. One BrickGPT `z` unit equals one standard LEGO brick, or three plate layers in the existing coordinate system. A placement at BrickGPT height `z` therefore occupies plate layers `z*3` through `z*3+2`.

The normalizer will:

- reject negative, non-integer, zero-sized, overlapping, or out-of-world placements;
- translate the target to an origin-based coordinate system;
- retain the BrickGPT source brick boundaries only as metadata;
- expose occupancy, exterior cells, bounds, and source seed to the compiler;
- preserve voids rather than turning the bounding box into a solid block.

This representation deliberately separates shape generation from final part selection. A `2x4` BrickGPT brick can become smaller bricks, larger bricks that remain inside the same occupied volume, or brick/plate combinations from the real inventory.

### 4. Exact-inventory compiler

The compiler consumes a target volume and the selected normalized inventory and returns zero or more legal `GeneratedModel` candidates. It owns all final part, position, rotation, and color choices.

Compilation proceeds bottom-up in plate-layer coordinates. Candidate placements are generated only when every occupied cell of a part is inside the target, the placement does not overlap an accepted placement, the required inventory remains, and the placement is supported according to the existing simplified connection rules. Standard bricks cover three plate layers; plates cover one.

Search uses a deterministic multi-start beam:

1. Pick the next uncovered target cell using a constrained-first ordering: lowest layer, then fewest legal placements, then exterior detail cells before interior cells.
2. Enumerate legal placements in both rotations from remaining inventory.
3. Score partial states for target coverage, exterior fidelity, support, connectedness, remaining ability to cover constrained cells, coherent color regions, and inventory feasibility.
4. Keep the best configurable number of states and continue until the target is covered or no legal placement remains.
5. If perfect coverage is impossible, allow a bounded repair phase to omit low-salience interior cells before exterior silhouette cells.

The compiler must not invent material or exceed counts. It may use fewer pieces than are available. It may use up to the total selected inventory count, and the validator's fixed 100-piece error will be removed. Inventory quantity becomes the only shared hard piece-count ceiling. The legacy AI placement prompts use a separate `LEGACY_AI_MODEL_PIECE_CAP = 100`; the hybrid compiler does not.

Color is assigned during placement search. Explicit color words detected in the user prompt provide preferences, but availability is authoritative. The scorer rewards contiguous regions and deliberate high-contrast accent clusters and penalizes isolated color noise. Geometry fidelity outranks preferred color when those goals conflict.

### 5. Candidate generation and selection

One request generates several BrickGPT targets using deterministic seeds derived from a base seed. Each target is compiled with multiple search orderings. Invalid outputs are discarded after the existing shape and deterministic validators run.

The initial scorer is fully local and reproducible. Candidate metrics are normalized before weighting:

- exterior target-cell recall and precision;
- overall target-volume coverage;
- connectedness and support;
- number and salience of omitted cells;
- color coherence and prompt-color agreement;
- compiler completion state;
- BrickGPT rejection/regeneration metadata as a weak tie-breaker.

Hard validator errors always disqualify a candidate. Piece count is not rewarded by itself: additional pieces are useful only when they improve fidelity, stability, or color detail.

The best candidate is returned as the existing `model` field. A compact `hybrid` diagnostics object will also report seeds attempted, targets compiled, candidate scores, selected seed, coverage, and compiler warnings. This metadata is additive and does not change the renderer's contract.

The scorer interface will accept optional externally produced scores later. A future phase can render the top candidates from several angles and add a multimodal recognizability score without changing BrickGPT, the compiler, or `GeneratedModel`.

### 6. Service and UI integration

Add a generation mode selected by server configuration. In `brickgpt_inventory` mode, the generation server creates the local BrickGPT adapter and calls a new hybrid orchestration service. It does not create a Gemini or Backboard client and does not require their API keys.

The existing `/api/generate` and `/api/generate/stream` request shapes remain valid. Hybrid progress stages are:

- `geometry_generate`;
- `geometry_normalize`;
- `inventory_compile`;
- `candidate_validate`;
- `candidate_select`.

The streaming endpoint emits stage progress and may emit the current best valid candidate as a draft after each completed seed. The final response has `complete: true` and `requiresRefinement: false`; it does not enter the existing Gemini image-refinement flow.

The preview will replace provider-specific status copy with mode-aware labels. Generated hybrid models continue through the existing editor, LDraw exporter, placement centering, and Three.js renderer.

The current Gemini/Backboard pipeline remains available under its existing generation modes for comparison, but it is not a fallback for hybrid failures.

## Failure handling

- No valid BrickGPT proposal: return `geometry_generate` with per-seed failure summaries.
- BrickGPT unavailable or unauthorized: return `configuration`/`geometry_generate` with the missing prerequisite and setup command.
- Some proposals fail: continue with successful proposals and include warnings.
- Compiler cannot produce a perfect-volume candidate: return the best validator-valid partial candidate with coverage diagnostics if one exists.
- No validator-valid compiled candidate: return `inventory_compile` with the best compiler diagnostics; do not return an invalid final model as success.
- Client disconnect: stop starting new seeds and terminate an active sidecar process when possible.
- Oversized or malformed sidecar output: terminate the process and report an invalid-output failure without attempting to evaluate it.

## Testing

All implementation code follows test-first development.

- Inventory conversion tests verify exact source totals and mappings.
- Part-catalog and preview tests cover the twelve new shapes and all inventory colors.
- Sidecar adapter tests use a fake executable/script to verify JSON IPC, seeds, timeouts, process errors, size limits, and malicious prompt safety.
- Target normalization tests cover scale conversion, rotations, overlaps, void preservation, and origin translation.
- Compiler tests use small synthetic inventories and targets to verify exact coverage, brick/plate substitution, rotations, inventory exhaustion, unsupported combinations, support, connectedness, deterministic output, and partial fallback prioritization.
- Scorer tests prove invalid candidates cannot win and exterior fidelity outranks piece count.
- Hybrid service tests use an injected fake geometry provider; they verify multi-seed execution, progress events, deterministic candidate selection, diagnostics, and no AI-client calls.
- Server tests verify `brickgpt_inventory` mode does not require `GEMINI_API_KEY` or Backboard credentials.
- Focused tests run after every component, followed by the full Node suite. The four pre-existing deleted-fixture import failures are tracked separately and must not be presented as regressions from this feature.
- A manual opt-in smoke test runs one local BrickGPT seed only when `HF_TOKEN` and the Python environment are configured. It is excluded from normal tests.

## Deployment and setup

Node dependencies remain unchanged for the first implementation. BrickGPT is an optional local runtime dependency installed in a separate Python environment following its official repository instructions. Secrets stay server-side.

Documented setup will include:

1. obtain access to `meta-llama/Llama-3.2-1B-Instruct` and set `HF_TOKEN`;
2. create a Python 3.10+ environment and install the official BrickGPT package;
3. set the hybrid generation mode and Python executable path;
4. optionally configure Gurobi after the non-Gurobi path works;
5. run a sidecar health check before starting a costly generation.

No model weights, Hugging Face token, Gurobi license, or generated runtime files are committed.

## Delivery sequence

1. Normalize the fixed inventory and complete catalog/color coverage.
2. Replace the shared fixed piece cap with inventory-bounded validation while retaining a separate 100-piece cap for legacy AI coordinate prompts.
3. Add and test BrickGPT sidecar IPC and target-volume normalization.
4. Build the exact-inventory compiler and local scorer.
5. Add hybrid orchestration, server mode selection, streaming progress, and diagnostics.
6. Add setup documentation and an opt-in local-model smoke test.

This sequence produces independently testable components and keeps the current application usable while the local BrickGPT environment is being configured.
