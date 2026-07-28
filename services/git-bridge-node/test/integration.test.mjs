import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import Path from "node:path";
import test from "node:test";
import { run } from "../src/process.mjs";

const PROJECT_ID = "0123456789abcdef01234567";
const TOKEN = "olp_integration_test";

test("clone, fast-forward push, wrong branch and divergence", async (t) => {
  const temporary = await fs.mkdtemp(
    Path.join(os.tmpdir(), "node-git-bridge-"),
  );
  const webState = {
    version: 1,
    files: new Map([["main.tex", "Version one\n"]]),
  };
  const web = await mockWeb(webState);
  const bridgePort = await freePort();
  const bridge = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      GIT_BRIDGE_PORT: String(bridgePort),
      GIT_BRIDGE_ROOT_DIR: Path.join(temporary, "repositories"),
      GIT_BRIDGE_WEB_URL: `http://127.0.0.1:${web.port}`,
      GIT_BRIDGE_PUBLIC_URL: `http://127.0.0.1:${bridgePort}`,
      GIT_BRIDGE_INTERNAL_URL: `http://127.0.0.1:${bridgePort}`,
      GIT_BRIDGE_INTERNAL_SECRET: "integration-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  bridge.stdout.on("data", (chunk) => logs.push(chunk));
  bridge.stderr.on("data", (chunk) => logs.push(chunk));
  t.after(async () => {
    bridge.kill("SIGTERM");
    web.server.close();
    await fs.rm(temporary, { recursive: true, force: true });
  });
  await waitForHealth(bridgePort, bridge, logs);

  const clone = Path.join(temporary, "clone");
  const remote = `http://git:${TOKEN}@127.0.0.1:${bridgePort}/${PROJECT_ID}`;
  await run("git", ["clone", remote, clone]);
  assert.equal(
    await fs.readFile(Path.join(clone, "main.tex"), "utf8"),
    "Version one\n",
  );

  await run("git", ["config", "user.name", "Integration User"], { cwd: clone });
  await run("git", ["config", "user.email", "integration@example.test"], {
    cwd: clone,
  });
  await fs.writeFile(Path.join(clone, "main.tex"), "From Git\n");
  await run("git", ["add", "main.tex"], { cwd: clone });
  await run("git", ["commit", "-m", "Fast forward update"], { cwd: clone });
  await run("git", ["push", "origin", "master"], { cwd: clone });
  assert.equal(webState.files.get("main.tex"), "From Git\n");

  await run("git", ["switch", "-c", "feature"], { cwd: clone });
  await fs.writeFile(Path.join(clone, "feature.tex"), "Feature\n");
  await run("git", ["add", "feature.tex"], { cwd: clone });
  await run("git", ["commit", "-m", "Wrong branch"], { cwd: clone });
  const wrongBranch = await run("git", ["push", "origin", "feature"], {
    cwd: clone,
    allowFailure: true,
  });
  assert.notEqual(wrongBranch.code, 0);

  await run("git", ["switch", "master"], { cwd: clone });
  webState.version += 1;
  webState.files.set("main.tex", "Online edit\n");
  await fs.writeFile(Path.join(clone, "main.tex"), "Stale local edit\n");
  await run("git", ["add", "main.tex"], { cwd: clone });
  await run("git", ["commit", "-m", "Stale update"], { cwd: clone });
  const stale = await run("git", ["push", "origin", "master"], {
    cwd: clone,
    allowFailure: true,
  });
  assert.notEqual(stale.code, 0);
  assert.equal(webState.files.get("main.tex"), "Online edit\n");
});

