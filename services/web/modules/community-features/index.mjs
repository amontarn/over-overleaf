import CommunityFeaturesRouter from "./app/src/CommunityFeaturesRouter.mjs";
import Settings from "@overleaf/settings";
import logger from "@overleaf/logger";
import GitLabSyncManager from "./app/src/gitlab/GitLabSyncManager.mjs";
import AiManager from "./app/src/ai/AiManager.mjs";

/** @import { WebModule } from "../../types/web-module" */

/** @type {WebModule} */
const CommunityFeaturesModule = {
  router: CommunityFeaturesRouter,
  hooks: {
    promises: {
      async projectExpired(projectId) {
        try {
          await AiManager.deleteForProject(projectId);
        } catch (err) {
          logger.warn(
            { err, projectId },
            "failed to delete expired project AI consents",
          );
        }
        try {
          await GitLabSyncManager.deleteForProject(projectId);
        } catch (err) {
          logger.warn(
            { err, projectId },
            "failed to delete expired project GitLab connection",
          );
        }
        if (!Settings.communityFeatures.gitBridge.enabled) return;
        try {
          const response = await fetch(
            `${Settings.communityFeatures.gitBridge.internalUrl}/api/projects/${projectId}`,
            {
              method: "DELETE",
              headers: {
                "X-Git-Bridge-Internal-Secret":
                  Settings.communityFeatures.gitBridge.internalSecret,
              },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok) {
            throw new Error(`Git Bridge returned ${response.status}`);
          }
        } catch (err) {
          logger.warn(
            { err, projectId },
            "failed to delete expired project from Git Bridge",
          );
        }
      },
    },
  },
};

export default CommunityFeaturesModule;
