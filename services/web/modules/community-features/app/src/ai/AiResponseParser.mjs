function parseProviderBody(raw) {
  if (raw.length > 2_000_000) {
    throw Object.assign(new Error("AI provider response is too large"), {
      statusCode: 502,
    });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("AI provider returned invalid JSON"), {
      statusCode: 502,
    });
  }
  return body;
}

export function validateProviderResponse(raw) {
  const body = parseProviderBody(raw);
  if (!body?.choices?.[0]?.message) {
    throw Object.assign(
      new Error("AI provider returned an invalid completion"),
      {
        statusCode: 502,
      },
    );
  }
  return true;
}

export function parseProviderResponse(raw) {
  const body = parseProviderBody(raw);
  const proposal = body?.choices?.[0]?.message?.content;
  if (typeof proposal !== "string" || !proposal.trim()) {
    throw Object.assign(new Error("AI provider returned an empty completion"), {
      statusCode: 502,
    });
  }
  return proposal.trim();
}

export function parseModelsResponse(raw) {
  const body = parseProviderBody(raw);
  if (!Array.isArray(body?.data)) {
    throw Object.assign(
      new Error("AI provider returned an invalid model list"),
      {
        statusCode: 502,
      },
    );
  }
  const models = [
    ...new Set(
      body.data
        .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (models.length === 0) {
    throw Object.assign(new Error("AI provider returned no available model"), {
      statusCode: 502,
    });
  }
  return models;
}
