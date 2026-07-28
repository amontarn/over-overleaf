import mongoose from "../../../../../app/src/infrastructure/Mongoose.mjs";

const { Schema } = mongoose;

const GitLabConnectionSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    connectedBy: { type: Schema.Types.ObjectId, required: true, index: true },
    remoteUrl: { type: String, required: true },
    branch: { type: String, required: true },
    username: { type: String, required: true },
    encryptedToken: { type: Schema.Types.Mixed },
    lastSyncedCommit: { type: String, required: true },
    lastSyncedTreeHash: { type: String, required: true },
    lastSyncedAt: { type: Date, required: true },
  },
  {
    collection: "communityGitLabConnections",
    timestamps: true,
    minimize: false,
  },
);

export const GitLabConnection = mongoose.model(
  "CommunityGitLabConnection",
  GitLabConnectionSchema,
);
