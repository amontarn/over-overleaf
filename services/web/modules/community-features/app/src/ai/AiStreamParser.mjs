function providerStreamError(message) {
  return Object.assign(new Error(message), { statusCode: 502 });
}

function parseEvent(block) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return { valid: false, done: false, content: "" };
  if (data === "[DONE]") return { valid: true, done: true, content: "" };

  let body;
  try {
    body = JSON.parse(data);
  } catch {
    throw providerStreamError("AI provider returned an invalid stream event");
  }
  const content = body?.choices?.[0]?.delta?.content;
  if (content != null && typeof content !== "string") {
    throw providerStreamError("AI provider returned an invalid stream delta");
  }
  if (!body?.choices?.[0]) {
    throw providerStreamError("AI provider returned an invalid stream event");
  }
  return { valid: true, done: false, content: content || "" };
}

export async function* streamProviderContent(body) {
  if (!body) throw providerStreamError("AI provider returned no stream");

  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;
  let sawEvent = false;
  let sawContent = false;
  let finished = false;

  const processBlock = function* (block) {
    const event = parseEvent(block);
    if (!event.valid) return;
    sawEvent = true;
    if (event.done) {
      finished = true;
      return;
    }
    if (event.content) {
      sawContent = true;
      yield event.content;
    }
  };

  for await (const chunk of body) {
    totalBytes += chunk.byteLength;
    if (totalBytes > 2_000_000) {
      throw providerStreamError("AI provider response is too large");
    }
    buffer += decoder.decode(chunk, { stream: true });
    let separator;
    while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const match = buffer.slice(separator).match(/^\r?\n\r?\n/)[0];
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + match.length);
      yield* processBlock(block);
      if (finished) break;
    }
    if (finished) break;
  }

  if (!finished) {
    buffer += decoder.decode();
    if (buffer.trim()) yield* processBlock(buffer);
  }
  if (!sawEvent) {
    throw providerStreamError(
      "AI provider returned an invalid completion stream",
    );
  }
  if (!sawContent) {
    throw providerStreamError("AI provider returned an empty completion");
  }
}
