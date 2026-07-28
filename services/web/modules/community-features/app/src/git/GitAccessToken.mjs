import mongoose from "../../../../../app/src/infrastructure/Mongoose.mjs";

const { Schema } = mongoose;

const GitAccessTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    prefix: { type: String, required: true },
    label: { type: String, required: true, default: "Git integration" },
    // TTL index: expired tokens are purged automatically rather than lingering.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
  },
  {
    collection: "communityGitAccessTokens",
    timestamps: true,
    minimize: false,
  },
);

export const GitAccessToken = mongoose.model(
  "CommunityGitAccessToken",
  GitAccessTokenSchema,
);
