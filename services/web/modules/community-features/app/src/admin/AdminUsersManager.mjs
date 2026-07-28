import Settings from "@overleaf/settings";
import logger from "@overleaf/logger";
import {
  ObjectId,
  db,
} from "../../../../../app/src/infrastructure/mongodb.mjs";
import UserRegistrationHandler from "../../../../../app/src/Features/User/UserRegistrationHandler.mjs";
import UserUpdater from "../../../../../app/src/Features/User/UserUpdater.mjs";
import UserDeleter from "../../../../../app/src/Features/User/UserDeleter.mjs";
import UserSessionsManager from "../../../../../app/src/Features/User/UserSessionsManager.mjs";
import UserAuditLogHandler from "../../../../../app/src/Features/User/UserAuditLogHandler.mjs";
import OwnershipTransferHandler from "../../../../../app/src/Features/Collaborators/OwnershipTransferHandler.mjs";
import EmailHelper from "../../../../../app/src/Features/Helpers/EmailHelper.mjs";
import GitTokenManager from "../git/GitTokenManager.mjs";
import GitLabSyncManager from "../gitlab/GitLabSyncManager.mjs";
import AiManager from "../ai/AiManager.mjs";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function normalizeObjectId(value, fieldName = "user id") {
  if (!ObjectId.isValid(value)) {
    throw new Error(`invalid ${fieldName}`);
  }
  return new ObjectId(value);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listUsers({ query = "", page = 1, pageSize } = {}) {
  page = Math.max(1, Number.parseInt(page, 10) || 1);
  pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE),
  );
  query = typeof query === "string" ? query.trim().slice(0, 254) : "";

  const filter = {};
  if (query) {
    if (ObjectId.isValid(query)) {
      filter.$or = [
        { _id: new ObjectId(query) },
        { email: query.toLowerCase() },
      ];
    } else {
      const pattern = new RegExp(escapeRegex(query), "i");
      filter.$or = [
        { email: pattern },
        { first_name: pattern },
        { last_name: pattern },
      ];
    }
  }

  const [total, users] = await Promise.all([
    db.users.countDocuments(filter),
    db.users
      .find(filter, {
        projection: {
          email: 1,
          first_name: 1,
          last_name: 1,
          isAdmin: 1,
          suspended: 1,
          signUpDate: 1,
          lastLoggedIn: 1,
        },
      })
      .sort({ signUpDate: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  ]);

  const userIds = users.map((user) => user._id);
  const projectCounts = userIds.length
    ? await db.projects
        .aggregate([
          { $match: { owner_ref: { $in: userIds } } },
          { $group: { _id: "$owner_ref", count: { $sum: 1 } } },
        ])
        .toArray()
    : [];
  const countsByUser = new Map(
    projectCounts.map((item) => [item._id.toString(), item.count]),
  );

  return {
    users: users.map((user) => ({
      ...user,
      ownedProjectCount: countsByUser.get(user._id.toString()) || 0,
    })),
    pagination: {
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    },
    query,
  };
}

async function createUser({ email, isAdmin, initiatorId, ipAddress }) {
  email = EmailHelper.parseEmail(email);
  if (!email) {
    throw new Error("invalid email address");
  }

  const { user, setNewPasswordUrl } =
    await UserRegistrationHandler.promises.registerNewUserAndSendActivationEmail(
      email,
    );
  if (isAdmin) {
    await db.users.updateOne({ _id: user._id }, { $set: { isAdmin: true } });
  }
  await UserAuditLogHandler.promises.addEntry(
    user._id,
    "admin-create-account",
    initiatorId,
    ipAddress,
    { isAdmin: Boolean(isAdmin) },
  );
  return { user, setNewPasswordUrl };
}

async function suspendUser({ userId, initiatorId, ipAddress }) {
  userId = normalizeObjectId(userId);
  if (userId.equals(initiatorId)) {
    throw new Error("an administrator cannot suspend their own account");
  }
  await UserUpdater.promises.suspendUser(userId, {
    initiatorId,
    ip: ipAddress,
    info: { source: "community-admin" },
  });
  // Suspension must close every channel, not just web sessions: revoke the
  // user's Git tokens so they cannot keep cloning or pushing.
  await GitTokenManager.revokeAllForUser(userId);
  await disconnectRealtimeUser(userId);
}

async function unsuspendUser({ userId, initiatorId, ipAddress }) {
  userId = normalizeObjectId(userId);
  await UserUpdater.promises.unsuspendUser(userId, {
    initiatorId,
    ip: ipAddress,
    info: { source: "community-admin" },
  });
}

async function revokeSessions({ userId, initiatorId, ipAddress }) {
  userId = normalizeObjectId(userId);
  if (userId.equals(initiatorId)) {
    throw new Error("use account settings to revoke your own other sessions");
  }
  await UserSessionsManager.promises.removeSessionsFromRedis({ _id: userId });
  await disconnectRealtimeUser(userId);
  await UserAuditLogHandler.promises.addEntry(
    userId,
    "admin-revoke-sessions",
    initiatorId,
    ipAddress,
    { source: "community-admin" },
  );
}

async function deleteUser({
  userId,
  confirmationEmail,
  transferTo,
  initiatorId,
  ipAddress,
}) {
  userId = normalizeObjectId(userId);
  if (userId.equals(initiatorId)) {
    throw new Error("an administrator cannot delete their own account");
  }

  const user = await db.users.findOne(
    { _id: userId },
    { projection: { email: 1, isAdmin: 1 } },
  );
  if (!user) {
    throw new Error("user not found");
  }
  if (EmailHelper.parseEmail(confirmationEmail) !== user.email) {
    throw new Error("confirmation email does not match the account");
  }

  let transferResult;
  if (transferTo?.trim()) {
    const destinationEmail = EmailHelper.parseEmail(transferTo);
    const destination = destinationEmail
      ? await db.users.findOne(
          { email: destinationEmail, suspended: { $ne: true } },
          { projection: { _id: 1 } },
        )
      : null;
    if (!destination) {
      throw new Error("active transfer destination not found");
    }
    transferResult =
      await OwnershipTransferHandler.promises.transferAllProjectsToUser({
        fromUserId: userId,
        toUserId: destination._id,
        ipAddress,
      });
  }

  const remainingProjects = await db.projects.countDocuments({
    owner_ref: userId,
  });
  if (remainingProjects > 0) {
    throw new Error(
      "the account still owns projects; provide an active transfer destination",
    );
  }

  await disconnectRealtimeUser(userId);
  await GitTokenManager.revokeAllForUser(userId);
  await GitLabSyncManager.deleteForUser(userId);
  await AiManager.deleteForUser(userId);
  await UserDeleter.promises.deleteUser(userId, {
    deleterUser: { _id: initiatorId },
    ipAddress,
    force: true,
    skipEmail: true,
  });
  return { transferResult };
}

async function disconnectRealtimeUser(userId) {
  try {
    const url = new URL(Settings.apis.realTime.url);
    url.pathname = `/user/${userId}/disconnect`;
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`real-time returned ${response.status}`);
    }
  } catch (err) {
    logger.warn(
      { err, userId },
      "failed to disconnect user from real-time after account administration",
    );
  }
}

export default {
  createUser,
  deleteUser,
  listUsers,
  revokeSessions,
  suspendUser,
  unsuspendUser,
};
