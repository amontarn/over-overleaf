import mongoose from "../../../../../app/src/infrastructure/Mongoose.mjs";

const { Schema } = mongoose;

const AiConnectorSchema = new Schema(
  {
    id: { type: String, required: true },
    baseUrl: { type: String, required: true },
    models: { type: [String], required: true, default: [] },
    encryptedApiKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId },
    createdAt: { type: Date, required: true },
    testedAt: { type: Date, required: true },
  },
  { _id: false, minimize: false },
);

const AiConfigSchema = new Schema(
  {
    singleton: {
      type: String,
      required: true,
      unique: true,
      default: "global",
    },
    updatedBy: { type: Schema.Types.ObjectId },
    connectors: { type: [AiConnectorSchema], default: [] },
  },
  { collection: "communityAiConfig", timestamps: true, minimize: false },
);

export const AiConfig = mongoose.model("CommunityAiConfig", AiConfigSchema);
