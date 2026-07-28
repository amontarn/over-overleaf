import assert from "node:assert/strict";
import test from "node:test";
import { validateBranch } from "../../app/src/git/GitPolicy.mjs";
import RemoteUrlPolicy from "../../app/src/security/RemoteUrlPolicy.mjs";

test("accepts a valid single GitLab branch name", () => {
  assert.equal(validateBranch("article/main"), "article/main");
});

test("rejects branch names that can be parsed as command options", () => {
  assert.throws(() => validateBranch("--upload-pack=evil"), /invalid/);
});

test("rejects non-HTTPS remotes and credentials embedded in URLs", async () => {
  await assert.rejects(
    RemoteUrlPolicy.validate("http://gitlab.example.com/group/project.git"),
    /only HTTPS/,
  );
  await assert.rejects(
    RemoteUrlPolicy.validate(
      "https://oauth2:secret@gitlab.example.com/group/project.git",
    ),
    /must not be embedded/,
  );
});

test("allows HTTP only for explicitly enabled private AI-style remotes", async () => {
  await assert.rejects(
    RemoteUrlPolicy.validate("http://localhost:11434/v1", {
      allowPrivateHosts: true,
    }),
    /only HTTPS/,
  );
  await assert.rejects(
    RemoteUrlPolicy.validate("http://localhost:11434/v1", {
      allowInsecureHttp: true,
    }),
    /require private hosts/,
  );
  const url = await RemoteUrlPolicy.validate("http://localhost:11434/v1", {
    allowPrivateHosts: true,
    allowInsecureHttp: true,
  });
  assert.equal(url.toString(), "http://localhost:11434/v1");
});

test("does not allow insecure HTTP to a public IP address", async () => {
  await assert.rejects(
    RemoteUrlPolicy.validate("http://8.8.8.8/v1", {
      allowPrivateHosts: true,
      allowInsecureHttp: true,
    }),
    /only allowed for private hosts/,
  );
});
