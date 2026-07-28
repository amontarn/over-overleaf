import crypto from "node:crypto";
import fsp from "node:fs/promises";
import Path from "node:path";
import Settings from "@overleaf/settings";
import LockManager from "../../../../../app/src/infrastructure/LockManager.mjs";
import ProjectAuditLogHandler from "../../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs";
import ProjectFileSyncManager from "../git/ProjectFileSyncManager.mjs";
import { validateBranch } from "../git/GitPolicy.mjs";
import RemoteUrlPolicy from "../security/RemoteUrlPolicy.mjs";
import SecretManager from "../security/SecretManager.mjs";
import GitLabGitClient from "./GitLabGitClient.mjs";
import { GitLabConnection } from "./GitLabConnection.mjs";

const lockManager = LockManager.withTimeout(300);

function validateUsername(value) {
  const username = typeof value === "string" ? value.trim() : "";
  if (!username || username.length > 100 || /[\r\n\0]/.test(username)) {
    throw new Error("invalid GitLab username");
  }
  return username;
}

function publicConnection(connection) {
  if (!connection) return null;
  return {
    remoteUrl: connection.remoteUrl,
    branch: connection.branch,
    username: connection.username,
    lastSyncedCommit: connection.lastSyncedCommit,
    lastSyncedAt: connection.lastSyncedAt,
  };
}

async function get(projectId) {
  return publicConnection(
    await GitLabConnection.findOne({ projectId }).lean().exec(),
  );
}

async function connectAndImport({
  projectId,
  userId,
  remoteUrl,
  branch,
  username,
  token,
  ipAddress,
}) {
  return await withProjectLock(projectId, async () => {
    if (await GitLabConnection.exists({ projectId })) {
      throw new Error("this project already has a GitLab connection");
    }
    const url = await RemoteUrlPolicy.validate(remoteUrl, {
      allowPrivateHosts: Settings.communityFeatures.gitLab.allowPrivateHosts,
    });
    branch = validateBranch(branch);
    username = validateUsername(username || "oauth2");
    token = typeof token === "string" ? token.trim() : "";

    return await withTempDirectory(projectId, async (tempDir) => {
      const initialProjectHash = await currentProjectTreeHash(
        projectId,
        tempDir,
      );
      const repo = Path.join(tempDir, "repository");
      await GitLabGitClient.clone({
        remoteUrl: url.toString(),
        branch,
        username,
        token,
        destination: repo,
        tempDir,
        timeoutMs: Settings.communityFeatures.gitLab.requestTimeoutMs,
        maxBytes: Settings.communityFeatures.gitLab.maxImportBytes,
      });
      const commit = await GitLabGitClient.revParse(repo);
      await fsp.rm(Path.join(repo, ".git"), { recursive: true, force: true });
      const encryptedToken = token ? await SecretManager.encrypt(token) : null;
      await withProjectBackup(
        projectId,
        userId,
        tempDir,
        initialProjectHash,
        async () => {
          await ProjectFileSyncManager.importDirectory(projectId, repo, userId);
          const treeHash = await currentProjectTreeHash(projectId, tempDir);
          await GitLabConnection.create({
            projectId,
            connectedBy: userId,
            remoteUrl: url.toString(),
            branch,
            username,
            encryptedToken,
            lastSyncedCommit: commit,
            lastSyncedTreeHash: treeHash,
            lastSyncedAt: new Date(),
          });
        },
      );
      await audit(projectId, "gitlab-connected", userId, ipAddress, {
        remoteHost: url.host,
        branch,
        commit,
      });
      return { code: "imported", commit };
    });
  });
}

