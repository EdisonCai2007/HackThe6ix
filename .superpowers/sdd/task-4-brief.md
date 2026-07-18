### Task 4: Local Generation HTTP Server

**Files:**
- Create: `server/generationServer.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createOpenRouterClient({ apiKey })`
- Consumes: `generateModel({ userPrompt, inventory, targetPieceCount, openRouterClient, model })`
- Produces: `POST http://127.0.0.1:8787/api/generate`
- Produces: `npm run serve:generation`

- [ ] **Step 1: Create the local HTTP server**

Create `server/generationServer.js`:

```js
import { createServer } from "node:http";

import { createOpenRouterClient } from "../src/generation/openRouterClient.js";
import { generateModel } from "../src/generation/service.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.GENERATION_PORT ?? 8787);
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateRequestBody(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Request body must be a JSON object."];
  }

  if (typeof body.userPrompt !== "string" || body.userPrompt.trim() === "") {
    errors.push("userPrompt must be a non-empty string.");
  }

  if (!body.inventory || !Array.isArray(body.inventory.items)) {
    errors.push("inventory.items must be an array.");
  }

  return errors;
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method !== "POST" || request.url !== "/api/generate") {
    sendJson(response, 404, { ok: false, errors: ["Not found."] });
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    sendJson(response, 500, {
      ok: false,
      stage: "configuration",
      errors: ["OPENROUTER_API_KEY is required."],
    });
    return;
  }

  try {
    const body = await readJson(request);
    const requestErrors = validateRequestBody(body);

    if (requestErrors.length > 0) {
      sendJson(response, 400, {
        ok: false,
        stage: "request",
        errors: requestErrors,
      });
      return;
    }

    const openRouterClient = createOpenRouterClient({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const result = await generateModel({
      userPrompt: body.userPrompt.trim(),
      inventory: body.inventory,
      targetPieceCount: body.targetPieceCount,
      openRouterClient,
      model: OPENROUTER_MODEL,
    });

    sendJson(response, result.ok ? 200 : 422, result);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      stage: "server",
      errors: [error.message],
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Generation service listening at http://${HOST}:${PORT}`);
});
```

- [ ] **Step 2: Add package script**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "serve:generation": "node server/generationServer.js",
    "test": "node --test"
  }
}
```

- [ ] **Step 3: Verify missing-key behavior without network**

Run: `npm run serve:generation`

Expected: console prints `Generation service listening at http://127.0.0.1:8787`.

In another terminal, run:

```bash
curl -s http://127.0.0.1:8787/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"userPrompt":"build me a duck","inventory":{"inventory_id":"empty","source":"manual_test_fixture","items":[]}}'
```

Expected response includes:

```json
{"ok":false,"stage":"configuration","errors":["OPENROUTER_API_KEY is required."]}
```

- [ ] **Step 4: Stop the server**

Press `Ctrl-C` in the server terminal.

Expected: process exits cleanly.

- [ ] **Step 5: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record that commit is blocked until `.git` is restored.

---

