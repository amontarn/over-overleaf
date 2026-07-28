import assert from "node:assert/strict";
import test from "node:test";
import {
  attachSelection,
  buildProjectContext,
  normaliseConversation,
} from "../../app/src/ai/AiPromptBuilder.mjs";

test("normalises a bounded alternating conversation", () => {
  assert.deepEqual(
    normaliseConversation(
      [
        { role: "user", content: " Question " },
        { role: "assistant", content: "Answer" },
        { role: "user", content: "Follow-up" },
      ],
      100,
    ),
    [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Follow-up" },
    ],
  );
});

test("rejects a conversation that does not end with a user message", () => {
  assert.throws(
    () =>
      normaliseConversation([{ role: "assistant", content: "Answer" }], 100),
    /last conversation message/,
  );
});

test("prioritises the active document and truncates project context", () => {
  const result = buildProjectContext(
    {
      "chapter.tex": { lines: ["chapter"] },
      "main.tex": { lines: ["main document is deliberately long"] },
    },
    ["diagram.pdf"],
    "main.tex",
    35,
  );
  assert.match(result.text, /main\.tex/);
  assert.equal(result.includedFiles, 1);
  assert.equal(result.truncated, true);
});

test("quotes the selected LaTeX in the latest user message", () => {
  const result = attachSelection(
    [{ role: "user", content: "Reformule ceci" }],
    { docName: "main.tex", source: "\\section{Test}" },
  );
  assert.match(result[0].content, /main\.tex/);
  assert.match(result[0].content, /\\section\{Test\}/);
});
