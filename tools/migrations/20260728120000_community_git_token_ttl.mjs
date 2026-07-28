import Helpers from "./lib/helpers.mjs";
import { getCollectionInternal } from "./lib/mongodb.mjs";

const tags = ["server-ce", "server-pro"];

// Replace the plain expiresAt index with a TTL index so expired Git access
// tokens are purged automatically instead of accumulating in the collection.
const PLAIN_INDEX = { key: { expiresAt: 1 }, name: "expiresAt_1" };
const TTL_INDEX = {
  key: { expiresAt: 1 },
  name: "expiresAt_1",
  expireAfterSeconds: 0,
};

const collection = async () =>
  await getCollectionInternal("communityGitAccessTokens");

const migrate = async () => {
  const col = await collection();
  await Helpers.dropIndexesFromCollection(col, [PLAIN_INDEX]);
  await Helpers.addIndexesToCollection(col, [TTL_INDEX]);
};

const rollback = async () => {
  const col = await collection();
  await Helpers.dropIndexesFromCollection(col, [TTL_INDEX]);
  await Helpers.addIndexesToCollection(col, [PLAIN_INDEX]);
};

export default { tags, migrate, rollback };
