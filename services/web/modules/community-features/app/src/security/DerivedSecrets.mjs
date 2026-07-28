import crypto from "node:crypto";
import Settings from "@overleaf/settings";

// The community features share a single configured master secret
// (OVERLEAF_EXTENSIONS_SECRET). Using it verbatim for every purpose means a
// leak of one derived value (e.g. a signing key exposed in a URL) would
// compromise the others. Instead we derive an independent, purpose-bound key
// per use with HKDF, so the derived keys cannot be used to recover the master
// or any sibling key.

function masterSecret() {
  const secret = Settings.communityFeatures?.encryptionSecret;
  if (!secret || secret.length < 16) {
    throw new Error(
      "OVERLEAF_EXTENSIONS_SECRET must contain at least 16 characters",
    );
  }
  return secret;
}

const cache = new Map();

// Returns a 32-byte key for `purpose`, hex-encoded so it can be used directly
// as an HMAC key. Memoised because the master secret is stable per process.
export function derivedKeyHex(purpose) {
  const cached = cache.get(purpose);
  if (cached) return cached;
  const key = crypto.hkdfSync(
    "sha256",
    masterSecret(),
    Buffer.alloc(0),
    `overleaf-community:${purpose}`,
    32,
  );
  const hex = Buffer.from(key).toString("hex");
  cache.set(purpose, hex);
  return hex;
}

export default { derivedKeyHex };
