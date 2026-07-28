import { getCollectionInternal } from "./lib/mongodb.mjs";

const tags = ["server-ce", "server-pro"];

const migrate = async () => {
  const configs = await getCollectionInternal("communityAiConfig");
  const consents = await getCollectionInternal("communityAiProjectConsents");
  const config = await configs.findOne({ singleton: "global" });
  if (!config?.connectors?.length) return;

  for (const connector of config.connectors) {
    const models = [
      ...new Set(
        [
          ...(Array.isArray(connector.models) ? connector.models : []),
          connector.model,
        ]
          .map((model) => String(model || "").trim())
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right));
    await configs.updateOne(
      { _id: config._id, "connectors.id": connector.id },
      {
        $set: { "connectors.$.models": models },
        $unset: {
          "connectors.$.name": "",
          "connectors.$.model": "",
          "connectors.$.systemPrompt": "",
          "connectors.$.reasoningEffort": "",
        },
      },
    );
    if (connector.model) {
      await consents.updateMany(
        {
          selectedConnectorId: connector.id,
          selectedModel: { $exists: false },
        },
        { $set: { selectedModel: connector.model } },
      );
    }
  }
};

const rollback = async () => {
  const configs = await getCollectionInternal("communityAiConfig");
  const consents = await getCollectionInternal("communityAiProjectConsents");
  const config = await configs.findOne({ singleton: "global" });
  if (!config?.connectors?.length) return;

  for (const connector of config.connectors) {
    const model = Array.isArray(connector.models) ? connector.models[0] : null;
    await configs.updateOne(
      { _id: config._id, "connectors.id": connector.id },
      {
        ...(model ? { $set: { "connectors.$.model": model } } : {}),
        $unset: { "connectors.$.models": "" },
      },
    );
  }
  await consents.updateMany({}, { $unset: { selectedModel: "" } });
};

export default { tags, migrate, rollback };