async function pull({ projectId, userId, ipAddress }) {
  return await withProjectLock(projectId, async () => {
    const connection = await requiredConnection(projectId);
    return await withTempDirectory(projectId, async (tempDir) => {
      const currentHash = await currentProjectTreeHash(projectId, tempDir);
      if (currentHash !== connection.lastSyncedTreeHash) {
        throw divergenceError(
          "Overleaf contains changes since the last synchronization. Push them before pulling.",
        );
      }
      const { repo, commit } = await cloneConnection(connection, tempDir);
      if (commit === connection.lastSyncedCommit) {
        return { code: "upToDate", commit };
      }
      await fsp.rm(Path.join(repo, ".git"), { recursive: true, force: true });
      await withProjectBackup(
        projectId,
        userId,
        tempDir,
        currentHash,
        async () => {
          await ProjectFileSyncManager.importDirectory(projectId, repo, userId);
          const treeHash = await currentProjectTreeHash(projectId, tempDir);
          await updateSyncPoint(connection, commit, treeHash);
        },
      );
      await audit(projectId, "gitlab-pulled", userId, ipAddress, {
        oldCommit: connection.lastSyncedCommit,
        newCommit: commit,
        branch: connection.branch,
      });
      return { code: "pulled", commit };
    });
  });
}

async function push({ projectId, userId, author, ipAddress }) {
  return await withProjectLock(projectId, async () => {
    const connection = await requiredConnection(projectId);
    return await withTempDirectory(projectId, async (tempDir) => {
      const exported = Path.join(tempDir, "overleaf");
      await fsp.mkdir(exported, { mode: 0o700 });
      await ProjectFileSyncManager.exportProjectToDirectory(
        projectId,
        exported,
      );
      const treeHash = await treeHashForDirectory(exported);
      if (treeHash === connection.lastSyncedTreeHash) {
        return { code: "upToDate", commit: connection.lastSyncedCommit };
      }

      const {
        repo,
        commit: remoteCommit,
        credentials,
      } = await cloneConnection(connection, tempDir);
      if (remoteCommit !== connection.lastSyncedCommit) {
        throw divergenceError(
          "GitLab contains changes since the last synchronization. Pull them before pushing.",
        );
      }
      await replaceWorktree(repo, exported);
      if (!(await GitLabGitClient.hasChanges(repo))) {
        await updateSyncPoint(connection, remoteCommit, treeHash);
        return { code: "upToDate", commit: remoteCommit };
      }
      const newCommit = await GitLabGitClient.commit(repo, {
        name: author.name || "Overleaf user",
        email: author.email || "git@overleaf.local",
        message: "Sync from Overleaf",
      });
      await GitLabGitClient.push(repo, connection.branch, credentials);
      await updateSyncPoint(connection, newCommit, treeHash);
      await audit(projectId, "gitlab-pushed", userId, ipAddress, {
        oldCommit: connection.lastSyncedCommit,
        newCommit,
        branch: connection.branch,
      });
      return { code: "pushed", commit: newCommit };
    });
  });
}

async function disconnect({ projectId, userId, ipAddress }) {
  return await withProjectLock(projectId, async () => {
    const connection = await GitLabConnection.findOneAndDelete({ projectId })
      .lean()
      .exec();
    if (!connection) throw new Error("GitLab connection not found");
    await audit(projectId, "gitlab-disconnected", userId, ipAddress, {
      remoteHost: new URL(connection.remoteUrl).host,
      branch: connection.branch,
    });
  });
}

async function deleteForProject(projectId) {
  await GitLabConnection.deleteOne({ projectId }).exec();
}

async function deleteForUser(userId) {
  await GitLabConnection.deleteMany({ connectedBy: userId }).exec();
}

async function cloneConnection(connection, tempDir) {
  const remoteUrl = await RemoteUrlPolicy.validate(connection.remoteUrl, {
    allowPrivateHosts: Settings.communityFeatures.gitLab.allowPrivateHosts,
  });
  const token = connection.encryptedToken
    ? await SecretManager.decrypt(connection.encryptedToken)
    : "";
  const repo = Path.join(tempDir, "repository");
  const credentials = await GitLabGitClient.clone({
    remoteUrl: remoteUrl.toString(),
    branch: connection.branch,
    username: connection.username,
    token,
    destination: repo,
    tempDir,
    timeoutMs: Settings.communityFeatures.gitLab.requestTimeoutMs,
    maxBytes: Settings.communityFeatures.gitLab.maxImportBytes,
  });
  const commit = await GitLabGitClient.revParse(repo);
  return { repo, commit, credentials };
}

