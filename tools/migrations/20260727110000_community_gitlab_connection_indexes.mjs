import Helpers from "./lib/helpers.mjs";
import { getCollectionInternal } from "./lib/mongodb.mjs";

const tags = ["server-ce", "server-pro"];
const indexes = [
  { key: { projectId: 1 }, name: "projectId_1", unique: true },
  { key: { connectedBy: 1 }, name: "connectedBy_1" },
];
const collection = async () =>
  await getCollectionInternal("communityGitLabConnections");

const migrate = async () => {
  await Helpers.addIndexesToCollection(await collection(), indexes);
};

const rollback = async () => {
  await Helpers.dropIndexesFromCollection(await collection(), indexes);
};

export default { tags, migrate, rollback };
