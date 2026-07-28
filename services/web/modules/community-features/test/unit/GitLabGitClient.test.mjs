import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import Path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import GitLabGitClient from "../../app/src/gitlab/GitLabGitClient.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, args, env = {}) {
  return await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, ...env },
  });
}

test("clones a complete branch and pushes an Overleaf commit", async () => {
  const root = await fsp.mkdtemp(Path.join(os.tmpdir(), "gitlab-client-test-"));
  try {
    const remote = Path.join(root, "remote.git");
    const seed = Path.join(root, "seed");
    const clone = Path.join(root, "clone");
    await git(root, ["init", "--bare", "--initial-branch=master", remote]);
    await git(root, ["init", "--initial-branch=master", seed]);
    await fsp.writeFile(Path.join(seed, "main.tex"), "version one\n");
    await git(seed, ["add", "main.tex"]);
    await git(seed, ["commit", "-m", "initial"], {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    });
    await git(seed, ["remote", "add", "origin", `file://${remote}`]);
    await git(seed, ["push", "origin", "master"]);

    const credentials = await GitLabGitClient.clone({
      remoteUrl: `file://${remote}`,
      branch: "master",
      username: "oauth2",
      token: "",
      destination: clone,
      tempDir: root,
    });
    const initialCommit = await GitLabGitClient.revParse(clone);
    await fsp.writeFile(Path.join(clone, "main.tex"), "version two\n");
    assert.equal(await GitLabGitClient.hasChanges(clone), true);
    const pushedCommit = await GitLabGitClient.commit(clone, {
      name: "Overleaf User",
      email: "user@example.com",
      message: "Synchronisation depuis Overleaf",
    });
    await GitLabGitClient.push(clone, "master", credentials);

    assert.notEqual(pushedCommit, initialCommit);
    const { stdout } = await git(remote, ["rev-parse", "refs/heads/master"]);
    assert.equal(stdout.trim(), pushedCommit);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("redacts an access token from Git failures", async () => {
  const root = await fsp.mkdtemp(Path.join(os.tmpdir(), "gitlab-redact-test-"));
  const previousPath = process.env.PATH;
  try {
    const fakeBin = Path.join(root, "bin");
    await fsp.mkdir(fakeBin);
    await fsp.writeFile(
      Path.join(fakeBin, "git"),
      '#!/bin/sh\nprintf "%s\\n" "$OVERLEAF_REMOTE_GIT_TOKEN" >&2\nexit 1\n',
      { mode: 0o700 },
    );
    process.env.PATH = `${fakeBin}:${previousPath}`;
    await assert.rejects(
      GitLabGitClient.clone({
        remoteUrl: "https://gitlab.example.com/group/project.git",
        branch: "master",
        username: "oauth2",
        token: "glpat-secret-value",
        destination: Path.join(root, "clone"),
        tempDir: root,
      }),
      (error) => {
        assert.equal(error.message.includes("glpat-secret-value"), false);
        assert.equal(error.message.includes("[REDACTED]"), true);
        return true;
      },
    );
  } finally {
    process.env.PATH = previousPath;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
