import mongoose from "../../../../../app/src/infrastructure/Mongoose.mjs";

const { Schema } = mongoose;

const AiProjectConsentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    enabled: { type: Boolean, required: true, default: false },
    consentVersion: { type: String, required: true },
    consentedAt: { type: Date },
    selectedConnectorId: { type: String },
    selectedModel: { type: String },
    consentedProviderOrigin: { type: String },
  },
  {
    collection: "communityAiProjectConsents",
    timestamps: true,
    minimize: false,
  },
);

AiProjectConsentSchema.index({ userId: 1, projectId: 1 }, { unique: true });
AiProjectConsentSchema.index({ projectId: 1 });

export const AiProjectConsent = mongoose.model(
  "CommunityAiProjectConsent",
  AiProjectConsentSchema,
);