test("a read-only collaborator cannot push", async (t) => {
  const temporary = await fs.mkdtemp(
    Path.join(os.tmpdir(), "node-git-bridge-ro-"),
  );
  const webState = {
    version: 1,
    files: new Map([["main.tex", "Version one\n"]]),
    canWrite: false,
  };
  const web = await mockWeb(webState);
  const bridgePort = await freePort();
  const bridge = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      GIT_BRIDGE_PORT: String(bridgePort),
      GIT_BRIDGE_ROOT_DIR: Path.join(temporary, "repositories"),
      GIT_BRIDGE_WEB_URL: `http://127.0.0.1:${web.port}`,
      GIT_BRIDGE_PUBLIC_URL: `http://127.0.0.1:${bridgePort}`,
      GIT_BRIDGE_INTERNAL_URL: `http://127.0.0.1:${bridgePort}`,
      GIT_BRIDGE_INTERNAL_SECRET: "integration-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  bridge.stdout.on("data", (chunk) => logs.push(chunk));
  bridge.stderr.on("data", (chunk) => logs.push(chunk));
  t.after(async () => {
    bridge.kill("SIGTERM");
    web.server.close();
    await fs.rm(temporary, { recursive: true, force: true });
  });
  await waitForHealth(bridgePort, bridge, logs);

  const clone = Path.join(temporary, "clone");
  const remote = `http://git:${TOKEN}@127.0.0.1:${bridgePort}/${PROJECT_ID}`;
  // Reading (clone) is still allowed for a reader.
  await run("git", ["clone", remote, clone]);
  const objectsDir = Path.join(
    temporary,
    "repositories",
    `${PROJECT_ID}.git`,
    "objects",
  );
  // Objects created by the baseline sync are legitimate; the rejected push
  // must not add any beyond these.
  const baselineObjects = await countLooseObjects(objectsDir);
  await run("git", ["config", "user.name", "Reader"], { cwd: clone });
  await run("git", ["config", "user.email", "reader@example.test"], {
    cwd: clone,
  });
  await fs.writeFile(Path.join(clone, "main.tex"), "Reader edit\n");
  await run("git", ["add", "main.tex"], { cwd: clone });
  await run("git", ["commit", "-m", "Reader push attempt"], { cwd: clone });
  const push = await run("git", ["push", "origin", "master"], {
    cwd: clone,
    allowFailure: true,
  });
  assert.notEqual(push.code, 0);
  // The pack must be rejected before it can touch the online project.
  assert.equal(webState.files.get("main.tex"), "Version one\n");

  const loose = await countLooseObjects(objectsDir);
  assert.equal(
    loose,
    baselineObjects,
    "no objects should be promoted for a rejected push",
  );
});

async function countLooseObjects(objectsDir) {
  let total = 0;
  let shards;
  try {
    shards = await fs.readdir(objectsDir);
  } catch {
    return 0;
  }
  for (const shard of shards) {
    if (!/^[0-9a-f]{2}$/.test(shard)) continue;
    const entries = await fs.readdir(Path.join(objectsDir, shard));
    total += entries.length;
  }
  return total;
}

async function mockWeb(state) {
  const server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(response, 401, { error: "invalid_token" });
    }
    const url = new URL(request.url, "http://web.local");
    if (request.method === "GET" && url.pathname === "/oauth/token/info") {
      return send(response, 200, { active: true, user_id: "user" });
    }
    if (
      request.method === "GET" &&
      url.pathname === `/api/v0/docs/${PROJECT_ID}/authorize`
    ) {
      if (url.searchParams.get("access") === "write" && state.canWrite === false) {
        return send(response, 403, { code: "forbidden" });
      }
      return send(response, 200, { ok: true });
    }
    if (
      request.method === "GET" &&
      url.pathname === `/api/v0/docs/${PROJECT_ID}`
    ) {
      return send(response, 200, {
        latestVerId: state.version,
        latestVerAt: new Date().toISOString(),
        latestVerBy: { name: "Online User", email: "online@example.test" },
      });
    }
    if (
      request.method === "GET" &&
      url.pathname === `/api/v0/docs/${PROJECT_ID}/snapshots/${state.version}`
    ) {
      return send(response, 200, {
        srcs: [...state.files].map(([name, content]) => [content, name]),
        atts: [],
      });
    }
    if (
      request.method === "POST" &&
      url.pathname === `/api/v0/docs/${PROJECT_ID}/snapshots`
    ) {
      const body = await jsonBody(request);
      if (body.latestVerId !== state.version) {
        return send(response, 200, { code: "outOfDate" });
      }
      const next = new Map();
      for (const file of body.files) {
        next.set(
          file.name,
          file.url
            ? await fetch(file.url).then((result) => result.text())
            : state.files.get(file.name),
        );
      }
      state.files = next;
      state.version += 1;
      return send(response, 200, {
        code: "upToDate",
        latestVerId: state.version,
      });
    }
    send(response, 404, { error: "not_found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(port, child, logs) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(Buffer.concat(logs).toString("utf8"));
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health_check`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Git Bridge did not start: ${Buffer.concat(logs)}`);
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
