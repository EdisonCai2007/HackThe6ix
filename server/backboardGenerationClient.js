import { summarizeSupportedInventory } from "../src/generation/generationPrompts.js";
import { validateGeneratedModelShape } from "../src/generation/generatedModelSchema.js";
import { validateModel } from "../src/generation/validator.js";

const DEFAULT_BACKBOARD_BASE_URL = "https://app.backboard.io/api";
const INLINE_INVENTORY_ID = "__inline_inventory__";

function textFromParts(parts = []) {
  return parts
    .map((part) => part?.text)
    .filter((text) => typeof text === "string")
    .join("\n");
}

function responseSchemaText(request) {
  const responseSchema = request.generationConfig?.responseSchema;

  if (!responseSchema || typeof responseSchema !== "object") {
    return "";
  }

  return [
    "The original Gemini request included generationConfig.responseSchema.",
    "Your final answer must be exactly one JSON object conforming to this schema:",
    JSON.stringify(responseSchema, null, 2),
  ].join("\n");
}

function requestContent(request, inventorySessionId) {
  const userText = textFromParts(request.contents?.[0]?.parts);
  let sanitizedUserText = userText;
  const schemaText = responseSchemaText(request);

  try {
    const payload = JSON.parse(userText);

    if (payload && typeof payload === "object" && payload.inventory) {
      payload.inventory = {
        inventory_id: inventorySessionId,
        retrieval: "Call get_inventory_summary with this inventory_id when exact inventory is needed.",
      };
      sanitizedUserText = JSON.stringify(payload, null, 2);
    }
  } catch {
    sanitizedUserText = userText;
  }

  return [
    "Execute this LEGO generation stage.",
    `Use inventory_id ${inventorySessionId}.`,
    "Call get_inventory_summary before relying on inventory counts.",
    "Call validate_generated_model before finalizing any GeneratedModel placement JSON.",
    "Return exactly the JSON object requested by the stage instructions.",
    schemaText,
    "",
    sanitizedUserText,
  ].filter((text) => text !== "").join("\n");
}

function parseToolArguments(toolCall) {
  const rawArguments = toolCall?.function?.parsed_arguments ?? toolCall?.function?.arguments ?? "{}";

  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}");
  }

  return rawArguments;
}

function backboardToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "get_inventory_summary",
        description: "Load the exact supported LEGO inventory summary for an inventory session.",
        parameters: {
          type: "object",
          properties: {
            inventory_id: {
              type: "string",
              description: "Inventory session id returned by the local app.",
            },
          },
          required: ["inventory_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "validate_generated_model",
        description: "Validate a GeneratedModel JSON object against exact stored LEGO inventory and buildability rules.",
        parameters: {
          type: "object",
          properties: {
            inventory_id: {
              type: "string",
              description: "Inventory session id returned by the local app.",
            },
            model: {
              type: "object",
              description: "GeneratedModel JSON object to validate.",
            },
          },
          required: ["inventory_id", "model"],
        },
      },
    },
  ];
}

function usageMetadataFromBackboard(response) {
  return {
    promptTokenCount: response.input_tokens ?? undefined,
    candidatesTokenCount: response.output_tokens ?? undefined,
    totalTokenCount: response.total_tokens ?? undefined,
  };
}

function assertBackboardResponse(response, url) {
  if (!response.ok) {
    throw new Error(`Backboard request failed for ${url}: HTTP ${response.status}`);
  }
}

function failureDetailFromBackboard(response) {
  const detail = response.content ?? response.message;

  return typeof detail === "string" && detail.trim() !== "" ? `: ${detail.trim()}` : "";
}

export function createBackboardGenerationClient({
  apiKey,
  inventorySessionId,
  inventoryStore,
  inlineInventory = null,
  baseUrl = DEFAULT_BACKBOARD_BASE_URL,
  fetchImpl = fetch,
  llmProvider = "google",
  modelName = null,
  assistantId = null,
  memory = "off",
  maxToolRounds = 4,
} = {}) {
  if (!apiKey) {
    throw new Error("BACKBOARD_API_KEY is required when GENERATION_PROVIDER=backboard.");
  }

  if (!inventoryStore) {
    throw new Error("inventoryStore is required for Backboard generation.");
  }

  const resolvedInventorySessionId = inventorySessionId ?? INLINE_INVENTORY_ID;

  async function loadInventory(inventoryId) {
    if (inventoryId === INLINE_INVENTORY_ID && inlineInventory) {
      return inlineInventory;
    }

    return inventoryStore.load(inventoryId);
  }

  async function dispatchTool(toolCall) {
    const name = toolCall?.function?.name;
    const args = parseToolArguments(toolCall);
    const inventoryId = args.inventory_id ?? resolvedInventorySessionId;

    if (name === "get_inventory_summary") {
      return summarizeSupportedInventory(await loadInventory(inventoryId));
    }

    if (name === "validate_generated_model") {
      const shapeResult = validateGeneratedModelShape(args.model);

      if (!shapeResult.ok) {
        return {
          valid: false,
          errors: shapeResult.errors,
        };
      }

      return validateModel(args.model, await loadInventory(inventoryId));
    }

    return {
      error: `Unknown Backboard tool: ${name}`,
    };
  }

  async function postJson(path, body) {
    const url = `${baseUrl}${path}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    assertBackboardResponse(response, url);
    return response.json();
  }

  async function completeWithMetadata(request) {
    const initialBody = {
      content: requestContent(request, resolvedInventorySessionId),
      system_prompt: textFromParts(request.systemInstruction?.parts),
      tools: backboardToolDefinitions(),
      llm_provider: llmProvider,
      model_name: modelName ?? request.model,
      memory,
      stream: false,
      ...(assistantId ? { assistant_id: assistantId } : {}),
    };

    let response = await postJson("/threads/messages", initialBody);
    let rounds = 0;

    while (response.status === "REQUIRES_ACTION") {
      const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];

      if (toolCalls.length === 0) {
        throw new Error("Backboard requested tool action without tool calls.");
      }

      if (rounds >= maxToolRounds) {
        throw new Error("Backboard exceeded the maximum tool-call rounds.");
      }

      const tool_outputs = [];

      for (const toolCall of toolCalls) {
        const output = await dispatchTool(toolCall);
        tool_outputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(output),
        });
      }

      response = await postJson("/threads/tool-outputs", {
        thread_id: response.thread_id,
        tool_outputs,
        stream: false,
      });
      rounds += 1;
    }

    if (response.status !== "COMPLETED") {
      throw new Error(
        `Backboard generation ended with status ${response.status ?? "UNKNOWN"}${failureDetailFromBackboard(response)}.`,
      );
    }

    return {
      text: response.content ?? "",
      metadata: {
        finishReason: response.status,
        usageMetadata: usageMetadataFromBackboard(response),
        backboard: {
          threadId: response.thread_id,
          messageId: response.message_id,
          modelProvider: response.model_provider,
          modelName: response.model_name,
          contextUsage: response.context_usage,
        },
      },
    };
  }

  return {
    completeWithMetadata,
    async complete(request) {
      return (await completeWithMetadata(request)).text;
    },
  };
}
