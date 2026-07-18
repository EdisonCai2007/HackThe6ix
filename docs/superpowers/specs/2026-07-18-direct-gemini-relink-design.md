# Direct Gemini Relink Design

## Goal

Restore direct Gemini API generation because Backboard is currently unavailable, while keeping the Backboard adapter in the repository as an inactive fallback.

## Scope

- Set `GENERATION_PROVIDER` to `gemini` in the local `.env` configuration.
- Change the preview's in-progress provider label from `Calling Backboard` to `Calling Gemini`.
- Update the provider-copy regression test to require the Gemini label.
- Preserve the existing Gemini API key, stage-specific Gemini models, prompts, response schemas, streaming stages, deterministic validation, repair flow, and runtime logging.
- Preserve the Backboard adapter, its tests, and its environment variables for a possible later fallback.

## Data Flow

The browser continues to send generation and suggestion requests to the local generation server. With `GENERATION_PROVIDER=gemini`, `createGenerationClientForBody()` selects `createGeminiClient()` rather than `createBackboardGenerationClient()`. The rest of the generation service receives the same client interface and continues unchanged.

## Error Handling

The existing direct-Gemini configuration checks remain authoritative. If `GEMINI_API_KEY` or the required stage-specific model settings are missing, the existing configuration errors are returned. No new fallback to Backboard is added because it could hide the provider outage the relink is intended to avoid.

## Verification

- Run the provider-copy regression test.
- Run the generation server and Gemini client tests that cover client selection and request translation.
- Run the full test suite.
- Do not make a live Gemini request or run browser/WebGL automation unless separately requested.

## Repository Safety

Do not modify the existing research-field changes or generated inventory/results files. Do not stage or commit any changes.
