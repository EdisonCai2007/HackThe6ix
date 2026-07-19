export function promptTextForBuildSuggestion(suggestion) {
  const label = typeof suggestion?.label === "string"
    ? suggestion.label.trim()
    : "";
  const promptMetadata = typeof suggestion?.prompt_metadata === "string"
    ? suggestion.prompt_metadata.trim()
    : "";
  const inventoryReasoning = typeof suggestion?.inventory_reasoning === "string"
    ? suggestion.inventory_reasoning.trim()
    : "";

  const labeledPrompt = label && promptMetadata
    ? `${label}. ${promptMetadata}`
    : promptMetadata;

  if (!labeledPrompt || !inventoryReasoning) {
    return labeledPrompt;
  }

  return `${labeledPrompt} Inventory fit: ${inventoryReasoning}`;
}
