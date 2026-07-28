import crypto from "node:crypto";
import fs from "node:fs/promises";
import Path from "node:path";
import { git, run } from "./process.mjs";
import { signature, validatePath, validOid } from "./security.mjs";

const ZERO_OID = /^0+$/;

export class RepositoryManager {
  constructor(config, webClient) {
    this.config = config;
    this.webClient = webClient;
  }

  path(projectId) {
    return Path.join(this.config.rootDir, `${projectId}.git`);
  }

  async ensure(projectId) {
    const repo = this.path(projectId);
    try {
      await fs.access(Path.join(repo, "HEAD"));
    } catch {
      await fs.mkdir(this.config.rootDir, { recursive: true, mode: 0o700 });
      await run("git", [
        "init",
        "--bare",
        `--initial-branch=${this.config.branch}`,
        repo,
      ]);
      await git(repo, ["config", "http.receivepack", "true"]);
      await git(repo, ["config", "receive.denyNonFastForwards", "true"]);
      await this.#installHook(repo);
    }
    return repo;
  }

  async syncOnlineState(projectId, token) {
    const repo = await this.ensure(projectId);
    const description = await this.webClient.describe(projectId, token);
    const onlineVersion = Number.parseInt(description.latestVerId, 10);
    if (!Number.isInteger(onlineVersion) || onlineVersion < 0) {
      throw new Error("web API returned an invalid project version");
    }
    const stored = await this.#version(repo);
    if (stored === onlineVersion) return { repo, version: onlineVersion };

    const snapshot = await this.webClient.snapshot(
      projectId,
      onlineVersion,
      token,
    );
    const entries = await this.#snapshotEntries(repo, snapshot);
    const tree = await this.#writeTree(repo, entries);
    const oldTip = await this.tip(repo);
    const author = description.latestVerBy || {};
    const commit = await git(
      repo,
      ["commit-tree", tree, ...(oldTip ? ["-p", oldTip] : [])],
      {
        input: `Overleaf sync — version ${onlineVersion}\n`,
        env: {
          GIT_AUTHOR_NAME: author.name || "Overleaf user",
          GIT_AUTHOR_EMAIL: author.email || "git@overleaf.local",
          GIT_COMMITTER_NAME: "Overleaf Git Bridge",
          GIT_COMMITTER_EMAIL: "git-bridge@overleaf.local",
          ...(description.latestVerAt
            ? {
                GIT_AUTHOR_DATE: description.latestVerAt,
                GIT_COMMITTER_DATE: description.latestVerAt,
              }
            : {}),
        },
      },
    );
    const oid = commit.stdout.toString("utf8").trim();
    await git(repo, [
      "update-ref",
      `refs/heads/${this.config.branch}`,
      oid,
      oldTip || "0".repeat(40),
    ]);
    await git(repo, ["config", "overleaf.version", String(onlineVersion)]);
    return { repo, version: onlineVersion };
  }

  async validateAndImportPush(args) {
    const repo = this.path(args.projectId);
    try {
      return await this.#validateAndImportPush(args);
    } catch (error) {
      // A rejected push leaves the objects promoted out of quarantine but
      // unreferenced by any branch. Prune them so a read-only or oversized
      // push cannot permanently grow storage. Safe under the per-project lock.
      await this.pruneUnreferenced(repo);
      throw error;
    }
  }

  async pruneUnreferenced(repo) {
    await git(repo, ["prune", "--expire=now"], { allowFailure: true });
  }

  async #validateAndImportPush({ projectId, token, changes }) {
    const repo = this.path(projectId);
    if (!Array.isArray(changes) || changes.length !== 1) {
      throw userError("exactly one branch update is required");
    }
    const { oldOid, newOid, ref } = changes[0];
    if (ref !== `refs/heads/${this.config.branch}`) {
      throw userError(`only branch ${this.config.branch} can be pushed`);
    }
    if (!validOid(oldOid) || !validOid(newOid) || ZERO_OID.test(newOid)) {
      throw userError("branch creation and deletion are forbidden");
    }
    const tip = await this.tip(repo);
    if (tip !== oldOid) throw userError("remote project changed; fetch first");
    const ancestor = await git(
      repo,
      ["merge-base", "--is-ancestor", oldOid, newOid],
      {
        allowFailure: true,
      },
    );
    if (ancestor.code !== 0) {
      throw userError("non-fast-forward push rejected; fetch and merge first");
    }

    const latestVerId = await this.#version(repo);
    if (!Number.isInteger(latestVerId)) {
      throw new Error("repository has no Overleaf version marker");
    }
    const [oldFiles, newFiles] = await Promise.all([
      this.#tree(repo, oldOid),
      this.#tree(repo, newOid),
    ]);
    if (newFiles.size > this.config.maxFiles) {
      throw userError(`project exceeds ${this.config.maxFiles} files`);
    }
    let totalSize = 0;
    const files = [];
    for (const [name, oid] of newFiles) {
      const sizeResult = await git(repo, ["cat-file", "-s", oid]);
      const size = Number.parseInt(sizeResult.stdout.toString("utf8"), 10);
      if (size > this.config.maxFileSize) {
        throw userError(`file too large: ${name}`);
      }
      totalSize += size;
      if (totalSize > this.config.maxProjectSize) {
        throw userError("project exceeds the configured size limit");
      }
      const entry = { name };
      if (oldFiles.get(name) !== oid) {
        const sig = signature(this.config.internalSecret, projectId, oid, name);
        entry.url = `${this.config.internalBaseUrl}/api/files/${projectId}/${oid}/${encodeURIComponent(name)}?signature=${sig}`;
      }
      files.push(entry);
    }

