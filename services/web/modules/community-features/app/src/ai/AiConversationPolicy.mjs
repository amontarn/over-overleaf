const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

export function validateConversationId(value) {
  const conversationId = String(value || "");
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw Object.assign(new Error("invalid conversation identifier"), {
      statusCode: 400,
    });
  }
  return conversationId;
}
