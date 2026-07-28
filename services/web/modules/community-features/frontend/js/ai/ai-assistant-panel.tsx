import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import MaterialIcon from "@/shared/components/material-icon";
import { Modal } from "react-bootstrap";
import getMeta from "@/utils/meta";
import { useProjectContext } from "@/shared/context/project-context";
import {
  AI_APPLY_RESULT,
  AI_APPLY_TEXT,
  AI_EDITOR_STATE,
  AI_REQUEST_EDITOR_STATE,
  AI_SELECTION_CAPTURED,
  AiApplyRequest,
  AiSelection,
} from "./ai-assistant-events";
import SafeMarkdown from "./safe-markdown";
import "../../stylesheets/ai-assistant.scss";

type AiStatus = {
  configured: boolean;
  userEnabled: boolean;
  providerOrigin: string | null;
  selectedConnectorId: string | null;
  selectedModel: string | null;
  connectors: Array<{
    id: string;
    name: string;
    models: string[];
    providerOrigin: string | null;
  }>;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  selection?: AiSelection;
  model?: string;
  streaming?: boolean;
};

const csrfToken = getMeta("ol-csrfToken");

async function requestJson(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || `HTTP ${response.status}`);
  }
  return body;
}

type StreamEvent = {
  event: string;
  data: Record<string, any>;
};

function parseStreamBlock(block: string): StreamEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: JSON.parse(data.join("\n")) };
}

