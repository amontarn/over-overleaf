import { useMemo } from "react";
import DOMPurify from "dompurify";
import { micromark } from "micromark";

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "em",
    "del",
    "blockquote",
    "ul",
    "ol",
    "li",
    "pre",
    "code",
    "a",
  ],
  ALLOWED_ATTR: ["href", "title"],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
};

function isSafeLink(href: string) {
  if (!href) return false;
  if (href.startsWith("#")) return true;
  try {
    const url = new URL(href, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function renderSafeMarkdown(markdown: string) {
  const hardenLinks = (node: Element) => {
    if (node.nodeName !== "A") return;
    const href = node.getAttribute("href") || "";
    if (!isSafeLink(href)) {
      node.removeAttribute("href");
    }
    node.setAttribute("rel", "nofollow noreferrer noopener");
    node.setAttribute("target", "_blank");
  };

  DOMPurify.addHook("afterSanitizeAttributes", hardenLinks);
  try {
    // micromark escapes raw HTML by default. DOMPurify is a second, explicit
    // boundary before the generated markup reaches React.
    return DOMPurify.sanitize(micromark(markdown), SANITIZE_CONFIG);
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}

export default function SafeMarkdown({ content }: { content: string }) {
  const html = useMemo(() => renderSafeMarkdown(content), [content]);

  return (
    <div
      className="community-ai-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
