import { pipeline } from "node:stream/promises";
import { expressify } from "@overleaf/promise-utils";
import SessionManager from "../../../../../app/src/Features/Authentication/SessionManager.mjs";
import ProjectGetter from "../../../../../app/src/Features/Project/ProjectGetter.mjs";
import ReviewPdfManager from "./ReviewPdfManager.mjs";

function safeName(name) {
  return String(name || "project")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 100);
}

async function download(req, res) {
  try {
    const projectId = req.params.Project_id;
    const userId = SessionManager.getLoggedInUserId(req.session);
    const project = await ProjectGetter.promises.getProject(projectId, {
      name: 1,
    });
    const { stream } = await ReviewPdfManager.compile(projectId, userId);
    res.contentType("application/pdf");
    res.setContentDisposition("inline", {
      filename: `${safeName(project?.name)}-review.pdf`,
    });
    res.setHeader("Cache-Control", "no-store");
    await pipeline(stream, res);
  } catch (error) {
    if (error.statusCode && !res.headersSent) {
      return res.status(error.statusCode).json({
        message: error.message,
        validationProblems: error.result?.validationProblems,
      });
    }
    throw error;
  }
}

export default { download: expressify(download) };
