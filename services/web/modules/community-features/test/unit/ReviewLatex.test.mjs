import assert from "node:assert/strict";
import test from "node:test";
import {
  annotate,
  escapeDeletedLatex,
} from "../../app/src/review/ReviewLatex.mjs";

test("escapes deleted LaTeX instead of executing it", () => {
  assert.equal(
    escapeDeletedLatex(String.raw`\end{document} 50% & value_1`),
    String.raw`\textbackslash{}end\{document\} 50\% \& value\_1`,
  );
});

test("injects review commands only after the document begins", () => {
  const content = String.raw`\documentclass{article}
\begin{document}
Hello world
\end{document}`;
  const bodyStart = content.indexOf("Hello");
  const result = annotate(
    content,
    [
      { op: { p: 0, d: String.raw`\documentclass{book}` } },
      { op: { p: bodyStart, i: "Hello" } },
      { op: { p: bodyStart + 5, d: "old_50%" } },
    ],
    { isRoot: true },
  );

  assert.match(result, /\\usepackage\[normalem\]\{ulem\}/);
  assert.doesNotMatch(result, /OLReviewDelete.*documentclass\{book/);
  assert.match(result, /\\OLReviewAdd\{Hello\}/);
  assert.match(result, /\\OLReviewDelete\{old\\_50\\%\}/);
});
