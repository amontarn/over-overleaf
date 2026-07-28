import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

export async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  const maxBuffer = options.maxBuffer || DEFAULT_MAX_BUFFER;
  let bufferedBytes = 0;
  let executionError;
  const collect = (target) => (chunk) => {
    bufferedBytes += chunk.length;
    if (bufferedBytes > maxBuffer) {
      executionError ||= new Error(
        `${command} exceeded the ${maxBuffer}-byte output limit`,
      );
      child.kill("SIGKILL");
      return;
    }
    target.push(chunk);
  };
  child.stdout.on("data", collect(stdout));
  child.stderr.on("data", collect(stderr));
  if (options.input !== undefined) child.stdin.end(options.input);
  else child.stdin.end();
  const timeout = setTimeout(() => {
    executionError ||= new Error(`${command} timed out`);
    child.kill("SIGKILL");
  }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  timeout.unref();
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
  }
  if (executionError) throw executionError;
  const result = {
    code,
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
  if (code !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${code}): ${result.stderr.trim()}`,
    );
  }
  return result;
}

export async function git(repo, args, options = {}) {
  return await run("git", ["--git-dir", repo, ...args], options);
}
