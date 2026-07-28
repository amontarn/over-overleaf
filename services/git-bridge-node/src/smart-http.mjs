import { spawn } from "node:child_process";

const MAX_CGI_HEADER_BYTES = 64 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;

export async function serveGitHttp({
  request,
  response,
  repoRoot,
  projectId,
  suffix,
  token,
  config,
  maxBodyBytes,
}) {
  const query = new URL(
    request.url,
    "http://git.local",
  ).searchParams.toString();
  const env = {
    ...process.env,
    GIT_PROJECT_ROOT: repoRoot,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: `/${projectId}.git${suffix}`,
    REQUEST_METHOD: request.method,
    QUERY_STRING: query,
    CONTENT_TYPE: request.headers["content-type"] || "",
    CONTENT_LENGTH: request.headers["content-length"] || "",
    REMOTE_USER: "git",
    REMOTE_ADDR: request.socket.remoteAddress || "",
    GIT_BRIDGE_TOKEN: token,
    GIT_BRIDGE_PROJECT_ID: projectId,
    GIT_BRIDGE_BRANCH: config.branch,
    GIT_BRIDGE_HOOK_URL: `http://127.0.0.1:${config.port}`,
    GIT_BRIDGE_INTERNAL_SECRET: config.internalSecret,
  };
  const child = spawn("git", ["http-backend"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let protocolError;
  if (Number.isFinite(maxBodyBytes)) {
    let bodyBytes = 0;
    request.on("data", (chunk) => {
      bodyBytes += chunk.length;
      if (bodyBytes > maxBodyBytes) {
        protocolError = new Error("git request body exceeds the size limit");
        protocolError.statusCode = 413;
        request.unpipe(child.stdin);
        child.kill("SIGKILL");
        request.destroy();
      }
    });
  }
  request.pipe(child.stdin);
  request.once("aborted", () => child.kill("SIGTERM"));
  response.once("close", () => {
    if (!response.writableEnded) child.kill("SIGTERM");
  });

  const stderr = [];
  let stderrBytes = 0;
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= MAX_STDERR_BYTES) stderr.push(chunk);
  });
  let headersSent = false;
  let pending = Buffer.alloc(0);
  child.stdout.on("data", (chunk) => {
    if (headersSent) {
      response.write(chunk);
      return;
    }
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > MAX_CGI_HEADER_BYTES) {
      protocolError = new Error("git http-backend returned oversized headers");
      child.kill("SIGKILL");
      return;
    }
    const boundary = headerBoundary(pending);
    if (!boundary) return;
    const headerBlock = pending.subarray(0, boundary.index).toString("utf8");
    const body = pending.subarray(boundary.index + boundary.length);
    applyCgiHeaders(response, headerBlock);
    headersSent = true;
    if (body.length) response.write(body);
    pending = Buffer.alloc(0);
  });

  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (protocolError) throw protocolError;
  if (!headersSent) {
    const detail = Buffer.concat(stderr).toString("utf8").trim();
    throw new Error(`git http-backend failed (${code}): ${detail}`);
  }
  response.end();
}

export function applyCgiHeaders(response, block) {
  let status = 200;
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name.toLowerCase() === "status") {
      status = Number.parseInt(value, 10) || 200;
    } else {
      response.setHeader(name, value);
    }
  }
  response.statusCode = status;
}

function headerBoundary(buffer) {
  let index = buffer.indexOf("\r\n\r\n");
  if (index >= 0) return { index, length: 4 };
  index = buffer.indexOf("\n\n");
  return index >= 0 ? { index, length: 2 } : null;
}
