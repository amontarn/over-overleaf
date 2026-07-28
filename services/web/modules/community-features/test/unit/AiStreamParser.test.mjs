import assert from "node:assert/strict";
import test from "node:test";
import { streamProviderContent } from "../../app/src/ai/AiStreamParser.mjs";

function bodyFrom(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body) {
  let result = "";
  for await (const content of streamProviderContent(body)) result += content;
  return result;
}

test("parses fragmented OpenAI-compatible SSE deltas", async () => {
  const body = bodyFrom([
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Bon',
    'jour"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" !"}}]}\n\n',
    "data: [DONE]\n\n",
  ]);
  assert.equal(await collect(body), "Bonjour !");
});

test("rejects a malformed provider stream", async () => {
  await assert.rejects(
    collect(bodyFrom(["data: not-json\n\n"])),
    /invalid stream event/,
  );
});

test("rejects a provider stream without visible content", async () => {
  await assert.rejects(
    collect(
      bodyFrom([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    ),
    /empty completion/,
  );
});
