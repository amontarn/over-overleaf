import assert from "node:assert/strict";
import test from "node:test";
import {
  nextConsentVersion,
  providerHasChanged,
  publicProviderOrigin,
} from "../../app/src/ai/AiConsentPolicy.mjs";

test("exposes only the provider origin to the consent dialog", () => {
  assert.equal(
    publicProviderOrigin("https://ai.example.test:8443/v1/private/path"),
    "https://ai.example.test:8443",
  );
});

test("invalidates consent only when the destination server changes", () => {
  assert.equal(
    providerHasChanged(
      "https://ai.example.test/v1",
      "https://ai.example.test/openai/v1",
    ),
    false,
  );
  assert.equal(
    providerHasChanged(
      "https://ai.example.test/v1",
      "https://other.example.test/v1",
    ),
    true,
  );
});

test("increments numeric consent versions", () => {
  assert.equal(nextConsentVersion("4"), "5");
});
