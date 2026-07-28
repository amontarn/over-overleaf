export const AI_SELECTION_CAPTURED = "community-ai:selection-captured";
export const AI_REQUEST_EDITOR_STATE = "community-ai:request-editor-state";
export const AI_EDITOR_STATE = "community-ai:editor-state";
export const AI_APPLY_TEXT = "community-ai:apply-text";
export const AI_APPLY_RESULT = "community-ai:apply-result";

export type AiSelection = {
  source: string;
  from: number;
  to: number;
  docName: string;
};

export type AiApplyRequest = {
  text: string;
  mode: "insert" | "replace";
  selection?: AiSelection;
};
