export function usableBuildSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];

  return suggestions
    .filter((suggestion) =>
      typeof suggestion?.label === "string" &&
      typeof suggestion.prompt_metadata === "string",
    );
}
