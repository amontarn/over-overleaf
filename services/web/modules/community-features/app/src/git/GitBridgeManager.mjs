import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import Path from "node:path";
import { pipeline } from "node:stream/promises";
import Settings from "@overleaf/settings";
import LockManager from "../../../../../app/src/infrastructure/LockManager.mjs";
import DocumentUpdaterHandler from "../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs";
import HistoryManager from "../../../../../app/src/Features/History/HistoryManager.mjs";
import AuthorizationManager from "../../../../../app/src/Features/Authorization/AuthorizationManager.mjs";
import UserGetter from "../../../../../app/src/Features/User/UserGetter.mjs";
import ProjectAuditLogHandler from "../../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs";
import ProjectEntityHandler from "../../../../../app/src/Features/Project/ProjectEntityHandler.mjs";
import { ChunkResponse, Snapshot } from "overleaf-editor-core";
import ProjectFileSyncManager from "./ProjectFileSyncManager.mjs";
import GitTokenManager from "./GitTokenManager.mjs";
import { safeDestination } from "./GitPolicy.mjs";
import { derivedKeyHex } from "../security/DerivedSecrets.mjs";

const lockManager = LockManager.withTimeout(10 * 60);
async function authenticateRequest(req) {
  const record = await GitTokenManager.authenticate(
    GitTokenManager.bearerToken(req),
  );
  return record ? { userId: record.userId, tokenId: record._id } : null;
}

async function authorizeProject(userId, projectId, { write = false } = {}) {
  const allowed = write
    ? await AuthorizationManager.promises.canUserWriteProjectContent(
        userId,
        projectId,
      )
    : await AuthorizationManager.promises.canUserReadProject(userId, projectId);
  if (!allowed) {
    const error = new Error("forbidden");
    error.statusCode = 403;
    throw error;
  }
}

async function currentProjectState(projectId) {
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId);
  await HistoryManager.promises.flushProject(projectId);
  const rawHistory = await HistoryManager.promises.getLatestHistory(projectId);
  const chunk = ChunkResponse.fromRaw(rawHistory)?.getChunk();
  const version = chunk?.getEndVersion();
  if (!Number.isInteger(version) || version < 0) {
    throw new Error("project history did not return a valid version");
  }
  return { version, timestamp: chunk.getEndTimestamp() || new Date(0) };
}

async function currentVersion(projectId) {
  return (await currentProjectState(projectId)).version;
}

