import Helpers from "./lib/helpers.mjs";
import { getCollectionInternal } from "./lib/mongodb.mjs";

const tags = ["server-ce", "server-pro"];
const indexes = [
  { key: { tokenHash: 1 }, name: "tokenHash_1", unique: true },
  { key: { userId: 1, createdAt: -1 }, name: "userId_1_createdAt_-1" },
  { key: { expiresAt: 1 }, name: "expiresAt_1" },
];
const collection = async () =>
  await getCollectionInternal("communityGitAccessTokens");

const migrate = async () => {
  await Helpers.addIndexesToCollection(await collection(), indexes);
};

const rollback = async () => {
  await Helpers.dropIndexesFromCollection(await collection(), indexes);
};

export default { tags, migrate, rollback };
