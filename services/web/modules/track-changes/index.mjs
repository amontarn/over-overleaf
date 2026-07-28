import ProjectEditorHandler from "../../app/src/Features/Project/ProjectEditorHandler.mjs";
import TrackChangesRouter from "./app/src/TrackChangesRouter.mjs";

// The shared editor, document-updater and history code contains the complete
// tracked-changes implementation. This CE module enables those guarded paths.
ProjectEditorHandler.trackChangesAvailable = true;
ProjectEditorHandler.trackChangesEnabled = true;

export default { router: TrackChangesRouter };
