import assert from "node:assert/strict";
import test from "node:test";
import { applyCgiHeaders } from "../src/smart-http.mjs";

test("maps CGI headers and status to the HTTP response", () => {
  const headers = new Map();
  const response = {
    statusCode: 0,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
  };
  applyCgiHeaders(
    response,
    "Status: 403 Forbidden\r\nContent-Type: application/x-git-error",
  );
  assert.equal(response.statusCode, 403);
  assert.equal(headers.get("content-type"), "application/x-git-error");
});
