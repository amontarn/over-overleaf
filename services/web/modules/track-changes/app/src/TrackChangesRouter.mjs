import { expressify } from "@overleaf/promise-utils";
import AuthorizationMiddleware from "../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs";
import TrackChangesController from "./TrackChangesController.mjs";

const read = [
  AuthorizationMiddleware.blockRestrictedUserFromProject,
  AuthorizationMiddleware.ensureUserCanReadProject,
];
const review = [
  AuthorizationMiddleware.blockRestrictedUserFromProject,
  AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
];

function apply(webRouter) {
  webRouter.get(
    "/project/:project_id/threads",
    ...read,
    expressify(TrackChangesController.getThreads),
  );
  webRouter.post(
    "/project/:project_id/thread/:thread_id/messages",
    ...review,
    expressify(TrackChangesController.sendComment),
  );
  webRouter.post(
    "/project/:project_id/thread/:thread_id/messages/:message_id/edit",
    ...review,
    expressify(TrackChangesController.editMessage),
  );
  webRouter.delete(
    "/project/:project_id/thread/:thread_id/messages/:message_id",
    ...review,
    AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread,
    expressify(TrackChangesController.deleteMessage),
  );
  webRouter.delete(
    "/project/:project_id/thread/:thread_id/own-messages/:message_id",
    ...review,
    expressify(TrackChangesController.deleteOwnMessage),
  );
  webRouter.post(
    "/project/:project_id/doc/:doc_id/thread/:thread_id/resolve",
    ...review,
    AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread,
    expressify(TrackChangesController.resolveThread),
  );
  webRouter.post(
    "/project/:project_id/doc/:doc_id/thread/:thread_id/reopen",
    ...review,
    AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread,
    expressify(TrackChangesController.reopenThread),
  );
  webRouter.delete(
    "/project/:project_id/doc/:doc_id/thread/:thread_id",
    ...review,
    AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread,
    expressify(TrackChangesController.deleteThread),
  );
  webRouter.get(
    "/project/:project_id/ranges",
    ...read,
    expressify(TrackChangesController.getRanges),
  );
  webRouter.get(
    "/project/:project_id/changes/users",
    ...read,
    expressify(TrackChangesController.getChangesUsers),
  );
  webRouter.post(
    "/project/:project_id/doc/:doc_id/changes/accept",
    ...review,
    expressify(TrackChangesController.acceptChanges),
  );
  // Project-wide, per-other-user and guest track-changes settings are an owner
  // capability, not something a reviewer or collaborator may change.
  webRouter.post(
    "/project/:project_id/track_changes",
    AuthorizationMiddleware.blockRestrictedUserFromProject,
    AuthorizationMiddleware.ensureUserCanAdminProject,
    expressify(TrackChangesController.setTrackChanges),
  );
  // Any write/review collaborator may toggle only their own flag.
  webRouter.post(
    "/project/:project_id/track_changes/me",
    ...review,
    expressify(TrackChangesController.setTrackChangesForSelf),
  );
}

export default { apply };
