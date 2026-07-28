const REVIEW_PREAMBLE = String.raw`
% Generated only for the annotated review PDF.
\usepackage[normalem]{ulem}
\usepackage{xcolor}
\definecolor{OLReviewAddition}{RGB}{0,92,197}
\definecolor{OLReviewDeletion}{RGB}{207,34,46}
\newcommand{\OLReviewAdd}[1]{{\color{OLReviewAddition}#1}}
\newcommand{\OLReviewDelete}[1]{{\color{OLReviewDeletion}\sout{#1}}}
`;

export function annotate(content, changes, { isRoot = false } = {}) {
  const inserts = [];
  const deletes = new Map();
  const beginDocument = "\\begin{document}";
  const rootBody = isRoot ? content.indexOf(beginDocument) : -1;
  const annotationStart = rootBody === -1 ? 0 : rootBody + beginDocument.length;
  for (const change of changes || []) {
    const op = change?.op;
    if (!op || !Number.isInteger(op.p) || op.p < 0 || op.p > content.length) {
      continue;
    }
    if (op.p < annotationStart) continue;
    if (
      typeof op.i === "string" &&
      content.slice(op.p, op.p + op.i.length) === op.i
    ) {
      inserts.push({ from: op.p, to: op.p + op.i.length });
    } else if (typeof op.d === "string") {
      const entries = deletes.get(op.p) || [];
      entries.push(op.d);
      deletes.set(op.p, entries);
    }
  }
  inserts.sort((a, b) => a.from - b.from || b.to - a.to);
  const starts = new Map(inserts.map((range) => [range.from, range]));
  const ends = new Map(inserts.map((range) => [range.to, range]));
  let result = "";
  for (let position = 0; position <= content.length; position++) {
    if (ends.has(position)) result += "}% OL review addition end\n";
    for (const deleted of deletes.get(position) || []) {
      result += `\\OLReviewDelete{${escapeDeletedLatex(deleted)}}% OL review deletion\n`;
    }
    if (starts.has(position)) result += "\\OLReviewAdd{";
    if (position < content.length) result += content[position];
  }
  if (!isRoot) return result;
  const documentClass = /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/;
  if (!documentClass.test(result)) {
    throw new Error(
      "annotated review PDF requires a LaTeX root document with \\documentclass",
    );
  }
  return result.replace(documentClass, (match) => `${match}${REVIEW_PREAMBLE}`);
}

export function escapeDeletedLatex(value) {
  const replacements = new Map([
    ["\\", "\\textbackslash{}"],
    ["{", "\\{"],
    ["}", "\\}"],
    ["#", "\\#"],
    ["$", "\\$"],
    ["%", "\\%"],
    ["&", "\\&"],
    ["_", "\\_"],
    ["^", "\\textasciicircum{}"],
    ["~", "\\textasciitilde{}"],
    ["\t", " "],
    ["\r", " "],
    ["\n", " "],
  ]);
  return [...value]
    .map((character) => replacements.get(character) || character)
    .join("");
}
