import { useEffect } from "react";
import { EditorState } from "@codemirror/state";
import { useCodeMirrorViewContext } from "@/features/source-editor/components/codemirror-context";
import { useEditorOpenDocContext } from "@/features/ide-react/context/editor-open-doc-context";
import {
  AI_APPLY_RESULT,
  AI_APPLY_TEXT,
  AI_EDITOR_STATE,
  AI_REQUEST_EDITOR_STATE,
  AiApplyRequest,
} from "./ai-assistant-events";

function dispatch<T>(name: string, detail: T) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export default function AiEditorBridge() {
  const view = useCodeMirrorViewContext();
  const { openDocName } = useEditorOpenDocContext();

  useEffect(() => {
    const reportEditorState = () => {
      dispatch(AI_EDITOR_STATE, { docName: openDocName || "" });
    };

    const applyText = (event: Event) => {
      const request = (event as CustomEvent<AiApplyRequest>).detail;
      const text = String(request?.text || "");
      if (!text) {
        dispatch(AI_APPLY_RESULT, {
          ok: false,
          message: "The response contains no text to insert.",
        });
        return;
      }
      if (view.state.facet(EditorState.readOnly)) {
        dispatch(AI_APPLY_RESULT, {
          ok: false,
          message: "Ce document n'est pas modifiable avec vos permissions.",
        });
        return;
      }

      let from = view.state.selection.main.head;
      let to = from;
      if (request.mode === "replace") {
        const selection = request.selection;
        if (!selection || selection.docName !== (openDocName || "")) {
          dispatch(AI_APPLY_RESULT, {
            ok: false,
            message:
              "The active document has changed. Re-quote the selection before replacing it.",
          });
          return;
        }
        if (
          selection.from < 0 ||
          selection.to > view.state.doc.length ||
          view.state.sliceDoc(selection.from, selection.to) !== selection.source
        ) {
          dispatch(AI_APPLY_RESULT, {
            ok: false,
            message:
              "The selection changed since the request. Re-quote it to avoid an overwrite.",
          });
          return;
        }
        from = selection.from;
        to = selection.to;
      }

      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      });
      view.focus();
      dispatch(AI_APPLY_RESULT, {
        ok: true,
        message:
          request.mode === "replace"
            ? "The selection was replaced."
            : "The response was inserted at the cursor.",
      });
    };

    window.addEventListener(AI_REQUEST_EDITOR_STATE, reportEditorState);
    window.addEventListener(AI_APPLY_TEXT, applyText);
    return () => {
      window.removeEventListener(AI_REQUEST_EDITOR_STATE, reportEditorState);
      window.removeEventListener(AI_APPLY_TEXT, applyText);
    };
  }, [openDocName, view]);

  return null;
}
