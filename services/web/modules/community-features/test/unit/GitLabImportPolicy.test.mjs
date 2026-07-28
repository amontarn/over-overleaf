import assert from "node:assert/strict";
import test from "node:test";
import { validateProjectName } from "../../app/src/gitlab/GitLabImportPolicy.mjs";

test("normalizes a GitLab project name", () => {
  assert.equal(validateProjectName("  Research paper  "), "Research paper");
});

test("rejects an empty GitLab project name", () => {
  assert.throws(() => validateProjectName("   "), /invalid project name/);
});

test("rejects control characters in a GitLab project name", () => {
  assert.throws(
    () => validateProjectName("paper\nother"),
    /invalid project name/,
  );
});
