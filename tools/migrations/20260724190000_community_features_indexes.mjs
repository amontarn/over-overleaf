import Helpers from "./lib/helpers.mjs";
import { getCollectionInternal } from "./lib/mongodb.mjs";

const tags = ["server-ce", "server-pro"];
const indexes = [{ key: { singleton: 1 }, name: "singleton_1", unique: true }];
const collection = async () => await getCollectionInternal("communityAiConfig");

const migrate = async () => {
  await Helpers.addIndexesToCollection(await collection(), indexes);
};

const rollback = async () => {
  await Helpers.dropIndexesFromCollection(await collection(), indexes);
};

export default { tags, migrate, rollback };
