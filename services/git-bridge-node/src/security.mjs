import crypto from "node:crypto";

export function extractToken(authorization = "") {
  const [scheme, value] = authorization.split(/\s+/, 2);
  if (!value) return null;
  if (scheme.toLowerCase() === "bearer") return value;
  if (scheme.toLowerCase() !== "basic") return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator < 0 ? null : decoded.slice(separator + 1) || null;
  } catch {
    return null;
  }
}

export function safeEqual(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signature(secret, ...parts) {
  return crypto
    .createHmac("sha256", secret)
    .update(parts.join("\0"))
    .digest("hex");
}

export function validProjectId(value) {
  return /^[a-f0-9]{24}$/i.test(value || "");
}

export function validOid(value) {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value || "");
}

export function validatePath(pathname) {
  if (
    typeof pathname !== "string" ||
    pathname.length === 0 ||
    pathname.length > 1024 ||
    pathname.startsWith("/") ||
    pathname.includes("\\") ||
    pathname.includes("\0") ||
    pathname
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    /[\r\n\t]/.test(pathname)
  ) {
    throw new Error("invalid project file path");
  }
  return pathname;
}
