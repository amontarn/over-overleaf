import fs from "node:fs/promises";
import http from "node:http";
import { spawn } from "node:child_process";
import { config } from "./config.mjs";
import { withProjectLock } from "./lock.mjs";
import { RepositoryManager } from "./repository.mjs";
import {
  extractToken,
  safeEqual,
  validOid,
  validProjectId,
} from "./security.mjs";
import { serveGitHttp } from "./smart-http.mjs";
import { WebClient } from "./web-client.mjs";

const webClient = new WebClient(config);
const repositories = new RepositoryManager(config, webClient);

await fs.mkdir(config.rootDir, { recursive: true, mode: 0o700 });

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: error.message,
        stack: error.stack,
        method: request.method,
        url: request.url,
      }),
    );
    if (response.headersSent) return response.destroy(error);
    const status = error.statusCode || (error.userError ? 409 : 500);
    json(response, status, {
      error: status === 500 ? "internal_error" : "request_rejected",
      message: status === 500 ? "Git Bridge operation failed" : error.message,
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Node.js Git Bridge listening",
      host: config.host,
      port: config.port,
      branch: config.branch,
    }),
  );
});

async function route(request, response) {
  const url = new URL(request.url, "http://git.local");
  if (request.method === "GET" && url.pathname === "/health_check") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return response.end("ok");
  }

  const hook = /^\/internal\/pre-receive\/([a-f0-9]{24})$/i.exec(url.pathname);
  if (request.method === "POST" && hook) {
    requireInternal(request);
    const token = requireToken(request, response);
    if (!token) return;
    const body = await readJson(request);
    await repositories.validateAndImportPush({
      projectId: hook[1],
      token,
      changes: body.changes,
    });
    return json(response, 200, { ok: true });
  }

  const object =
    /^\/api\/files\/([a-f0-9]{24})\/((?:[a-f0-9]{40}|[a-f0-9]{64}))\/(.+)$/i.exec(
      url.pathname,
    );
  if (request.method === "GET" && object) {
    const [, projectId, oid, encodedPath] = object;
    const pathname = decodeURIComponent(encodedPath);
    const { repo, expected } = await repositories.streamObject(
      projectId,
      oid,
      pathname,
      response,
    );
    if (!safeEqual(expected, url.searchParams.get("signature"))) {
      return json(response, 403, { error: "forbidden" });
    }
    if (!validOid(oid)) return json(response, 400, { error: "invalid_oid" });
    response.writeHead(200, { "content-type": "application/octet-stream" });
    const child = spawn("git", ["--git-dir", repo, "cat-file", "blob", oid], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(response);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (code !== 0) response.destroy(new Error("Git object is unavailable"));
    return;
  }

  const deletion = /^\/api\/projects\/([a-f0-9]{24})$/i.exec(url.pathname);
  if (request.method === "DELETE" && deletion) {
    requireInternal(request);
    await withProjectLock(deletion[1], async () => {
      await repositories.remove(deletion[1]);
    });
    return json(response, 200, { ok: true });
  }

  const gitRequest = parseGitPath(url.pathname);
  if (!gitRequest || !["GET", "POST"].includes(request.method)) {
    return json(response, 404, { error: "not_found" });
  }
  const token = requireToken(request, response);
  if (!token) return;

  const write = isWriteRequest(gitRequest.suffix, url);
  if (write && !withinPackLimit(request)) {
    const error = new Error("pack exceeds the configured size limit");
    error.statusCode = 413;
    throw error;
  }

  try {
    await webClient.authenticate(token);
    // Authorise the write *before* git-receive-pack runs, so a read-only
    // collaborator can never cause objects to be received or promoted.
    if (write) await webClient.authorizeWrite(gitRequest.projectId, token);
  } catch (error) {
    if ([401, 403].includes(error.statusCode)) {
      return unauthorized(response);
    }
    throw error;
  }

  await withGitConcurrencySlot(async () => {
    await withProjectLock(gitRequest.projectId, async () => {
      await repositories.syncOnlineState(gitRequest.projectId, token);
      await serveGitHttp({
        request,
        response,
        repoRoot: config.rootDir,
        projectId: gitRequest.projectId,
        suffix: gitRequest.suffix,
        token,
        config,
        maxBodyBytes: write ? config.maxPackSize : undefined,
      });
    });
  });
}

// A push is either the git-receive-pack POST or its info/refs advertisement.
function isWriteRequest(suffix, url) {
  if (suffix === "/git-receive-pack") return true;
  if (suffix === "/info/refs") {
    return url.searchParams.get("service") === "git-receive-pack";
  }
  return false;
}

function withinPackLimit(request) {
  const declared = Number.parseInt(request.headers["content-length"] || "", 10);
  if (Number.isInteger(declared) && declared > config.maxPackSize) return false;
  return true;
}

let activeGitRequests = 0;
const gitRequestQueue = [];
async function withGitConcurrencySlot(callback) {
  if (activeGitRequests >= config.maxConcurrentGitRequests) {
    await new Promise((resolve) => gitRequestQueue.push(resolve));
  }
  activeGitRequests += 1;
  try {
    return await callback();
  } finally {
    activeGitRequests -= 1;
    const next = gitRequestQueue.shift();
    if (next) next();
  }
}

export function parseGitPath(pathname) {
  const match =
    /^\/(?:git\/)?([a-f0-9]{24})(?:\.git)?(\/info\/refs|\/git-upload-pack|\/git-receive-pack)$/i.exec(
      pathname,
    );
  if (!match || !validProjectId(match[1])) return null;
  return { projectId: match[1], suffix: match[2] };
}

function requireToken(request, response) {
  const token = extractToken(request.headers.authorization);
  if (!token) {
    unauthorized(response);
    return null;
  }
  return token;
}

function requireInternal(request) {
  if (
    !safeEqual(
      request.headers["x-git-bridge-internal-secret"],
      config.internalSecret,
    )
  ) {
    const error = new Error("forbidden");
    error.statusCode = 403;
    throw error;
  }
}

function unauthorized(response) {
  response.setHeader("www-authenticate", 'Basic realm="Overleaf Git"');
  json(response, 401, { error: "invalid_token" });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, body) {
  if (response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
