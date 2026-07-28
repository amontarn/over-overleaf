const ALLOWED_ROLES = new Set(["user", "assistant"]);

export function normaliseConversation(rawMessages, maxChars) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw badRequest("the conversation must contain at least one message");
  }
  if (rawMessages.length > 20) {
    throw badRequest("the conversation cannot contain more than 20 messages");
  }

  let totalChars = 0;
  const messages = rawMessages.map((message) => {
    const role = String(message?.role || "");
    const content = String(message?.content || "").trim();
    if (!ALLOWED_ROLES.has(role) || !content) {
      throw badRequest("the conversation contains an invalid message");
    }
    totalChars += content.length;
    if (totalChars > maxChars) {
      throw badRequest(`the conversation cannot exceed ${maxChars} characters`);
    }
    return { role, content };
  });

  if (messages.at(-1)?.role !== "user") {
    throw badRequest("the last conversation message must be from the user");
  }
  return messages;
}

export function buildProjectContext(docs, filePaths, activeDocName, maxChars) {
  const active = String(activeDocName || "");
  const entries = Object.entries(docs || {}).sort(([pathA], [pathB]) => {
    if (pathA === active) return -1;
    if (pathB === active) return 1;
    return pathA.localeCompare(pathB);
  });

  let text = "";
  let includedFiles = 0;
  let truncated = false;
  for (const [path, doc] of entries) {
    const block = `\n--- ${path} ---\n${doc.lines.join("\n")}\n`;
    const remaining = maxChars - text.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (block.length > remaining) {
      text += block.slice(0, remaining);
      includedFiles += 1;
      truncated = true;
      break;
    }
    text += block;
    includedFiles += 1;
  }

  const binaryPaths = (filePaths || []).sort().join(", ");
  if (binaryPaths && text.length < maxChars) {
    const block = `\n--- Non-text project files (names only) ---\n${binaryPaths}\n`;
    const remaining = maxChars - text.length;
    text += block.slice(0, remaining);
    if (block.length > remaining) truncated = true;
  }

  return { text: text.trim(), includedFiles, truncated };
}

export function attachSelection(messages, selection) {
  const source = String(selection?.source || "");
  if (!source) return messages;
  const docName = String(selection?.docName || "current document");
  const updated = messages.map((message) => ({ ...message }));
  const last = updated.at(-1);
  last.content = `${last.content}\n\nQuoted selection from ${docName}:\n<selection>\n${source}\n</selection>`;
  return updated;
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}