async function requiredConnection(projectId) {
  const connection = await GitLabConnection.findOne({ projectId })
    .lean()
    .exec();
  if (!connection) throw new Error("GitLab connection not found");
  return connection;
}

async function updateSyncPoint(connection, commit, treeHash) {
  const result = await GitLabConnection.updateOne(
    { _id: connection._id, lastSyncedCommit: connection.lastSyncedCommit },
    {
      $set: {
        lastSyncedCommit: commit,
        lastSyncedTreeHash: treeHash,
        lastSyncedAt: new Date(),
      },
    },
  ).exec();
  if (result.modifiedCount !== 1) {
    throw new Error("GitLab synchronization state changed concurrently");
  }
}

async function withProjectLock(projectId, callback) {
  return await lockManager.promises.runWithLock(
    "community-gitlab-sync",
    projectId,
    callback,
  );
}

async function withTempDirectory(projectId, callback) {
  const root = Path.join(
    Settings.communityFeatures.gitBridge.workDir,
    "gitlab-sync",
  );
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const tempDir = await fsp.mkdtemp(Path.join(root, `${projectId}-`));
  try {
    return await callback(tempDir);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

async function currentProjectTreeHash(projectId, tempDir) {
  const dir = await fsp.mkdtemp(Path.join(tempDir, "overleaf-state-"));
  await ProjectFileSyncManager.exportProjectToDirectory(projectId, dir);
  return await treeHashForDirectory(dir);
}

async function withProjectBackup(
  projectId,
  userId,
  tempDir,
  expectedTreeHash,
  callback,
) {
  const backup = await fsp.mkdtemp(Path.join(tempDir, "overleaf-backup-"));
  await ProjectFileSyncManager.exportProjectToDirectory(projectId, backup);
  if ((await treeHashForDirectory(backup)) !== expectedTreeHash) {
    throw divergenceError(
      "Overleaf changed while the GitLab operation was running. Retry after online edits have settled.",
    );
  }
  try {
    return await callback();
  } catch (error) {
    try {
      await ProjectFileSyncManager.importDirectory(projectId, backup, userId);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "GitLab import failed and the Overleaf backup could not be restored",
      );
    }
    throw error;
  }
}

async function treeHashForDirectory(root) {
  const files = [];
  await walk(root, "", files);
  const digest = crypto.createHash("sha256");
  for (const pathname of files.sort()) {
    digest.update(pathname);
    digest.update("\0");
    digest.update(await fsp.readFile(Path.join(root, pathname)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function walk(root, relative, files) {
  const entries = await fsp.readdir(Path.join(root, relative), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!relative && entry.name === ".git") continue;
    const pathname = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic links are not supported: ${pathname}`);
    }
    if (entry.isDirectory()) await walk(root, pathname, files);
    else if (entry.isFile()) files.push(pathname);
    else throw new Error(`unsupported repository entry: ${pathname}`);
  }
}

async function replaceWorktree(repo, source) {
  for (const entry of await fsp.readdir(repo)) {
    if (entry !== ".git") {
      await fsp.rm(Path.join(repo, entry), { recursive: true, force: true });
    }
  }
  for (const entry of await fsp.readdir(source)) {
    await fsp.cp(Path.join(source, entry), Path.join(repo, entry), {
      recursive: true,
      force: true,
    });
  }
}

function divergenceError(message) {
  const error = new Error(message);
  error.code = "GITLAB_DIVERGED";
  return error;
}

async function audit(projectId, operation, userId, ipAddress, info) {
  await ProjectAuditLogHandler.promises.addEntry(
    projectId,
    operation,
    userId,
    ipAddress,
    info,
  );
}

export default {
  get,
  connectAndImport,
  pull,
  push,
  disconnect,
  deleteForProject,
  deleteForUser,
};