    const result = await this.webClient.importSnapshot(projectId, token, {
      latestVerId,
      files,
    });
    if (!["accepted", "upToDate"].includes(result.code)) {
      if (result.code === "outOfDate") {
        throw userError("online project changed; fetch and merge first");
      }
      throw new Error(`unexpected import result: ${result.code}`);
    }
    const version = Number.parseInt(result.latestVerId, 10);
    if (Number.isInteger(version)) {
      await git(repo, ["config", "overleaf.version", String(version)]);
    }
    // Let git repack loose objects once thresholds are reached; cheap no-op
    // otherwise. Runs under the per-project lock so it cannot race a push.
    await git(repo, ["gc", "--auto", "--quiet"], { allowFailure: true });
  }

  async streamObject(projectId, oid, pathname, response) {
    validatePath(pathname);
    const expected = signature(
      this.config.internalSecret,
      projectId,
      oid,
      pathname,
    );
    return { repo: this.path(projectId), expected };
  }

  async tip(repo) {
    const result = await git(
      repo,
      ["rev-parse", "--verify", `refs/heads/${this.config.branch}`],
      { allowFailure: true },
    );
    return result.code === 0 ? result.stdout.toString("utf8").trim() : null;
  }

  async remove(projectId) {
    await fs.rm(this.path(projectId), { recursive: true, force: true });
  }

  async #version(repo) {
    const result = await git(repo, ["config", "--get", "overleaf.version"], {
      allowFailure: true,
    });
    if (result.code !== 0) return null;
    const value = Number.parseInt(result.stdout.toString("utf8"), 10);
    return Number.isInteger(value) ? value : null;
  }

  async #snapshotEntries(repo, snapshot) {
    const all = [
      ...(Array.isArray(snapshot.srcs)
        ? snapshot.srcs.map(([content, name]) => ({ name, content }))
        : []),
      ...(Array.isArray(snapshot.atts)
        ? snapshot.atts.map(([url, name]) => ({ name, url }))
        : []),
    ];
    if (all.length > this.config.maxFiles) {
      throw new Error("snapshot exceeds the file limit");
    }
    const names = new Set();
    const entries = [];
    let totalSize = 0;
    for (const item of all) {
      const name = validatePath(item.name);
      if (names.has(name)) throw new Error("snapshot contains duplicate paths");
      names.add(name);
      let content;
      if (typeof item.content === "string") {
        content = Buffer.from(item.content);
      } else {
        const response = await fetch(item.url, {
          redirect: "error",
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
        if (!response.ok)
          throw new Error(`blob fetch failed (${response.status})`);
        content = Buffer.from(await response.arrayBuffer());
      }
      if (content.length > this.config.maxFileSize) {
        throw new Error(`snapshot file too large: ${name}`);
      }
      totalSize += content.length;
      if (totalSize > this.config.maxProjectSize) {
        throw new Error("snapshot exceeds the project size limit");
      }
      const result = await git(repo, ["hash-object", "-w", "--stdin"], {
        input: content,
      });
      entries.push({ name, oid: result.stdout.toString("utf8").trim() });
    }
    return entries;
  }

  async #writeTree(repo, entries) {
    const index = Path.join(
      this.config.rootDir,
      `.index-${process.pid}-${crypto.randomUUID()}`,
    );
    try {
      await git(repo, ["read-tree", "--empty"], {
        env: { GIT_INDEX_FILE: index },
      });
      const input = entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ oid, name }) => `100644 ${oid}\t${name}\n`)
        .join("");
      if (input) {
        await git(repo, ["update-index", "--index-info"], {
          input,
          env: { GIT_INDEX_FILE: index },
        });
      }
      const result = await git(repo, ["write-tree"], {
        env: { GIT_INDEX_FILE: index },
      });
      return result.stdout.toString("utf8").trim();
    } finally {
      await fs.rm(index, { force: true });
    }
  }

  async #tree(repo, oid) {
    const result = await git(repo, ["ls-tree", "-r", "-z", oid]);
    const files = new Map();
    for (const record of result.stdout.toString("utf8").split("\0")) {
      if (!record) continue;
      const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
      if (!match || match[2] !== "blob") throw userError("invalid Git tree");
      files.set(validatePath(match[4]), match[3]);
    }
    return files;
  }

  async #installHook(repo) {
    const source = new URL("./pre-receive.mjs", import.meta.url);
    const destination = Path.join(repo, "hooks", "pre-receive");
    await fs.copyFile(source, destination);
    await fs.chmod(destination, 0o700);
  }
}

function userError(message) {
  const error = new Error(message);
  error.userError = true;
  return error;
}

export { ZERO_OID };
