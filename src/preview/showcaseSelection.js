export function createShowcaseSelection() {
  let showcaseId;

  return {
    selectSuggestion(suggestion) {
      showcaseId = typeof suggestion?.showcase_id === "string" &&
        suggestion.showcase_id.trim() !== ""
        ? suggestion.showcase_id.trim()
        : undefined;
    },
    clear() {
      showcaseId = undefined;
    },
    extendGenerationPayload(payload) {
      return showcaseId
        ? { ...payload, showcase_id: showcaseId }
        : { ...payload };
    },
  };
}
