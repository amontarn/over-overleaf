import Path from "node:path";
import Settings from "@overleaf/settings";
import { expressify } from "@overleaf/promise-utils";
import SessionManager from "../../../../../app/src/Features/Authentication/SessionManager.mjs";
import ProjectGetter from "../../../../../app/src/Features/Project/ProjectGetter.mjs";
import UserGetter from "../../../../../app/src/Features/User/UserGetter.mjs";
import ProjectCreationHandler from "../../../../../app/src/Features/Project/ProjectCreationHandler.mjs";
import ProjectDeleter from "../../../../../app/src/Features/Project/ProjectDeleter.mjs";
import ProjectAuditLogHandler from "../../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs";
import UserAuditLogHandler from "../../../../../app/src/Features/User/UserAuditLogHandler.mjs";
import { DeletedProjectReasons } from "../../../../../app/src/Features/Project/DeletedProjectReasons.mjs";
import logger from "@overleaf/logger";
import GitTokenManager from "./GitTokenManager.mjs";
import GitLabSyncManager from "../gitlab/GitLabSyncManager.mjs";
import { validateProjectName } from "../gitlab/GitLabImportPolicy.mjs";

const viewPath = Path.resolve(
  import.meta.dirname,
  "../../views/project-git.pug",
);

function userId(req) {
  return SessionManager.getLoggedInUserId(req.session);
}

function projectId(req) {
  return req.params.Project_id;
}

function noticeKey(req) {
  return `communityGitNotice:${projectId(req)}`;
}

function setNotice(req, notice) {
  req.session[noticeKey(req)] = notice;
}

function popNotice(req) {
  const key = noticeKey(req);
  const notice = req.session[key];
  delete req.session[key];
  return notice;
}

async function index(req, res) {
  const [project, state] = await Promise.all([
    ProjectGetter.promises.getProject(projectId(req), { name: 1 }),
    getPublicState(req),
  ]);
  res.render(viewPath, {
    title: `Git — ${project.name}`,
    project,
    ...state,
    notice: popNotice(req),
  });
}

async function status(req, res) {
  res.json(await getPublicState(req));
}

async function getPublicState(req) {
  const [gitTokens, gitLabConnection] = await Promise.all([
    GitTokenManager.listTokens(userId(req)),
    GitLabSyncManager.get(projectId(req)),
  ]);
  return {
    gitBridgeEnabled: Settings.communityFeatures.gitBridge.enabled,
    gitBridgeCloneUrl: `${Settings.communityFeatures.gitBridge.publicUrl}/${projectId(req)}`,
    gitLabAvailable: Settings.communityFeatures.gitLab.available,
    gitLabConnection,
    gitTokens: gitTokens.map((token) => ({
      id: token._id.toString(),
      label: token.label,
      prefix: token.prefix,
      expiresAt: token.expiresAt,
      lastUsedAt: token.lastUsedAt || null,
      revokedAt: token.revokedAt || null,
    })),
  };
}

async function createToken(req, res) {
  const { token, record } = await GitTokenManager.createToken({
    userId: userId(req),
    label: req.body.label,
  });
  await UserAuditLogHandler.promises.addEntry(
    userId(req),
    "git-token-created",
    userId(req),
    req.ip,
    { tokenId: record._id?.toString(), prefix: record.prefix },
  );
  setNotice(req, {
    type: "success",
    message:
      "Git authentication token created. Copy it now; it will not be shown again.",
    token,
  });
  respond(req, res, {
    message: "Git authentication token created.",
    token,
  });
}

async function revokeToken(req, res) {
  await GitTokenManager.revokeToken({
    userId: userId(req),
    tokenId: req.params.tokenId,
  });
  await UserAuditLogHandler.promises.addEntry(
    userId(req),
    "git-token-revoked",
    userId(req),
    req.ip,
    { tokenId: req.params.tokenId },
  );
  setNotice(req, { type: "success", message: "Git token revoked." });
  respond(req, res, { message: "Git token revoked." });
}

async function connectGitLab(req, res) {
  ensureGitLabAvailable();
  if (req.body.confirmImport !== "yes") {
    throw new Error("confirm that the GitLab import may replace project files");
  }
  const result = await GitLabSyncManager.connectAndImport({
    projectId: projectId(req),
    userId: userId(req),
    remoteUrl: req.body.remoteUrl,
    branch: req.body.branch || "master",
    username: req.body.username || "oauth2",
    token: req.body.token,
    ipAddress: req.ip,
  });
  setNotice(req, {
    type: "success",
    message: `GitLab repository imported at ${shortCommit(result.commit)}.`,
  });
  respond(req, res, {
    message: `GitLab repository imported at ${shortCommit(result.commit)}.`,
  });
}

