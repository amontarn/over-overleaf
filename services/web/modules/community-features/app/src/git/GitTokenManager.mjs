import crypto from "node:crypto";
import { db } from "../../../../../app/src/infrastructure/mongodb.mjs";
import { derivedKeyHex } from "../security/DerivedSecrets.mjs";
import { GitAccessToken } from "./GitAccessToken.mjs";

const TOKEN_PREFIX = "olp_";
const DEFAULT_LIFETIME_DAYS = 365;

function hashToken(token) {
  return crypto
    .createHmac("sha256", derivedKeyHex("git-token-hmac"))
    .update(token)
    .digest("hex");
}

async function createToken({ userId, label }) {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(
    Date.now() + DEFAULT_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
  );
  const record = await GitAccessToken.create({
    userId,
    tokenHash: hashToken(token),
    prefix: token.slice(0, 12),
    label:
      typeof label === "string" && label.trim()
        ? label.trim().slice(0, 100)
        : "Git integration",
    expiresAt,
  });
  return { token, record: sanitize(record.toObject()) };
}

async function authenticate(token) {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  const now = new Date();
  const record = await GitAccessToken.findOne({
    tokenHash: hashToken(token),
    revokedAt: { $exists: false },
    expiresAt: { $gt: now },
  })
    .lean()
    .exec();
  if (!record) return null;
  // A valid token is not enough: the owning account must still exist and not
  // be suspended, otherwise suspension would not close the Git channel.
  const user = await db.users.findOne(
    { _id: record.userId },
    { projection: { _id: 1, suspended: 1 } },
  );
  if (!user || user.suspended === true) return null;
  await GitAccessToken.updateOne(
    { _id: record._id },
    { $set: { lastUsedAt: now } },
  ).exec();
  return record;
}

async function listTokens(userId) {
  const records = await GitAccessToken.find({ userId })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  return records.map(sanitize);
}

async function revokeToken({ userId, tokenId }) {
  const result = await GitAccessToken.updateOne(
    { _id: tokenId, userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  ).exec();
  if (result.matchedCount !== 1) throw new Error("Git token not found");
}

async function revokeAllForUser(userId) {
  await GitAccessToken.updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  ).exec();
}

function bearerToken(req) {
  const header = req.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  return match?.[1];
}

function sanitize(record) {
  const { tokenHash, ...safe } = record;
  return safe;
}

export default {
  authenticate,
  bearerToken,
  createToken,
  listTokens,
  revokeAllForUser,
  revokeToken,
  _mocks: { hashToken },
};
