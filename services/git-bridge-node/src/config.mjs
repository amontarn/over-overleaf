import Path from "node:path";

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const rootDir = Path.resolve(
  process.env.GIT_BRIDGE_ROOT_DIR || "/data/git-bridge",
);

export const config = Object.freeze({
  host: process.env.GIT_BRIDGE_BIND_IP || "0.0.0.0",
  port: integer("GIT_BRIDGE_PORT", 8000),
  rootDir,
  webBaseUrl: new URL(
    process.env.GIT_BRIDGE_WEB_URL || "http://sharelatex:3000",
  ).origin,
  publicBaseUrl: new URL(
    process.env.GIT_BRIDGE_PUBLIC_URL || "http://localhost:8000",
  ).origin,
  internalBaseUrl: new URL(
    process.env.GIT_BRIDGE_INTERNAL_URL || "http://git-bridge:8000",
  ).origin,
  internalSecret: required("GIT_BRIDGE_INTERNAL_SECRET"),
  branch: process.env.GIT_BRIDGE_BRANCH || "master",
  maxFiles: integer("GIT_BRIDGE_MAX_FILES", 2000),
  maxFileSize: integer("GIT_BRIDGE_MAX_FILE_SIZE", 50 * 1024 * 1024),
  maxProjectSize: integer("GIT_BRIDGE_MAX_PROJECT_SIZE", 100 * 1024 * 1024),
  // Hard cap on the size of an uploaded pack, enforced before git receives it.
  maxPackSize: integer("GIT_BRIDGE_MAX_PACK_SIZE", 100 * 1024 * 1024),
  // Maximum number of concurrent git-http operations across all projects.
  maxConcurrentGitRequests: integer("GIT_BRIDGE_MAX_CONCURRENT_REQUESTS", 16),
  requestTimeoutMs: integer("GIT_BRIDGE_REQUEST_TIMEOUT_MS", 60_000),
});
