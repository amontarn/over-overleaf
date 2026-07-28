import AuthorizationMiddleware from "../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs";
import AdminUsersController from "./admin/AdminUsersController.mjs";
import GitController from "./git/GitController.mjs";
import GitBridgeController from "./git/GitBridgeController.mjs";
import AiController from "./ai/AiController.mjs";
import ReviewPdfController from "./review/ReviewPdfController.mjs";
import AuthenticationController from "../../../../app/src/Features/Authentication/AuthenticationController.mjs";
import { RateLimiter } from "../../../../app/src/infrastructure/RateLimiter.mjs";
import RateLimiterMiddleware from "../../../../app/src/Features/Security/RateLimiterMiddleware.mjs";

const gitLabImportRateLimiter = new RateLimiter("community-gitlab-import", {
  points: 10,
  duration: 60,
});

// The review PDF forces a fresh, non-incremental CLSI compile, so it is
// expensive; cap how often a single user can trigger it.
const reviewPdfRateLimiter = new RateLimiter("community-review-pdf", {
  points: 6,
  duration: 60,
});

export default {
  apply(webRouter) {
    const requireAdmin = AuthorizationMiddleware.ensureUserIsSiteAdmin;

    webRouter.get(
      "/admin/community/users",
      requireAdmin,
      AdminUsersController.index,
    );
    webRouter.post(
      "/admin/community/users",
      requireAdmin,
      AdminUsersController.create,
    );
    webRouter.post(
      "/admin/community/users/:userId/suspend",
      requireAdmin,
      AdminUsersController.suspend,
    );
    webRouter.post(
      "/admin/community/users/:userId/unsuspend",
      requireAdmin,
      AdminUsersController.unsuspend,
    );
    webRouter.post(
      "/admin/community/users/:userId/revoke-sessions",
      requireAdmin,
      AdminUsersController.revokeSessions,
    );
    webRouter.post(
      "/admin/community/users/:userId/delete",
      requireAdmin,
      AdminUsersController.delete,
    );
    webRouter.get("/admin/community/ai", requireAdmin, AiController.adminIndex);
    webRouter.post(
      "/admin/community/ai",
      requireAdmin,
      AiController.adminAddConnector,
    );
    webRouter.post(
      "/admin/community/ai/:connectorId/refresh",
      requireAdmin,
      AiController.adminRefreshConnector,
    );
    webRouter.post(
      "/admin/community/ai/:connectorId/delete",
      requireAdmin,
      AiController.adminDeleteConnector,
    );

    const requireProjectRead = AuthorizationMiddleware.ensureUserCanReadProject;
    webRouter.get(
      "/project/:Project_id/git",
      requireProjectRead,
      GitController.index,
    );
    webRouter.get(
      "/project/:Project_id/git/status",
      requireProjectRead,
      GitController.status,
    );
    webRouter.post(
      "/project/:Project_id/git/tokens",
      requireProjectRead,
      GitController.createToken,
    );
    webRouter.post(
      "/project/:Project_id/git/tokens/:tokenId/revoke",
      requireProjectRead,
      GitController.revokeToken,
    );
    const requireProjectAdmin =
      AuthorizationMiddleware.ensureUserCanAdminProject;
    webRouter.post(
      "/project/new/import-gitlab",
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(gitLabImportRateLimiter),
      GitController.importGitLabProject,
    );
    webRouter.post(
      "/project/:Project_id/git/gitlab/connect",
      requireProjectAdmin,
      GitController.connectGitLab,
    );
    webRouter.post(
      "/project/:Project_id/git/gitlab/pull",
      requireProjectAdmin,
      GitController.pullGitLab,
    );
    webRouter.post(
      "/project/:Project_id/git/gitlab/push",
      requireProjectAdmin,
      GitController.pushGitLab,
    );
    webRouter.post(
      "/project/:Project_id/git/gitlab/disconnect",
      requireProjectAdmin,
      GitController.disconnectGitLab,
    );
    webRouter.post(
      "/project/:Project_id/ai/completion",
      requireProjectRead,
      AiController.completion,
    );
    webRouter.post(
      "/project/:Project_id/ai/chat",
      requireProjectRead,
      AiController.chat,
    );
    webRouter.get(
      "/project/:Project_id/ai/status",
      requireProjectRead,
      AiController.status,
    );
    webRouter.post(
      "/project/:Project_id/ai/consent",
      requireProjectRead,
      AiController.consent,
    );
    webRouter.post(
      "/project/:Project_id/ai/connector",
      requireProjectRead,
      AiController.selectConnector,
    );
    webRouter.get(
      "/project/:Project_id/ai",
      requireProjectRead,
      AiController.projectIndex,
    );
    webRouter.get(
      "/project/:Project_id/review/pdf",
      RateLimiterMiddleware.rateLimit(reviewPdfRateLimiter, {
        params: ["Project_id"],
      }),
      AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
      ReviewPdfController.download,
    );
  },
  applyNonCsrfRouter(webRouter) {
    webRouter.get("/oauth/token/info", GitBridgeController.tokenInfo);
    webRouter.get(
      "/api/v0/docs/:projectId/authorize",
      GitBridgeController.authorize,
    );
    webRouter.get("/api/v0/docs/:projectId", GitBridgeController.getDocument);
    webRouter.get(
      "/api/v0/docs/:projectId/saved_vers",
      GitBridgeController.getSavedVersions,
    );
    webRouter.get(
      "/api/v0/docs/:projectId/snapshots/:version",
      GitBridgeController.getSnapshot,
    );
    webRouter.post(
      "/api/v0/docs/:projectId/snapshots",
      GitBridgeController.pushSnapshot,
    );
    webRouter.get(
      "/api/v0/git-bridge/blob/:projectId/:hash",
      GitBridgeController.streamBlob,
    );
  },
};
