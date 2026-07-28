#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import Path from "node:path";

const input = await readStdin();
const changes = input
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [oldOid, newOid, ref] = line.trim().split(/\s+/);
    return { oldOid, newOid, ref };
  });

try {
  validateChanges(changes);
  await promoteQuarantinedObjects();
  const response = await fetch(
    `${process.env.GIT_BRIDGE_HOOK_URL}/internal/pre-receive/${process.env.GIT_BRIDGE_PROJECT_ID}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.GIT_BRIDGE_TOKEN}`,
        "content-type": "application/json",
        "x-git-bridge-internal-secret": process.env.GIT_BRIDGE_INTERNAL_SECRET,
      },
      body: JSON.stringify({ changes }),
      signal: AbortSignal.timeout(10 * 60_000),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.message || `bridge returned ${response.status}`);
} catch (error) {
  process.stderr.write(`Git push rejected: ${error.message}\n`);
  process.exitCode = 1;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function validateChanges(changes) {
  const branch = process.env.GIT_BRIDGE_BRANCH || "master";
  if (
    changes.length !== 1 ||
    changes[0].ref !== `refs/heads/${branch}` ||
    /^0+$/.test(changes[0].newOid)
  ) {
    throw new Error(`only fast-forward updates to ${branch} are allowed`);
  }
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", changes[0].oldOid, changes[0].newOid],
    { stdio: "ignore" },
  );
  if (result.status !== 0) {
    throw new Error("non-fast-forward push rejected; fetch and merge first");
  }
}

async function promoteQuarantinedObjects() {
  const source = process.env.GIT_OBJECT_DIRECTORY;
  const alternates = (process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES || "")
    .split(Path.delimiter)
    .filter(Boolean);
  const target = alternates.find(
    (candidate) => Path.basename(candidate) === "objects",
  );
  if (!source || !target || Path.resolve(source) === Path.resolve(target))
    return;
  await fs.cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
}
