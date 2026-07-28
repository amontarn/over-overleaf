import { Project } from "../../../../app/src/models/Project.mjs";
import ProjectAuditLogHandler from "../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs";
import ChatApiHandler from "../../../../app/src/Features/Chat/ChatApiHandler.mjs";
import ChatManager from "../../../../app/src/Features/Chat/ChatManager.mjs";
import DocumentUpdaterHandler from "../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs";
import EditorRealTimeController from "../../../../app/src/Features/Editor/EditorRealTimeController.mjs";
import SessionManager from "../../../../app/src/Features/Authentication/SessionManager.mjs";
import UserGetter from "../../../../app/src/Features/User/UserGetter.mjs";
import UserInfoController from "../../../../app/src/Features/User/UserInfoController.mjs";

function loggedInUserId(req) {
  const userId = SessionManager.getLoggedInUserId(req.session);
  if (!userId) throw new Error("no logged-in user");
  return userId;
}

async function getThreads(req, res) {
  const threads = await ChatApiHandler.promises.getThreads(
    req.params.project_id,
  );
  await ChatManager.promises.injectUserInfoIntoThreads(threads);
  res.json(threads);
}

async function sendComment(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params;
  const userId = loggedInUserId(req);
  const comment = await ChatApiHandler.promises.sendComment(
    projectId,
    threadId,
    userId,
    req.body.content,
  );
  const user = await UserGetter.promises.getUser(userId, {
    _id: true,
    first_name: true,
    last_name: true,
    email: true,
  });
  comment.user = UserInfoController.formatPersonalInfo(user);
  EditorRealTimeController.emitToRoom(
    projectId,
    "new-comment",
    threadId,
    comment,
  );
  res.sendStatus(204);
}

async function editMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params;
  const userId = loggedInUserId(req);
  await ChatApiHandler.promises.editMessage(
    projectId,
    threadId,
    messageId,
    userId,
    req.body.content,
  );
  EditorRealTimeController.emitToRoom(
    projectId,
    "edit-message",
    threadId,
    messageId,
    req.body.content,
  );
  res.sendStatus(204);
}

async function deleteMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params;
  await ChatApiHandler.promises.deleteMessage(projectId, threadId, messageId);
  EditorRealTimeController.emitToRoom(
    projectId,
    "delete-message",
    threadId,
    messageId,
  );
  res.sendStatus(204);
}

async function deleteOwnMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params;
  await ChatApiHandler.promises.deleteUserMessage(
    projectId,
    threadId,
    loggedInUserId(req),
    messageId,
  );
  EditorRealTimeController.emitToRoom(
    projectId,
    "delete-message",
    threadId,
    messageId,
  );
  res.sendStatus(204);
}

async function resolveThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params;
  const userId = loggedInUserId(req);
  await Promise.all([
    DocumentUpdaterHandler.promises.resolveThread(
      projectId,
      docId,
      threadId,
      userId,
    ),
    ChatApiHandler.promises.resolveThread(projectId, threadId, userId),
  ]);
  const user = await UserGetter.promises.getUser(userId, {
    _id: true,
    first_name: true,
    last_name: true,
    email: true,
  });
  EditorRealTimeController.emitToRoom(
    projectId,
    "resolve-thread",
    threadId,
    UserInfoController.formatPersonalInfo(user),
  );
  res.sendStatus(204);
}

async function reopenThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params;
  const userId = loggedInUserId(req);
  await Promise.all([
    DocumentUpdaterHandler.promises.reopenThread(
      projectId,
      docId,
      threadId,
      userId,
    ),
    ChatApiHandler.promises.reopenThread(projectId, threadId),
  ]);
  EditorRealTimeController.emitToRoom(projectId, "reopen-thread", threadId);
  res.sendStatus(204);
}

async function deleteThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params;
  const userId = loggedInUserId(req);
  await Promise.all([
    DocumentUpdaterHandler.promises.deleteThread(
      projectId,
      docId,
      threadId,
      userId,
    ),
    ChatApiHandler.promises.deleteThread(projectId, threadId),
  ]);
  EditorRealTimeController.emitToRoom(projectId, "delete-thread", threadId);
  res.sendStatus(204);
}

async function getRanges(req, res) {
  res.json(
    await DocumentUpdaterHandler.promises.getProjectRanges(
      req.params.project_id,
    ),
  );
}

async function getChangesUsers(req, res) {
  const docs = await DocumentUpdaterHandler.promises.getProjectRanges(
    req.params.project_id,
  );
  const ids = new Set();
  for (const doc of docs) {
    for (const change of doc.ranges?.changes || []) {
      if (change.metadata?.user_id) ids.add(change.metadata.user_id.toString());
    }
  }
  const users = await UserGetter.promises.getUsers([...ids], {
    _id: true,
    first_name: true,
    last_name: true,
    email: true,
  });
  res.json(users.map(UserInfoController.formatPersonalInfo));
}

