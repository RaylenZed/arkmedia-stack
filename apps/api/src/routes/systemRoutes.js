import express from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { writeAudit } from "../services/auditService.js";
import {
  addGroupMember,
  createDDNSRecord,
  createGroup,
  createUser,
  deleteDDNSRecord,
  deleteGroup,
  deleteUser,
  getDeviceOverview,
  getRemoteAccessConfig,
  getServiceSwitches,
  getSystemStatus,
  listDDNSRecords,
  listGroups,
  listUsers,
  removeGroupMember,
  saveRemoteAccessConfig,
  saveServiceSwitches,
  updateGroup,
  updateUser
} from "../services/systemService.js";

const router = express.Router();
router.use(requireAuth);

router.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(await getSystemStatus());
  })
);

router.get(
  "/device-overview",
  asyncHandler(async (_req, res) => {
    res.json(await getDeviceOverview());
  })
);

router.get(
  "/users",
  asyncHandler(async (_req, res) => {
    res.json(listUsers());
  })
);

router.post(
  "/users",
  asyncHandler(async (req, res) => {
    const user = createUser(req.body || {});
    writeAudit({ action: "system_user_create", actor: req.user.username, target: user.username, status: "ok" });
    res.status(201).json(user);
  })
);

router.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const updated = updateUser(req.params.id, req.body || {});
    writeAudit({ action: "system_user_update", actor: req.user.username, target: String(req.params.id), status: "ok" });
    res.json(updated);
  })
);

router.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const result = deleteUser(req.params.id);
    writeAudit({ action: "system_user_delete", actor: req.user.username, target: String(req.params.id), status: "ok" });
    res.json(result);
  })
);

router.get(
  "/groups",
  asyncHandler(async (_req, res) => {
    res.json(listGroups());
  })
);

router.post(
  "/groups",
  asyncHandler(async (req, res) => {
    const group = createGroup(req.body || {});
    writeAudit({ action: "system_group_create", actor: req.user.username, target: group.name, status: "ok" });
    res.status(201).json(group);
  })
);

router.patch(
  "/groups/:id",
  asyncHandler(async (req, res) => {
    const group = updateGroup(req.params.id, req.body || {});
    writeAudit({ action: "system_group_update", actor: req.user.username, target: String(req.params.id), status: "ok" });
    res.json(group);
  })
);

router.delete(
  "/groups/:id",
  asyncHandler(async (req, res) => {
    const result = deleteGroup(req.params.id);
    writeAudit({ action: "system_group_delete", actor: req.user.username, target: String(req.params.id), status: "ok" });
    res.json(result);
  })
);

router.post(
  "/groups/:id/members",
  asyncHandler(async (req, res) => {
    const result = addGroupMember(req.params.id, req.body?.userId);
    writeAudit({
      action: "system_group_member_add",
      actor: req.user.username,
      target: `${req.params.id}:${req.body?.userId}`,
      status: "ok"
    });
    res.json(result);
  })
);

router.delete(
  "/groups/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const result = removeGroupMember(req.params.id, req.params.userId);
    writeAudit({
      action: "system_group_member_remove",
      actor: req.user.username,
      target: `${req.params.id}:${req.params.userId}`,
      status: "ok"
    });
    res.json(result);
  })
);

router.get(
  "/remote",
  asyncHandler(async (_req, res) => {
    res.json(getRemoteAccessConfig());
  })
);

router.put(
  "/remote",
  asyncHandler(async (req, res) => {
    const result = saveRemoteAccessConfig(req.body || {});
    writeAudit({ action: "system_remote_update", actor: req.user.username, status: "ok" });
    res.json(result);
  })
);

router.get(
  "/ddns",
  asyncHandler(async (_req, res) => {
    res.json(listDDNSRecords());
  })
);

router.post(
  "/ddns",
  asyncHandler(async (req, res) => {
    const row = createDDNSRecord(req.body || {});
    writeAudit({ action: "system_ddns_create", actor: req.user.username, target: row.domain, status: "ok" });
    res.status(201).json(row);
  })
);

router.delete(
  "/ddns/:id",
  asyncHandler(async (req, res) => {
    const result = deleteDDNSRecord(req.params.id);
    writeAudit({ action: "system_ddns_delete", actor: req.user.username, target: String(req.params.id), status: "ok" });
    res.json(result);
  })
);

router.get(
  "/services",
  asyncHandler(async (_req, res) => {
    res.json(getServiceSwitches());
  })
);

router.put(
  "/services",
  asyncHandler(async (req, res) => {
    const result = saveServiceSwitches(req.body || {});
    writeAudit({ action: "system_services_update", actor: req.user.username, status: "ok" });
    res.json(result);
  })
);

export default router;
