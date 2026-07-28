import { useCallback } from "react";
import MaterialIcon from "@/shared/components/material-icon";
import OLTooltip from "@/shared/components/ol/ol-tooltip";
import { useCodeMirrorViewContext } from "@/features/source-editor/components/codemirror-context";
import { useEditorOpenDocContext } from "@/features/ide-react/context/editor-open-doc-context";
import { AI_SELECTION_CAPTURED, AiSelection } from "./ai-assistant-events";

export default function AiSelectionAction() {
  const view = useCodeMirrorViewContext();
  const { openDocName } = useEditorOpenDocContext();

  const handleClick = useCallback(() => {
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    const selection: AiSelection = {
      source: view.state.sliceDoc(from, to),
      from,
      to,
      docName: openDocName || "",
    };
    window.dispatchEvent(
      new CustomEvent(AI_SELECTION_CAPTURED, { detail: selection }),
    );
    window.dispatchEvent(
      new CustomEvent("ui:select-rail-tab", {
        detail: { tab: "ai-assistant", open: true },
      }),
    );
  }, [openDocName, view]);

  return (
    <OLTooltip
      id="editor-floating-menu-community-ai"
      description="Citer dans l’assistant IA"
      overlayProps={{ placement: "right" }}
    >
      <button
        className="editor-floating-menu-button editor-floating-menu-community-ai-button"
        onClick={handleClick}
        aria-label="Citer dans l’assistant IA"
      >
        <MaterialIcon type="smart_toy" />
        <span>Citer dans l’assistant IA</span>
      </button>
    </OLTooltip>
  );
}