async function acceptChanges(req, res) {
  const { project_id: projectId, doc_id: docId } = req.params;
  const changeIds = Array.isArray(req.body.change_ids)
    ? req.body.change_ids
    : [];
  await DocumentUpdaterHandler.promises.acceptChanges(
    projectId,
    docId,
    changeIds,
    loggedInUserId(req),
  );
  EditorRealTimeController.emitToRoom(
    projectId,
    "accept-changes",
    docId,
    changeIds,
  );
  res.sendStatus(204);
}

async function setTrackChanges(req, res) {
  const { project_id: projectId } = req.params;
  const current = await Project.findById(projectId, { track_changes: 1 })
    .lean()
    .exec();
  let value = current?.track_changes || false;

  if (typeof req.body.on === "boolean") {
    value = req.body.on;
  } else {
    value = Object.fromEntries(
      typeof value === "object" && value !== null
        ? Object.entries(value).filter(
            ([userId, enabled]) =>
              /^[a-f0-9]{24}$/i.test(userId) && enabled === true,
          )
        : [],
    );
    if (req.body.on_for && typeof req.body.on_for === "object") {
      for (const [userId, enabled] of Object.entries(req.body.on_for)) {
        if (!/^[a-f0-9]{24}$/i.test(userId)) continue;
        if (enabled === true) value[userId] = true;
        else delete value[userId];
      }
    }
    if (typeof req.body.on_for_guests === "boolean") {
      if (req.body.on_for_guests) value.__guests__ = true;
      else delete value.__guests__;
    }
    if (Object.keys(value).length === 0) value = false;
  }

  await Project.updateOne(
    { _id: projectId },
    { $set: { track_changes: value } },
  ).exec();
  await ProjectAuditLogHandler.promises.addEntry(
    projectId,
    "track-changes-settings-updated",
    loggedInUserId(req),
    req.ip,
    { scope: "project", value: typeof value === "object" ? "per-user" : value },
  );
  EditorRealTimeController.emitToRoom(projectId, "toggle-track-changes", value);
  res.sendStatus(204);
}

// A collaborator may only toggle their own track-changes flag. The update is a
// single aggregation-pipeline updateOne so concurrent per-user toggles cannot
// clobber each other the way a read-modify-write of the whole object would.
async function setTrackChangesForSelf(req, res) {
  const { project_id: projectId } = req.params;
  if (typeof req.body.on !== "boolean") {
    return res.status(400).json({ message: "on must be a boolean" });
  }
  // Logged-in collaborators toggle their own id; anonymous link-shared users
  // (guests, who have review access but no id) toggle the shared guest flag.
  const sessionUserId = SessionManager.getLoggedInUserId(req.session);
  const userId = sessionUserId ? sessionUserId.toString() : "__guests__";
  const enabled = req.body.on;

  await Project.updateOne({ _id: projectId }, [
    {
      $set: {
        track_changes: {
          // A project-wide "on" already covers this user; leave it untouched.
          $cond: {
            if: { $eq: ["$track_changes", true] },
            then: true,
            else: {
              $let: {
                vars: {
                  base: {
                    $cond: [
                      { $eq: [{ $type: "$track_changes" }, "object"] },
                      "$track_changes",
                      {},
                    ],
                  },
                },
                in: enabled
                  ? { $mergeObjects: ["$$base", { [userId]: true }] }
                  : {
                      $arrayToObject: {
                        $filter: {
                          input: { $objectToArray: "$$base" },
                          cond: { $ne: ["$$this.k", userId] },
                        },
                      },
                    },
              },
            },
          },
        },
      },
    },
    {
      // Normalise an empty map back to the boolean-off form.
      $set: {
        track_changes: {
          $cond: {
            if: {
              $and: [
                { $eq: [{ $type: "$track_changes" }, "object"] },
                { $eq: [{ $size: { $objectToArray: "$track_changes" } }, 0] },
              ],
            },
            then: false,
            else: "$track_changes",
          },
        },
      },
    },
  ]).exec();

  const updated = await Project.findById(projectId, { track_changes: 1 })
    .lean()
    .exec();
  await ProjectAuditLogHandler.promises.addEntry(
    projectId,
    "track-changes-settings-updated",
    sessionUserId,
    req.ip,
    { scope: sessionUserId ? "self" : "guests", on: enabled },
  );
  EditorRealTimeController.emitToRoom(
    projectId,
    "toggle-track-changes",
    updated?.track_changes ?? false,
  );
  res.sendStatus(204);
}

export default {
  getThreads,
  sendComment,
  editMessage,
  deleteMessage,
  deleteOwnMessage,
  resolveThread,
  reopenThread,
  deleteThread,
  getRanges,
  getChangesUsers,
  acceptChanges,
  setTrackChanges,
  setTrackChangesForSelf,
};
