import assert from "node:assert/strict";
import test from "node:test";
import { validateConversationId } from "../../app/src/ai/AiConversationPolicy.mjs";
import {
  parseModelsResponse,
  parseProviderResponse,
  validateProviderResponse,
} from "../../app/src/ai/AiResponseParser.mjs";

test("accepts an opaque client-side conversation identifier", () => {
  const id = "0198f9ad-99eb-7ca1-a7c3-2697ef70c221";
  assert.equal(validateConversationId(id), id);
});

test("rejects missing, short, or structured conversation identifiers", () => {
  assert.throws(() => validateConversationId(""), /invalid conversation/);
  assert.throws(() => validateConversationId("short"), /invalid conversation/);
  assert.throws(
    () => validateConversationId("../../another-user"),
    /invalid conversation/,
  );
});

test("accepts a compatible connection-test response without visible content", () => {
  const raw = JSON.stringify({
    choices: [{ message: { content: "", reasoning: "test" } }],
  });
  assert.equal(validateProviderResponse(raw), true);
  assert.throws(() => parseProviderResponse(raw), /empty completion/);
});

test("normalises an OpenAI-compatible model catalog", () => {
  assert.deepEqual(
    parseModelsResponse(
      JSON.stringify({
        data: [
          { id: "qwen3:8b" },
          { id: "llama3.2:latest" },
          { id: "qwen3:8b" },
        ],
      }),
    ),
    ["llama3.2:latest", "qwen3:8b"],
  );
});

test("rejects an invalid or empty model catalog", () => {
  assert.throws(
    () => parseModelsResponse(JSON.stringify({ models: [] })),
    /invalid model list/,
  );
  assert.throws(
    () => parseModelsResponse(JSON.stringify({ data: [] })),
    /no available model/,
  );
});
