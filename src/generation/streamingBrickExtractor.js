function parseError(message, fragment) {
  const error = new Error(`${message}: ${fragment.slice(0, 160)}`);
  error.code = "STREAM_BRICK_PARSE_ERROR";
  return error;
}

/**
 * Incrementally extracts complete objects from a generated model's bricks
 * array. It intentionally never attempts to repair an incomplete suffix.
 */
export function createStreamingBrickExtractor() {
  let source = "";
  let scanIndex = 0;
  let arrayStart = -1;
  let inArray = false;
  let arrayClosed = false;
  let completeBricks = [];
  const errors = [];

  function locateArray() {
    if (arrayClosed || inArray) return inArray;
    const keyMatch = /"bricks"\s*:/.exec(source.slice(scanIndex));
    if (!keyMatch) return false;
    const keyEnd = scanIndex + keyMatch.index + keyMatch[0].length;
    const open = source.indexOf("[", keyEnd);
    if (open < 0) return false;
    arrayStart = open;
    scanIndex = open + 1;
    inArray = true;
    return true;
  }

  function scan() {
    const emitted = [];
    if (!locateArray()) return emitted;

    while (scanIndex < source.length) {
      while (scanIndex < source.length && /[\s,]/.test(source[scanIndex])) scanIndex += 1;
      if (scanIndex >= source.length) break;
      if (source[scanIndex] === "]") {
        scanIndex += 1;
        arrayClosed = true;
        inArray = false;
        break;
      }
      if (source[scanIndex] !== "{") {
        // A non-object token may be a truncated value; wait for more data.
        if (source[scanIndex] === "\"" || source[scanIndex] === "n" || source[scanIndex] === "t" || source[scanIndex] === "f") break;
        errors.push(parseError("Invalid brick object", source.slice(scanIndex)));
        scanIndex += 1;
        continue;
      }

      const start = scanIndex;
      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;
      for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === "{") depth += 1;
        else if (character === "}") {
          depth -= 1;
          if (depth === 0) {
            end = index + 1;
            break;
          }
        }
      }
      if (end < 0) break;

      const fragment = source.slice(start, end);
      try {
        const brick = JSON.parse(fragment);
        if (!brick || typeof brick !== "object" || Array.isArray(brick)) {
          throw parseError("Brick object must be a JSON object", fragment);
        }
        completeBricks.push(brick);
        emitted.push(brick);
      } catch (error) {
        errors.push(parseError(
          `Invalid brick object${error?.message ? ` (${error.message})` : ""}`,
          fragment,
        ));
      }
      scanIndex = end;
    }
    return emitted;
  }

  return {
    push(chunk) {
      if (typeof chunk !== "string" || chunk.length === 0) return [];
      source += chunk;
      return scan();
    },
    finish() {
      if (!arrayClosed) scan();
      const trailingFragment = arrayClosed ? "" : source.slice(scanIndex).trim();
      return { bricks: [...completeBricks], errors: [...errors], trailingFragment };
    },
    get bricks() {
      return [...completeBricks];
    },
    get errors() {
      return [...errors];
    },
  };
}
