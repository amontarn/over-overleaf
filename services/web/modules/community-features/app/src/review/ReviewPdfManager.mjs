import ProjectEntityHandler from "../../../../../app/src/Features/Project/ProjectEntityHandler.mjs";
import ProjectRootDocManager from "../../../../../app/src/Features/Project/ProjectRootDocManager.mjs";
import DocumentUpdaterHandler from "../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs";
import CompileManager from "../../../../../app/src/Features/Compile/CompileManager.mjs";
import ClsiManager from "../../../../../app/src/Features/Compile/ClsiManager.mjs";
import { annotate } from "./ReviewLatex.mjs";

async function compile(projectId, userId) {
  const [rootDocument, docs] = await Promise.all([
    ProjectRootDocManager.promises.ensureRootDocumentIsValid(projectId),
    ProjectEntityHandler.promises.getAllDocs(projectId),
  ]);
  if (!rootDocument)
    throw new Error("project has no valid LaTeX root document");
  const overrides = {};
  for (const [path, doc] of Object.entries(docs)) {
    // Use editor coordinates: regular document content excludes tracked
    // deletions and ranges keep their positions in that same coordinate space.
    const current = await DocumentUpdaterHandler.promises.getDocument(
      projectId,
      doc._id,
      -1,
    );
    const content = current.lines.join("\n");
    overrides[path] = annotate(content, current.ranges?.changes, {
      isRoot: doc._id.toString() === rootDocument.rootDocId.toString(),
    });
  }
  const result = await CompileManager.promises.compile(projectId, userId, {
    resourceOverrides: overrides,
    incrementalCompilesEnabled: false,
    forceNewClsiServer: true,
  });
  if (result.status !== "success") {
    const error = new Error(
      `annotated PDF compilation failed: ${result.status}`,
    );
    error.statusCode = 422;
    error.result = result;
    throw error;
  }
  const pdf = result.outputFiles.find((file) => file.path === "output.pdf");
  if (!pdf) throw new Error("annotated PDF compilation produced no PDF");
  const stream = await ClsiManager.promises.getOutputFileStream(
    projectId,
    userId,
    result.clsiServerId,
    result.buildId,
    pdf.path,
  );
  return { stream, buildId: result.buildId };
}

export default { annotate, compile };
