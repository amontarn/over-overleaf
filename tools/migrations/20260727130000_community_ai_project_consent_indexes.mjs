import Helpers from "./lib/helpers.mjs";
import { getCollectionInternal } from "./lib/mongodb.mjs";

const tags = ["server-ce", "server-pro"];
const indexes = [
  {
    key: { userId: 1, projectId: 1 },
    name: "userId_1_projectId_1",
    unique: true,
  },
  { key: { projectId: 1 }, name: "projectId_1" },
];
const collection = async () =>
  await getCollectionInternal("communityAiProjectConsents");

const migrate = async () => {
  await Helpers.addIndexesToCollection(await collection(), indexes);
};

const rollback = async () => {
  await Helpers.dropIndexesFromCollection(await collection(), indexes);
};

export default { tags, migrate, rollback };
