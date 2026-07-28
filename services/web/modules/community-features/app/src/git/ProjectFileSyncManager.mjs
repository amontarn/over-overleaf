import fs from "node:fs";
import fsp from "node:fs/promises";
import Path from "node:path";
import { pipeline } from "node:stream/promises";
import Settings from "@overleaf/settings";
import DocumentUpdaterHandler from "../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs";
import ProjectEntityHandler from "../../../../../app/src/Features/Project/ProjectEntityHandler.mjs";
import ProjectEntityUpdateHandler from "../../../../../app/src/Features/Project/ProjectEntityUpdateHandler.mjs";
import ProjectZipStreamManager from "../../../../../app/src/Features/Downloads/ProjectZipStreamManager.mjs";
import FileSystemImportManager from "../../../../../app/src/Features/Uploads/FileSystemImportManager.mjs";
import { safeDestination } from "./GitPolicy.mjs";

const SOURCE = "git-bridge";

async function exportProjectToDirectory(projectId, dir) {
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId);
  const [docs, files] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ]);
  enforceEntityCount(Object.keys(docs).length + Object.keys(files).length);
  let bytes = 0;
  for (const [projectPath, doc] of Object.entries(docs)) {
    const destination = safeDestination(dir, projectPath);
    await fsp.mkdir(Path.dirname(destination), { recursive: true });
    const content = doc.lines.join("\n");
    bytes += Buffer.byteLength(content);
    enforceBytes(bytes);
    await fsp.writeFile(destination, content, { mode: 0o600 });
  }
  for (const [projectPath, file] of Object.entries(files)) {
    const destination = safeDestination(dir, projectPath);
    await fsp.mkdir(Path.dirname(destination), { recursive: true });
    const stream = await getFileStream(projectId, file);
    await pipeline(stream, fs.createWriteStream(destination, { mode: 0o600 }));
    bytes += (await fsp.stat(destination)).size;
    enforceBytes(bytes);
  }
}

async function importDirectory(projectId, dir, userId) {
  const entries = await FileSystemImportManager.promises.importDir(dir);
  enforceEntityCount(entries.length);
  let bytes = 0;
  for (const entry of entries) {
    bytes +=
      entry.type === "doc"
        ? Buffer.byteLength(entry.lines.join("\n"))
        : (await fsp.stat(entry.fsPath)).size;
    enforceBytes(bytes);
  }
  const incomingPaths = new Set(entries.map((entry) => entry.projectPath));
  const existing =
    await ProjectEntityHandler.promises.getAllEntities(projectId);
  const existingEntries = [
    ...existing.docs.map(({ path }) => ({ path })),
    ...existing.files.map(({ path }) => ({ path })),
  ].sort((a, b) => b.path.length - a.path.length);

  for (const entry of entries) {
    if (entry.type === "doc") {
      await ProjectEntityUpdateHandler.promises.upsertDocWithPath(
        projectId,
        entry.projectPath,
        entry.lines,
        SOURCE,
        userId,
      );
    } else {
      await ProjectEntityUpdateHandler.promises.upsertFileWithPath(
        projectId,
        entry.projectPath,
        entry.fsPath,
        null,
        userId,
        SOURCE,
      );
    }
  }
  for (const entry of existingEntries) {
    if (!incomingPaths.has(entry.path)) {
      await ProjectEntityUpdateHandler.promises.deleteEntityWithPath(
        projectId,
        entry.path,
        userId,
        SOURCE,
      );
    }
  }
}

async function getFileStream(projectId, file) {
  return await new Promise((resolve, reject) => {
    ProjectZipStreamManager.getFileStream(projectId, file, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

function enforceEntityCount(count) {
  if (count > Settings.communityFeatures.gitBridge.maxFiles) {
    throw new Error("Git project exceeds configured file count limit");
  }
}

function enforceBytes(bytes) {
  if (bytes > Settings.communityFeatures.gitBridge.maxBytes) {
    throw new Error("Git project exceeds configured size limit");
  }
}

export default { exportProjectToDirectory, importDirectory };
