import Path from "node:path";
import { expressify } from "@overleaf/promise-utils";
import SessionManager from "../../../../../app/src/Features/Authentication/SessionManager.mjs";
import AdminUsersManager from "./AdminUsersManager.mjs";

const viewPath = Path.resolve(
  import.meta.dirname,
  "../../views/admin-users.pug",
);

function currentUserId(req) {
  return SessionManager.getLoggedInUserId(req.session);
}

function setNotice(req, notice) {
  req.session.communityAdminNotice = notice;
}

function popNotice(req) {
  const notice = req.session.communityAdminNotice;
  delete req.session.communityAdminNotice;
  return notice;
}

async function index(req, res) {
  const result = await AdminUsersManager.listUsers({
    query: req.query.q,
    page: req.query.page,
  });
  res.render(viewPath, {
    title: "User administration",
    ...result,
    notice: popNotice(req),
    currentUserId: currentUserId(req)?.toString(),
  });
}

async function create(req, res) {
  const { user, setNewPasswordUrl } = await AdminUsersManager.createUser({
    email: req.body.email,
    isAdmin: req.body.isAdmin === "true",
    initiatorId: currentUserId(req),
    ipAddress: req.ip,
  });
  setNotice(req, {
    type: "success",
    message: `Account ${user.email} created.`,
    activationUrl: setNewPasswordUrl,
  });
  res.redirect("/admin/community/users");
}

async function suspend(req, res) {
  await AdminUsersManager.suspendUser({
    userId: req.params.userId,
    initiatorId: currentUserId(req),
    ipAddress: req.ip,
  });
  setNotice(req, { type: "success", message: "Account suspended." });
  res.redirect("/admin/community/users");
}

async function unsuspend(req, res) {
  await AdminUsersManager.unsuspendUser({
    userId: req.params.userId,
    initiatorId: currentUserId(req),
    ipAddress: req.ip,
  });
  setNotice(req, { type: "success", message: "Account re-enabled." });
  res.redirect("/admin/community/users");
}

async function revokeSessions(req, res) {
  await AdminUsersManager.revokeSessions({
    userId: req.params.userId,
    initiatorId: currentUserId(req),
    ipAddress: req.ip,
  });
  setNotice(req, { type: "success", message: "Active sessions revoked." });
  res.redirect("/admin/community/users");
}

async function deleteUser(req, res) {
  const { transferResult } = await AdminUsersManager.deleteUser({
    userId: req.params.userId,
    confirmationEmail: req.body.confirmationEmail,
    transferTo: req.body.transferTo,
    initiatorId: currentUserId(req),
    ipAddress: req.ip,
  });
  const transferMessage = transferResult
    ? ` ${transferResult.projectCount} project(s) transferred.`
    : "";
  setNotice(req, {
    type: "success",
    message: `Account deleted.${transferMessage}`,
  });
  res.redirect("/admin/community/users");
}

function formAction(handler) {
  return expressify(async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      setNotice(req, {
        type: "danger",
        message: error.message || "The administration action failed.",
      });
      res.redirect("/admin/community/users");
    }
  });
}

export default {
  index: expressify(index),
  create: formAction(create),
  suspend: formAction(suspend),
  unsuspend: formAction(unsuspend),
  revokeSessions: formAction(revokeSessions),
  delete: formAction(deleteUser),
};
