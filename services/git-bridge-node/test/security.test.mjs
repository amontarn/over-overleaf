import assert from "node:assert/strict";
import test from "node:test";
import { extractToken, validatePath, validOid } from "../src/security.mjs";

test("extracts a personal token from Git basic authentication", () => {
  const value = Buffer.from("git:olp_secret").toString("base64");
  assert.equal(extractToken(`Basic ${value}`), "olp_secret");
});

test("extracts a bearer token", () => {
  assert.equal(extractToken("Bearer olp_secret"), "olp_secret");
});

test("rejects unsafe paths", () => {
  for (const pathname of ["/main.tex", "../main.tex", "a/../b", "a\\b"]) {
    assert.throws(() => validatePath(pathname));
  }
  assert.equal(validatePath("chapters/one.tex"), "chapters/one.tex");
});

test("accepts only complete SHA-1 or SHA-256 object identifiers", () => {
  assert.equal(validOid("a".repeat(40)), true);
  assert.equal(validOid("b".repeat(64)), true);
  assert.equal(validOid("c".repeat(41)), false);
  assert.equal(validOid("z".repeat(40)), false);
});