async function describeProject({ projectId, userId }) {
  await authorizeProject(userId, projectId);
  const [state, user] = await Promise.all([
    currentProjectState(projectId),
    UserGetter.promises.getUser(userId, {
      email: 1,
      first_name: 1,
      last_name: 1,
    }),
  ]);
  return {
    latestVerId: state.version,
    latestVerAt: state.timestamp.toISOString(),
    latestVerBy: {
      email: user?.email || "git@localhost",
      name:
        [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
        user?.email ||
        "Overleaf user",
    },
  };
}

async function snapshotAtVersion({ projectId, version, userId, origin }) {
  await authorizeProject(userId, projectId);
  const raw = await HistoryManager.promises.getContentAtVersion(
    projectId,
    version,
  );
  const snapshot = Snapshot.fromRaw(raw);
  const srcs = [];
  const atts = [];
  for (const pathname of snapshot.getFilePathnames().sort()) {
    const file = snapshot.getFile(pathname);
    const content = file?.getContent({ filterTrackedDeletes: true });
    if (typeof content === "string") {
      srcs.push([content, pathname]);
    } else if (file?.getHash()) {
      atts.push([
        signedBlobUrl({ projectId, hash: file.getHash(), origin }),
        pathname,
      ]);
    }
  }
  return { srcs, atts };
}

async function streamBlob({ projectId, hash, signature, res }) {
  if (!validBlobSignature(projectId, hash, signature)) {
    const error = new Error("invalid blob signature");
    error.statusCode = 403;
    throw error;
  }
  const { stream, contentLength } =
    await HistoryManager.promises.requestBlobWithProjectId(projectId, hash);
  if (Number.isFinite(contentLength)) res.set("Content-Length", contentLength);
  res.type("application/octet-stream");
  await pipeline(stream, res);
}

async function applyPush({ projectId, userId, latestVerId, files }) {
  await authorizeProject(userId, projectId, { write: true });
  if (!Array.isArray(files)) throw new Error("files must be an array");
  return await lockManager.promises.runWithLock(
    "community-git-bridge",
    projectId,
    async () => {
      const version = await currentVersion(projectId);
      if (version !== latestVerId) return { code: "outOfDate" };

      const baseDir = Path.join(
        Settings.communityFeatures.gitBridge.workDir,
        "bridge-imports",
      );
      await fsp.mkdir(baseDir, { recursive: true, mode: 0o700 });
      const workDir = await fsp.mkdtemp(Path.join(baseDir, `${projectId}-`));
      const incomingDir = Path.join(workDir, "incoming");
      const backupDir = Path.join(workDir, "backup");
      try {
        await fsp.mkdir(incomingDir, { mode: 0o700 });
        await ProjectFileSyncManager.exportProjectToDirectory(
          projectId,
          incomingDir,
        );
        await fsp.cp(incomingDir, backupDir, { recursive: true });
        const incoming = new Set();
        for (const file of files) {
          if (!file || typeof file.name !== "string") {
            throw new Error("invalid Git Bridge file entry");
          }
          const destination = safeDestination(incomingDir, file.name);
          incoming.add(file.name);
          if (file.url) {
            await fetchBridgeFile(file.url, destination);
          } else {
            await fsp.access(destination);
          }
        }
        if ((await currentVersion(projectId)) !== latestVerId) {
          return { code: "outOfDate" };
        }
        await removeMissingProjectFiles(projectId, incomingDir, incoming);
        let newVersion;
        try {
          await ProjectFileSyncManager.importDirectory(
            projectId,
            incomingDir,
            userId,
          );
          newVersion = await currentVersion(projectId);
        } catch (error) {
          try {
            await ProjectFileSyncManager.importDirectory(
              projectId,
              backupDir,
              userId,
            );
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "Git push import failed and the project backup could not be restored",
            );
          }
          throw error;
        }
        await ProjectAuditLogHandler.promises.addEntry(
          projectId,
          "git-bridge-push-imported",
          userId,
          null,
          { oldVersion: latestVerId, newVersion, fileCount: files.length },
        );
        return { code: "upToDate", latestVerId: newVersion };
      } finally {
        await fsp.rm(workDir, { recursive: true, force: true });
      }
    },
  );
}

async function removeMissingProjectFiles(projectId, dir, incoming) {
  const [docs, files] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ]);
  for (const pathname of [...Object.keys(docs), ...Object.keys(files)]) {
    if (!incoming.has(pathname)) {
      await fsp.rm(safeDestination(dir, pathname), {
        recursive: true,
        force: true,
      });
    }
  }
}

async function fetchBridgeFile(urlString, destination) {
  const url = new URL(urlString);
  const internal = new URL(Settings.communityFeatures.gitBridge.internalUrl);
  if (url.origin !== internal.origin || !url.pathname.startsWith("/api/")) {
    throw new Error("Git Bridge supplied an invalid file URL");
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Git Bridge file fetch failed with ${response.status}`);
  }
  await fsp.mkdir(Path.dirname(destination), { recursive: true });
  await pipeline(
    response.body,
    fs.createWriteStream(destination, { mode: 0o600 }),
  );
}

function signedBlobUrl({ projectId, hash, origin }) {
  const signature = blobSignature(projectId, hash);
  return `${origin}/api/v0/git-bridge/blob/${projectId}/${hash}?signature=${signature}`;
}

function blobSignature(projectId, hash) {
  return crypto
    .createHmac("sha256", derivedKeyHex("git-bridge-blob"))
    .update(`${projectId}\0${hash}`)
    .digest("hex");
}

function validBlobSignature(projectId, hash, signature) {
  if (!/^[a-f0-9]{64}$/.test(signature || "")) return false;
  return crypto.timingSafeEqual(
    Buffer.from(blobSignature(projectId, hash), "hex"),
    Buffer.from(signature, "hex"),
  );
}

export default {
  applyPush,
  authenticateRequest,
  authorizeProject,
  currentVersion,
  describeProject,
  snapshotAtVersion,
  streamBlob,
  _mocks: { blobSignature, validBlobSignature },
};
