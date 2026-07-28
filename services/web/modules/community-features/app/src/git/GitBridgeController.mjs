import Settings from "@overleaf/settings";
import { expressify } from "@overleaf/promise-utils";
import GitBridgeManager from "./GitBridgeManager.mjs";

function projectId(req) {
  return req.params.projectId;
}

async function requireToken(req, res) {
  const auth = await GitBridgeManager.authenticateRequest(req);
  if (!auth) {
    res.status(401).json({ error_code: "invalid_token" });
    return null;
  }
  return auth;
}

async function tokenInfo(req, res) {
  const auth = await requireToken(req, res);
  if (!auth) return;
  res.json({ active: true, user_id: auth.userId.toString() });
}

async function authorize(req, res) {
  const auth = await requireToken(req, res);
  if (!auth) return;
  try {
    const write = req.query.access === "write";
    await GitBridgeManager.authorizeProject(auth.userId, projectId(req), {
      write,
    });
    res.json({ ok: true });
  } catch (error) {
    machineError(res, error);
  }
}

async function getDocument(req, res) {
  const auth = await requireToken(req, res);
  if (!auth) return;
  try {
    res.json(
      await GitBridgeManager.describeProject({
        projectId: projectId(req),
        userId: auth.userId,
      }),
    );
  } catch (error) {
    machineError(res, error);
  }
}

async function getSavedVersions(req, res) {
  const auth = await requireToken(req, res);
  if (!auth) return;
  try {
    await GitBridgeManager.authorizeProject(auth.userId, projectId(req));
    res.json([]);
  } catch (error) {
    machineError(res, error);
  }
}

async function getSnapshot(req, res) {
  const auth = await requireToken(req, res);
  if (!auth) return;
  try {
    res.json(
      await GitBridgeManager.snapshotAtVersion({
        projectId: projectId(req),
        version: Number.parseInt(req.params.version, 10),
        userId: auth.userId,
        origin: Settings.communityFeatures.gitBridge.webInternalUrl,
      }),
    );
  } catch (error) {
    machineError(res, error);
  }
}

async function pushSnapshot(req, res) {
  const auth = await requireToken(req, res);
  if (!auth) return;
  try {
    const result = await GitBridgeManager.applyPush({
      projectId: projectId(req),
      userId: auth.userId,
      latestVerId: Number.parseInt(req.body.latestVerId, 10),
      files: req.body.files,
    });
    res.status(200).json(result);
  } catch (error) {
    machineError(res, error);
  }
}

async function streamBlob(req, res) {
  try {
    await GitBridgeManager.streamBlob({
      projectId: projectId(req),
      hash: req.params.hash,
      signature: req.query.signature,
      res,
    });
  } catch (error) {
    if (!res.headersSent) machineError(res, error);
    else res.destroy(error);
  }
}

function machineError(res, error) {
  const status = error.statusCode || 500;
  res.status(status).json({
    status,
    code: status === 403 ? "forbidden" : "error",
    message: status === 403 ? "Forbidden" : "Git Bridge operation failed",
  });
}

export default {
  authorize: expressify(authorize),
  getDocument: expressify(getDocument),
  getSavedVersions: expressify(getSavedVersions),
  getSnapshot: expressify(getSnapshot),
  pushSnapshot: expressify(pushSnapshot),
  streamBlob: expressify(streamBlob),
  tokenInfo: expressify(tokenInfo),
};