async function requestEventStream(
  url: string,
  options: RequestInit,
  onEvent: (event: StreamEvent) => void,
) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("The server did not provide an AI stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let doneData: Record<string, any> = {};

  const processBuffer = (flush = false) => {
    let separator: number;
    while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const delimiter = buffer.slice(separator).match(/^\r?\n\r?\n/)?.[0];
      if (!delimiter) break;
      const parsed = parseStreamBlock(buffer.slice(0, separator));
      buffer = buffer.slice(separator + delimiter.length);
      if (!parsed) continue;
      if (parsed.event === "error") {
        throw new Error(String(parsed.data.message || "The AI stream failed."));
      }
      onEvent(parsed);
      if (parsed.event === "done") {
        completed = true;
        doneData = parsed.data;
      }
    }
    if (flush && buffer.trim()) {
      const parsed = parseStreamBlock(buffer);
      buffer = "";
      if (parsed?.event === "error") {
        throw new Error(String(parsed.data.message || "The AI stream failed."));
      }
      if (parsed) onEvent(parsed);
      if (parsed?.event === "done") {
        completed = true;
        doneData = parsed.data;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    processBuffer();
  }
  buffer += decoder.decode();
  processBuffer(true);
  if (!completed) throw new Error("The AI stream was interrupted.");
  return doneData;
}

function messageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newConversationId() {
  return crypto.randomUUID();
}

function insertableText(content: string) {
  const match = content
    .trim()
    .match(/^```(?:latex|tex)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1] : content;
}

function conversationContent(message: ChatMessage) {
  if (!message.selection || message.role !== "user") return message.content;
  return `${message.content}\n\nQuoted selection from ${message.selection.docName}:\n<selection>\n${message.selection.source}\n</selection>`;
}

export default function AiAssistantPanel() {
  const { projectId } = useProjectContext();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState(newConversationId);
  const conversationIdRef = useRef(conversationId);
  const [selection, setSelection] = useState<AiSelection | undefined>();
  const [activeDocName, setActiveDocName] = useState("");
  const [input, setInput] = useState("");
  const [includeProjectContext, setIncludeProjectContext] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showConsentModal, setShowConsentModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const resetConversation = useCallback(() => {
    const nextConversationId = newConversationId();
    conversationIdRef.current = nextConversationId;
    setConversationId(nextConversationId);
    setMessages([]);
    setSelection(undefined);
    setInput("");
    setNotice("");
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatus(await requestJson(`/project/${projectId}/ai/status`));
  }, [projectId]);

  useEffect(() => {
    resetConversation();
    refreshStatus().catch((error) => setNotice(error.message));
  }, [refreshStatus, resetConversation]);

  useEffect(() => {
    const captured = (event: Event) => {
      const value = (event as CustomEvent<AiSelection>).detail;
      if (!value.source) {
        setNotice("Select some text in the document first.");
        return;
      }
      setSelection(value);
      setActiveDocName(value.docName);
      setNotice("The selection will be quoted in your next question.");
    };
    const editorState = (event: Event) => {
      setActiveDocName(
        (event as CustomEvent<{ docName: string }>).detail.docName || "",
      );
    };
    const applyResult = (event: Event) => {
      setNotice(
        (event as CustomEvent<{ ok: boolean; message: string }>).detail.message,
      );
    };
    window.addEventListener(AI_SELECTION_CAPTURED, captured);
    window.addEventListener(AI_EDITOR_STATE, editorState);
    window.addEventListener(AI_APPLY_RESULT, applyResult);
    window.dispatchEvent(new Event(AI_REQUEST_EDITOR_STATE));
    return () => {
      window.removeEventListener(AI_SELECTION_CAPTURED, captured);
      window.removeEventListener(AI_EDITOR_STATE, editorState);
      window.removeEventListener(AI_APPLY_RESULT, applyResult);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);

  const updateConsent = async (enabled: boolean) => {
    setNotice("");
    try {
      setStatus(
        await requestJson(`/project/${projectId}/ai/consent`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            enabled,
            _csrf: csrfToken,
          }),
        }),
      );
      setNotice(
        enabled
          ? "The AI assistant is enabled for this project."
          : "The AI assistant is disabled for this project.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const selectModel = async (value: string) => {
    const { connectorId, model } = JSON.parse(value);
    if (
      busy ||
      (connectorId === status?.selectedConnectorId &&
        model === status?.selectedModel)
    ) {
      return;
    }
    resetConversation();
    try {
      const nextStatus = await requestJson(
        `/project/${projectId}/ai/connector`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            connectorId,
            model,
            _csrf: csrfToken,
          }),
        },
      );
      setStatus(nextStatus);
      setNotice(
        nextStatus.userEnabled
          ? "Model changed. A new empty conversation was created."
          : "Model changed. You must enable the selected server.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const question = input.trim();
    if (!question || busy || !status?.userEnabled) return;

    const quotedSelection = selection;
    const userMessage: ChatMessage = {
      id: messageId(),
      role: "user",
      content: question,
      selection: quotedSelection,
    };
    const nextMessages = [...messages, userMessage];
    const assistantMessageId = messageId();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      selection: quotedSelection,
      streaming: true,
    };
    setMessages([...nextMessages, assistantMessage]);
    setInput("");
    setSelection(undefined);
    setBusy(true);
    setNotice("");
    const requestConversationId = conversationId;
    let streamedContent = "";
    try {
      const result = await requestEventStream(
        `/project/${projectId}/ai/chat`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            _csrf: csrfToken,
            conversationId: requestConversationId,
            messages: nextMessages.map((message) => ({
              role: message.role,
              content:
                message.id === userMessage.id
                  ? message.content
                  : conversationContent(message),
            })),
            selection: quotedSelection,
            activeDocName,
            includeProjectContext,
          }),
        },
        (streamEvent) => {
          if (conversationIdRef.current !== requestConversationId) return;
          if (streamEvent.event === "meta") {
            if (streamEvent.data.conversationId !== requestConversationId) {
              throw new Error("The server mixed up two AI conversations.");
            }
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, model: String(streamEvent.data.model || "") }
                  : message,
              ),
            );
          }
          if (streamEvent.event === "delta") {
            const content = String(streamEvent.data.content || "");
            streamedContent += content;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: message.content + content }
                  : message,
              ),
            );
          }
        },
      );
      if (
        result.conversationId !== requestConversationId ||
        conversationIdRef.current !== requestConversationId
      ) {
        return;
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                streaming: false,
                model: String(result.model || ""),
              }
            : message,
        ),
      );
      const contextText = includeProjectContext
        ? `${result.context.includedFiles} context file(s)${result.context.truncated ? ", context truncated" : ""}`
        : "without project context";
      setNotice(`Response generated with ${result.model} — ${contextText}.`);
    } catch (error) {
      if (conversationIdRef.current === requestConversationId) {
        setMessages((current) =>
          streamedContent
            ? current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, streaming: false }
                  : message,
              )
            : current.filter((message) => message.id !== assistantMessageId),
        );
      }
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const applyAnswer = (message: ChatMessage, mode: AiApplyRequest["mode"]) => {
    window.dispatchEvent(
      new CustomEvent(AI_APPLY_TEXT, {
        detail: {
          text: insertableText(message.content),
          mode,
          selection: message.selection,
        } satisfies AiApplyRequest,
      }),
    );
  };

  if (!status) {
    return <div className="community-ai-panel-state">Loading AI…</div>;
  }

  if (!status.configured) {
    return (
      <div className="community-ai-panel-state">
        <MaterialIcon type="smart_toy" />
        <strong>AI assistant unavailable</strong>
        <p>
          The administrator must first configure a compatible provider.
        </p>
      </div>
    );
  }

  const modelOptions = status.connectors.flatMap((connector) =>
    connector.models.map((model) => ({ connector, model })),
  );
  const selectedModelValue = JSON.stringify({
    connectorId: status.selectedConnectorId,
    model: status.selectedModel,
  });

  if (!status.userEnabled) {
    return (
      <>
        <div className="community-ai-panel-state">
          <MaterialIcon type="smart_toy" />
          <strong>AI assistant disabled for this project</strong>
          <p>
            Consent is specific to this project and remains disabled by
            default.
          </p>
          <label className="community-ai-model-selector">
            Model
            <select
              value={selectedModelValue}
              onChange={(event) => void selectModel(event.target.value)}
              disabled={busy}
            >
              {modelOptions.map(({ connector, model }) => (
                <option
                  key={`${connector.id}:${model}`}
                  value={JSON.stringify({ connectorId: connector.id, model })}
                >
                  {connector.name} — {model}
                </option>
              ))}
            </select>
          </label>
          <div className="form-check form-switch community-ai-consent-switch">
            <input
              id="community-ai-project-consent"
              className="form-check-input"
              type="checkbox"
              role="switch"
              checked={false}
              onChange={() => setShowConsentModal(true)}
            />
            <label
              className="form-check-label"
              htmlFor="community-ai-project-consent"
            >
              Enable AI for this project
            </label>
          </div>
          {notice && <div className="community-ai-notice">{notice}</div>}
        </div>
        <Modal
          show={showConsentModal}
          onHide={() => setShowConsentModal(false)}
          centered
        >
          <Modal.Header closeButton>
            <Modal.Title>Allow sending data?</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>
              <strong>Warning: your data will leave this server.</strong>
            </p>
            <p>
              Your questions, the selected excerpts and, when the context option
              is enabled, the text content of this project will be sent to the
              AI server configured by the administrator:
            </p>
            <p className="community-ai-provider-origin">
              {status.providerOrigin || "unidentified server"}
            </p>
            <p>
              Nothing will be sent if you decline or close this window.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setShowConsentModal(false)}
            >
              Decline
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={async () => {
                await updateConsent(true);
                setShowConsentModal(false);
              }}
            >
              I understand, enable
            </button>
          </Modal.Footer>
        </Modal>
      </>
    );
  }

  return (
    <section className="community-ai-panel" aria-label="AI assistant">
      <header className="community-ai-panel-header">
        <div>
          <strong>AI assistant</strong>
          <small>Current LaTeX project</small>
        </div>
        <button
          className="btn btn-sm btn-secondary"
          type="button"
          onClick={resetConversation}
          disabled={busy}
        >
          New conversation
        </button>
      </header>
      <div className="form-check form-switch community-ai-active-switch">
        <input
          id="community-ai-project-active"
          className="form-check-input"
          type="checkbox"
          role="switch"
          checked
          onChange={() => void updateConsent(false)}
        />
        <label
          className="form-check-label"
          htmlFor="community-ai-project-active"
        >
          AI enabled for this project
        </label>
      </div>
      <label className="community-ai-model-selector">
        Model
        <select
          value={selectedModelValue}
          onChange={(event) => void selectModel(event.target.value)}
          disabled={busy}
        >
          {modelOptions.map(({ connector, model }) => (
            <option
              key={`${connector.id}:${model}`}
              value={JSON.stringify({ connectorId: connector.id, model })}
            >
              {connector.name} — {model}
            </option>
          ))}
        </select>
      </label>

      <div className="community-ai-messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="community-ai-empty">
            <p>Ask a question about the project or request LaTeX code.</p>
          </div>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`community-ai-message community-ai-message-${message.role}`}
          >
            <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
            {message.selection && message.role === "user" && (
              <blockquote>
                {message.selection.docName || "Document"}: “{" "}
                {message.selection.source.slice(0, 240)}
                {message.selection.source.length > 240 ? "…" : ""}”
              </blockquote>
            )}
            {message.streaming && !message.content ? (
              <div className="community-ai-thinking" role="status">
                <span>The model is thinking</span>
                <span className="community-ai-thinking-dots" aria-hidden="true">
                  <span>•</span>
                  <span>•</span>
                  <span>•</span>
                </span>
              </div>
            ) : (
              <>
                {message.role === "assistant" ? (
                  <SafeMarkdown content={message.content} />
                ) : (
                  <pre>{message.content}</pre>
                )}
                {message.streaming && (
                  <span
                    className="community-ai-stream-cursor"
                    aria-hidden="true"
                  >
                    ▍
                  </span>
                )}
              </>
            )}
            {message.role === "assistant" && !message.streaming && (
              <div className="community-ai-message-actions">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(message.content)}
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => applyAnswer(message, "insert")}
                >
                  Insert at cursor
                </button>
                {message.selection && (
                  <button
                    type="button"
                    onClick={() => applyAnswer(message, "replace")}
                  >
                    Replace selection
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="community-ai-composer" onSubmit={sendMessage}>
        {selection && (
          <div className="community-ai-quote">
            <span>
              {selection.docName || "Document"}:{" "}
              {selection.source.slice(0, 180)}
              {selection.source.length > 180 ? "…" : ""}
            </span>
            <button
              type="button"
              aria-label="Remove quote"
              onClick={() => setSelection(undefined)}
            >
              ×
            </button>
          </div>
        )}
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder="Ask for writing, an explanation, or LaTeX code…"
          rows={3}
          maxLength={8000}
          disabled={busy}
        />
        <div className="community-ai-composer-options">
          <label>
            <input
              type="checkbox"
              checked={includeProjectContext}
              onChange={(event) =>
                setIncludeProjectContext(event.target.checked)
              }
            />{" "}
            Project context
          </label>
          <button
            className="btn btn-primary btn-sm"
            type="submit"
            disabled={!input.trim() || busy}
          >
            Send
          </button>
        </div>
      </form>
      {notice && <div className="community-ai-notice">{notice}</div>}
    </section>
  );
}