async function importGitLabProject(req, res) {
  ensureGitLabAvailable();
  const ownerId = userId(req);
  const projectName = validateProjectName(req.body.projectName);
  let project;

  try {
    project = await ProjectCreationHandler.promises.createBlankProject(
      ownerId,
      projectName,
      { segmentation: { source: "gitlab" } },
    );
    const result = await GitLabSyncManager.connectAndImport({
      projectId: project._id,
      userId: ownerId,
      remoteUrl: req.body.remoteUrl,
      branch: req.body.branch || "main",
      username: req.body.username || "oauth2",
      token: req.body.token,
      ipAddress: req.ip,
    });
    ProjectAuditLogHandler.addEntryIfManagedInBackground(
      project._id,
      "project-created-from-gitlab",
      ownerId,
      req.ip,
    );
    return res.status(201).json({
      project_id: project._id,
      commit: result.commit,
    });
  } catch (error) {
    if (project) {
      await cleanupFailedImport(project._id, error);
    }
    throw error;
  }
}

async function cleanupFailedImport(projectId, importError) {
  try {
    await GitLabSyncManager.deleteForProject(projectId);
    await ProjectDeleter.promises.deleteProject(projectId, {
      deletedReason: DeletedProjectReasons.GITLAB_IMPORT_FAILURE,
    });
  } catch (cleanupError) {
    logger.error(
      { err: cleanupError, importError, projectId },
      "failed to clean up GitLab project import",
    );
  }
}

async function pullGitLab(req, res) {
  ensureGitLabAvailable();
  const result = await GitLabSyncManager.pull({
    projectId: projectId(req),
    userId: userId(req),
    ipAddress: req.ip,
  });
  setNotice(req, {
    type: "success",
    message:
      result.code === "pulled"
        ? `GitLab changes imported at ${shortCommit(result.commit)}.`
        : "GitLab and Overleaf are already synchronized.",
  });
  respond(req, res, {
    message:
      result.code === "pulled"
        ? `GitLab changes imported at ${shortCommit(result.commit)}.`
        : "GitLab and Overleaf are already synchronized.",
  });
}

async function pushGitLab(req, res) {
  ensureGitLabAvailable();
  const user = await UserGetter.promises.getUser(userId(req), {
    first_name: 1,
    last_name: 1,
    email: 1,
  });
  const result = await GitLabSyncManager.push({
    projectId: projectId(req),
    userId: userId(req),
    author: {
      name:
        [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
        user?.email,
      email: user?.email,
    },
    ipAddress: req.ip,
  });
  setNotice(req, {
    type: "success",
    message:
      result.code === "pushed"
        ? `Overleaf changes pushed to GitLab at ${shortCommit(result.commit)}.`
        : "GitLab and Overleaf are already synchronized.",
  });
  respond(req, res, {
    message:
      result.code === "pushed"
        ? `Overleaf changes pushed to GitLab at ${shortCommit(result.commit)}.`
        : "GitLab and Overleaf are already synchronized.",
  });
}

async function disconnectGitLab(req, res) {
  if (req.body.confirmDisconnect !== "yes") {
    throw new Error("confirm removal of the GitLab connection");
  }
  await GitLabSyncManager.disconnect({
    projectId: projectId(req),
    userId: userId(req),
    ipAddress: req.ip,
  });
  setNotice(req, {
    type: "success",
    message: "GitLab connection removed. Project files were not changed.",
  });
  respond(req, res, {
    message: "GitLab connection removed. Project files were not changed.",
  });
}

function ensureGitLabAvailable() {
  if (!Settings.communityFeatures.gitLab.available) {
    throw new Error("GitLab connector is disabled by the administrator");
  }
}

function shortCommit(commit) {
  return commit.slice(0, 12);
}

function formAction(handler) {
  return expressify(async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (wantsJson(req)) {
        return res.status(error.statusCode || 400).json({
          message: error.message || "Git operation failed.",
        });
      }
      setNotice(req, {
        type: "danger",
        message: error.message || "Git operation failed.",
      });
      res.redirect(`/project/${projectId(req)}/git`);
    }
  });
}

function jsonAction(handler) {
  return expressify(async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      res.status(error.statusCode || 400).json({
        message: error.message || "Git operation failed.",
      });
    }
  });
}

function wantsJson(req) {
  return req.xhr || req.accepts(["html", "json"]) === "json";
}

function respond(req, res, body) {
  if (wantsJson(req)) {
    delete req.session[noticeKey(req)];
    return res.json(body);
  }
  res.redirect(`/project/${projectId(req)}/git`);
}

export default {
  index: expressify(index),
  status: expressify(status),
  createToken: formAction(createToken),
  revokeToken: formAction(revokeToken),
  connectGitLab: formAction(connectGitLab),
  importGitLabProject: jsonAction(importGitLabProject),
  pullGitLab: formAction(pullGitLab),
  pushGitLab: formAction(pushGitLab),
  disconnectGitLab: formAction(disconnectGitLab),
};
