import { execFile, spawn } from "node:child_process";
import fsp from "node:fs/promises";
import Path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
// Default ceiling on the on-disk size of a clone, enforced live so a huge
// remote repository cannot exhaust the disk before per-file limits apply.
const DEFAULT_MAX_CLONE_BYTES = 100 * 1024 * 1024;
const SIZE_POLL_INTERVAL_MS = 1000;

async function createAskPass(baseDir) {
  const pathname = Path.join(baseDir, "askpass.sh");
  await fsp.writeFile(
    pathname,
    '#!/bin/sh\ncase "$1" in\n  *sername*) printf "%s\\n" "$OVERLEAF_REMOTE_GIT_USERNAME" ;;\n  *) printf "%s\\n" "$OVERLEAF_REMOTE_GIT_TOKEN" ;;\nesac\n',
    { mode: 0o700 },
  );
  return pathname;
}

async function run(args, { cwd, credentials, env = {} } = {}) {
  const askPass = credentials?.askPass;
  const processEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    ...(askPass
      ? {
          GIT_ASKPASS: askPass,
          OVERLEAF_REMOTE_GIT_USERNAME: credentials.username,
          OVERLEAF_REMOTE_GIT_TOKEN: credentials.token,
        }
      : {}),
    ...env,
  };
  try {
    return await execFileAsync(
      "git",
      ["-c", "credential.helper=", "-c", "http.followRedirects=false", ...args],
      {
        cwd,
        env: processEnv,
        timeout: credentials?.timeoutMs || DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
  } catch (error) {
    const token = credentials?.token;
    const detail = [error.stderr, error.stdout, error.message]
      .filter(Boolean)
      .join("\n")
      .replaceAll(token || "__no_token__", "[REDACTED]")
      .trim();
    throw new Error(`GitLab Git operation failed: ${detail.slice(0, 2000)}`);
  }
}

async function clone({
  remoteUrl,
  branch,
  username,
  token,
  destination,
  tempDir,
  timeoutMs,
  maxBytes = DEFAULT_MAX_CLONE_BYTES,
}) {
  const askPass = await createAskPass(tempDir);
  const credentials = { askPass, username, token, timeoutMs };
  await runClone(
    [
      // Shallow, single-branch, no tags: fetch only the tip of the branch so
      // arbitrarily long remote history cannot be pulled. The .git directory
      // is discarded after checkout, so no history is needed downstream.
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      branch,
      "--no-tags",
      "--",
      remoteUrl,
      destination,
    ],
    { credentials, destination, maxBytes },
  );
  return credentials;
}

// Runs git clone under a live size monitor, killing the process if the
// destination grows past maxBytes.
async function runClone(args, { credentials, destination, maxBytes }) {
  const askPass = credentials?.askPass;
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    ...(askPass
      ? {
          GIT_ASKPASS: askPass,
          OVERLEAF_REMOTE_GIT_USERNAME: credentials.username,
          OVERLEAF_REMOTE_GIT_TOKEN: credentials.token,
        }
      : {}),
  };
  const child = spawn(
    "git",
    ["-c", "credential.helper=", "-c", "http.followRedirects=false", ...args],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024);
  });
  child.stdout.resume();

  let overSize = false;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, credentials?.timeoutMs || DEFAULT_TIMEOUT_MS);
  const monitor = setInterval(async () => {
    try {
      if ((await directorySize(destination)) > maxBytes) {
        overSize = true;
        child.kill("SIGKILL");
      }
    } catch {
      // destination not created yet; keep polling
    }
  }, SIZE_POLL_INTERVAL_MS);

  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (overSize) {
      throw new Error(
        `GitLab repository exceeds the ${maxBytes}-byte import limit`,
      );
    }
    if (timedOut) throw new Error("GitLab clone timed out");
    if (code !== 0) {
      const detail = stderr
        .replaceAll(credentials?.token || "__no_token__", "[REDACTED]")
        .trim();
      throw new Error(`GitLab Git operation failed: ${detail.slice(0, 2000)}`);
    }
  } finally {
    clearTimeout(timeout);
    clearInterval(monitor);
  }
}

async function directorySize(dir) {
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = Path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(full);
    } else if (entry.isFile()) {
      total += (await fsp.stat(full)).size;
    }
    if (total > Number.MAX_SAFE_INTEGER) break;
  }
  return total;
}

async function revParse(repo, ref = "HEAD") {
  const { stdout } = await run(["rev-parse", "--verify", ref], { cwd: repo });
  return stdout.trim();
}

async function hasChanges(repo) {
  const { stdout } = await run(["status", "--porcelain"], { cwd: repo });
  return stdout.length > 0;
}

async function commit(repo, { name, email, message }) {
  await run(["add", "--all"], { cwd: repo });
  await run(["commit", "--message", message], {
    cwd: repo,
    env: {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
    },
  });
  return await revParse(repo);
}

async function push(repo, branch, credentials) {
  await run(["push", "origin", `HEAD:${branch}`], { cwd: repo, credentials });
}

export default { clone, revParse, hasChanges, commit, push };
