import Path from "node:path";
import { expressify } from "@overleaf/promise-utils";
import SessionManager from "../../../../../app/src/Features/Authentication/SessionManager.mjs";
import Settings from "@overleaf/settings";
import { RateLimiter } from "../../../../../app/src/infrastructure/RateLimiter.mjs";
import AiManager from "./AiManager.mjs";
import ProjectGetter from "../../../../../app/src/Features/Project/ProjectGetter.mjs";
import ProjectAuditLogHandler from "../../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs";
import UserAuditLogHandler from "../../../../../app/src/Features/User/UserAuditLogHandler.mjs";
import logger from "@overleaf/logger";

// Audit logging must never block the underlying action; log and continue.
async function safeUserAudit(userId, action, ipAddress, info) {
  try {
    await UserAuditLogHandler.promises.addEntry(
      userId,
      action,
      userId,
      ipAddress,
      info,
    );
  } catch (err) {
    logger.warn({ err, action }, "failed to write community AI audit entry");
  }
}

const adminViewPath = Path.resolve(
  import.meta.dirname,
  "../../views/admin-ai.pug",
);
const projectViewPath = Path.resolve(
  import.meta.dirname,
  "../../views/project-ai.pug",
);
const completionRateLimiter = new RateLimiter("community-ai-completion", {
  points: Settings.communityFeatures.ai.requestsPerMinute,
  duration: 60,
});

function userId(req) {
  return SessionManager.getLoggedInUserId(req.session);
}

function setAdminNotice(req, notice) {
  req.session.communityAiNotice = notice;
}

function popAdminNotice(req) {
  const notice = req.session.communityAiNotice;
  delete req.session.communityAiNotice;
  return notice;
}

async function adminIndex(req, res) {
  res.render(adminViewPath, {
    title: "AI connector",
    connectors: await AiManager.getAdminCatalog(),
    notice: popAdminNotice(req),
  });
}

async function adminAddConnector(req, res) {
  try {
    const connector = await AiManager.addConnector({
      baseUrl: req.body.baseUrl,
      apiKey: req.body.apiKey,
      userId: userId(req),
    });
    await safeUserAudit(userId(req), "ai-connector-added", req.ip, {
      name: connector.name,
    });
    if (req.xhr || req.accepts(["html", "json"]) === "json") {
      return res.status(201).json({
        connector,
        message: `${connector.name} was tested and added with ${connector.models.length} model(s).`,
      });
    }
    setAdminNotice(req, {
      type: "success",
      message: `${connector.name} was tested and added with ${connector.models.length} model(s).`,
    });
  } catch (error) {
    if (req.xhr || req.accepts(["html", "json"]) === "json") {
      return res.status(error.statusCode || 400).json({
        message:
          error.message || "The AI connector test or configuration failed.",
      });
    }
    setAdminNotice(req, {
      type: "danger",
      message:
        error.message || "The AI connector test or configuration failed.",
    });
  }
  res.redirect("/admin/community/ai");
}

async function adminRefreshConnector(req, res) {
  try {
    const connector = await AiManager.refreshConnector(
      req.params.connectorId,
      userId(req),
    );
    setAdminNotice(req, {
      type: "success",
      message: `${connector.models.length} model(s) detected on ${connector.name}.`,
    });
  } catch (error) {
    setAdminNotice(req, {
      type: "danger",
      message: error.message || "The list of models could not be refreshed.",
    });
  }
  res.redirect("/admin/community/ai");
}

async function adminDeleteConnector(req, res) {
  try {
    await AiManager.deleteConnector(req.params.connectorId, userId(req));
    await safeUserAudit(userId(req), "ai-connector-deleted", req.ip, {
      connectorId: req.params.connectorId,
    });
    setAdminNotice(req, {
      type: "success",
      message: "AI connector deleted.",
    });
  } catch (error) {
    setAdminNotice(req, {
      type: "danger",
      message: error.message || "AI connector deletion failed.",
    });
  }
  res.redirect("/admin/community/ai");
}

async function status(req, res) {
  res.json(await AiManager.getPublicStatus(userId(req), req.params.Project_id));
}

async function consent(req, res) {
  try {
    const enabled = req.body.enabled === true;
    const result = await AiManager.setProjectEnabled(
      userId(req),
      req.params.Project_id,
      enabled,
    );
    try {
      await ProjectAuditLogHandler.promises.addEntry(
        req.params.Project_id,
        "ai-consent-updated",
        userId(req),
        req.ip,
        { enabled },
      );
    } catch (err) {
      logger.warn({ err }, "failed to write community AI consent audit entry");
    }
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function selectConnector(req, res) {
  try {
    res.json(
      await AiManager.selectProjectConnector(
        userId(req),
        req.params.Project_id,
        req.body.connectorId,
        req.body.model,
      ),
    );
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function projectIndex(req, res) {
  const project = await ProjectGetter.promises.getProject(
    req.params.Project_id,
    { name: 1 },
  );
  res.render(projectViewPath, {
    title: `AI assistant — ${project.name}`,
    project,
  });
}

async function completion(req, res) {
  try {
    await completionRateLimiter.consume(userId(req), 1, { method: "userId" });
    const result = await AiManager.complete({
      userId: userId(req),
      projectId: req.params.Project_id,
      action: req.body.action,
      source: req.body.source,
      instruction: req.body.instruction,
    });
    res.json(result);
  } catch (error) {
    if (!(error instanceof Error)) {
      return res.status(429).json({ message: "AI request limit exceeded" });
    }
    if (error.statusCode)
      return res.status(error.statusCode).json({ message: error.message });
    throw error;
  }
}

async function chat(req, res) {
  try {
    await completionRateLimiter.consume(userId(req), 1, { method: "userId" });
    const result = await AiManager.chat({
      userId: userId(req),
      projectId: req.params.Project_id,
      conversationId: req.body.conversationId,
      messages: req.body.messages,
      selection: req.body.selection,
      activeDocName: req.body.activeDocName,
      includeProjectContext: req.body.includeProjectContext !== false,
    });
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    writeStreamEvent(res, "meta", {
      model: result.model,
      connectorId: result.connectorId,
      conversationId: result.conversationId,
    });
    for await (const content of result.chunks) {
      if (res.destroyed) return;
      writeStreamEvent(res, "delta", { content });
    }
    if (!res.destroyed) {
      writeStreamEvent(res, "done", {
        model: result.model,
        conversationId: result.conversationId,
        context: result.context,
      });
      res.end();
    }
  } catch (error) {
    if (res.headersSent) {
      if (!res.destroyed) {
        writeStreamEvent(res, "error", {
          message: error.message || "AI response stream failed",
        });
        res.end();
      }
      return;
    }
    if (!(error instanceof Error)) {
      return res.status(429).json({ message: "AI request limit exceeded" });
    }
    if (error.statusCode)
      return res.status(error.statusCode).json({ message: error.message });
    throw error;
  }
}

function writeStreamEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export default {
  adminIndex: expressify(adminIndex),
  adminAddConnector: expressify(adminAddConnector),
  adminRefreshConnector: expressify(adminRefreshConnector),
  adminDeleteConnector: expressify(adminDeleteConnector),
  status: expressify(status),
  consent: expressify(consent),
  selectConnector: expressify(selectConnector),
  projectIndex: expressify(projectIndex),
  completion: expressify(completion),
  chat: expressify(chat),
};
