import si from "systeminformation";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { HttpError } from "../lib/httpError.js";

const SERVICE_KEYS = [
  "sshEnabled",
  "smbEnabled",
  "webdavEnabled",
  "ftpEnabled",
  "nfsEnabled",
  "dlnaEnabled",
  "firewallEnabled",
  "notifyEnabled",
  "autoUpdateEnabled"
];

function getSetting(key, fallback = "") {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, String(value ?? ""), now);
}

function parseBool(value, fallback = false) {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}

export async function getSystemStatus() {
  const [load, mem, fs, networkStats] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats()
  ]);

  const disks = (fs || []).map((d) => ({
    fs: d.fs,
    mount: d.mount,
    size: d.size,
    used: d.used,
    available: Math.max(0, d.size - d.used),
    usePercent: d.use
  }));

  const net = (networkStats || []).map((n) => ({
    iface: n.iface,
    rxBytes: n.rx_bytes,
    txBytes: n.tx_bytes,
    rxSec: n.rx_sec,
    txSec: n.tx_sec
  }));

  return {
    cpu: {
      usagePercent: Number(load.currentLoad.toFixed(2)),
      cores: load.cpus?.length || 0
    },
    memory: {
      total: mem.total,
      used: mem.used,
      free: mem.free,
      usagePercent: Number(((mem.used / mem.total) * 100).toFixed(2))
    },
    disks,
    network: net,
    updatedAt: new Date().toISOString()
  };
}

export async function getDeviceOverview() {
  const [osInfo, cpu, mem, time, fs, netIfs, netStats] = await Promise.all([
    si.osInfo(),
    si.cpu(),
    si.mem(),
    si.time(),
    si.fsSize(),
    si.networkInterfaces(),
    si.networkStats()
  ]);

  return {
    device: {
      hostname: osInfo.hostname || "",
      distro: osInfo.distro || "",
      release: osInfo.release || "",
      kernel: osInfo.kernel || "",
      arch: osInfo.arch || "",
      uptime: time.uptime || 0
    },
    hardware: {
      cpuBrand: cpu.brand || "",
      physicalCores: cpu.physicalCores || 0,
      cores: cpu.cores || 0,
      speed: cpu.speed || "",
      memoryTotal: mem.total || 0,
      memoryFree: mem.free || 0
    },
    storage: (fs || []).map((d) => ({
      fs: d.fs,
      mount: d.mount,
      type: d.type,
      size: d.size,
      used: d.used,
      available: Math.max(0, d.size - d.used),
      usePercent: d.use
    })),
    network: {
      interfaces: (netIfs || []).map((n) => ({
        iface: n.iface,
        ip4: n.ip4 || "",
        ip6: n.ip6 || "",
        mac: n.mac || "",
        operstate: n.operstate || "",
        speed: n.speed || 0,
        mtu: n.mtu || 0
      })),
      realtime: (netStats || []).map((n) => ({
        iface: n.iface,
        rxSec: n.rx_sec || 0,
        txSec: n.tx_sec || 0
      }))
    }
  };
}

export function listUsers() {
  const users = db
    .prepare("SELECT id, username, role, created_at, updated_at FROM users ORDER BY id ASC")
    .all();

  const groupRows = db
    .prepare(
      `SELECT ugm.user_id, ug.name
       FROM user_group_members ugm
       JOIN user_groups ug ON ug.id = ugm.group_id`
    )
    .all();

  const groupsByUser = new Map();
  for (const row of groupRows) {
    if (!groupsByUser.has(row.user_id)) groupsByUser.set(row.user_id, []);
    groupsByUser.get(row.user_id).push(row.name);
  }

  return users.map((u) => ({
    ...u,
    groups: groupsByUser.get(u.id) || []
  }));
}

export function createUser({ username, password, role = "user" }) {
  const name = String(username || "").trim();
  const pwd = String(password || "");
  if (!name) throw new HttpError(400, "用户名不能为空");
  if (pwd.length < 8) throw new HttpError(400, "密码至少 8 位");
  if (!["admin", "user"].includes(role)) throw new HttpError(400, "角色不合法");

  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
  if (exists) throw new HttpError(409, "用户名已存在");

  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(pwd, 10);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(name, hash, role, now, now);

  return db
    .prepare("SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?")
    .get(info.lastInsertRowid);
}

export function updateUser(userId, { role, password }) {
  const id = Number(userId);
  const current = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!current) throw new HttpError(404, "用户不存在");

  const nextRole = typeof role === "string" ? role : null;
  if (nextRole && !["admin", "user"].includes(nextRole)) {
    throw new HttpError(400, "角色不合法");
  }
  const nextPwd = typeof password === "string" ? password : "";
  if (nextPwd && nextPwd.length < 8) {
    throw new HttpError(400, "密码至少 8 位");
  }

  const now = new Date().toISOString();
  if (nextRole) {
    db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(nextRole, now, id);
  }
  if (nextPwd) {
    const hash = bcrypt.hashSync(nextPwd, 10);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, now, id);
  }

  return db
    .prepare("SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?")
    .get(id);
}

export function deleteUser(userId) {
  const id = Number(userId);
  const current = db.prepare("SELECT id, username FROM users WHERE id = ?").get(id);
  if (!current) throw new HttpError(404, "用户不存在");
  db.prepare("DELETE FROM user_group_members WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return { ok: true, id, username: current.username };
}

export function listGroups() {
  const groups = db
    .prepare("SELECT id, name, description, created_at, updated_at FROM user_groups ORDER BY id ASC")
    .all();

  const members = db
    .prepare(
      `SELECT ugm.group_id, u.id as user_id, u.username
       FROM user_group_members ugm
       JOIN users u ON u.id = ugm.user_id
       ORDER BY u.username`
    )
    .all();

  const map = new Map();
  for (const row of members) {
    if (!map.has(row.group_id)) map.set(row.group_id, []);
    map.get(row.group_id).push({
      id: row.user_id,
      username: row.username
    });
  }

  return groups.map((g) => ({
    ...g,
    members: map.get(g.id) || []
  }));
}

export function createGroup({ name, description = "" }) {
  const groupName = String(name || "").trim();
  if (!groupName) throw new HttpError(400, "用户组名称不能为空");
  const exists = db.prepare("SELECT id FROM user_groups WHERE name = ?").get(groupName);
  if (exists) throw new HttpError(409, "用户组已存在");

  const now = new Date().toISOString();
  const info = db
    .prepare("INSERT INTO user_groups (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(groupName, String(description || ""), now, now);

  return db.prepare("SELECT * FROM user_groups WHERE id = ?").get(info.lastInsertRowid);
}

export function updateGroup(groupId, { name, description }) {
  const id = Number(groupId);
  const current = db.prepare("SELECT id FROM user_groups WHERE id = ?").get(id);
  if (!current) throw new HttpError(404, "用户组不存在");
  const now = new Date().toISOString();

  if (typeof name === "string" && name.trim()) {
    db.prepare("UPDATE user_groups SET name = ?, updated_at = ? WHERE id = ?").run(name.trim(), now, id);
  }
  if (typeof description === "string") {
    db.prepare("UPDATE user_groups SET description = ?, updated_at = ? WHERE id = ?").run(description, now, id);
  }

  return db.prepare("SELECT * FROM user_groups WHERE id = ?").get(id);
}

export function deleteGroup(groupId) {
  const id = Number(groupId);
  const current = db.prepare("SELECT id, name FROM user_groups WHERE id = ?").get(id);
  if (!current) throw new HttpError(404, "用户组不存在");
  db.prepare("DELETE FROM user_group_members WHERE group_id = ?").run(id);
  db.prepare("DELETE FROM user_groups WHERE id = ?").run(id);
  return { ok: true, id, name: current.name };
}

export function addGroupMember(groupId, userId) {
  const gid = Number(groupId);
  const uid = Number(userId);
  const group = db.prepare("SELECT id FROM user_groups WHERE id = ?").get(gid);
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(uid);
  if (!group || !user) throw new HttpError(404, "用户或用户组不存在");
  db.prepare("INSERT OR IGNORE INTO user_group_members (user_id, group_id, created_at) VALUES (?, ?, ?)")
    .run(uid, gid, new Date().toISOString());
  return { ok: true, groupId: gid, userId: uid };
}

export function removeGroupMember(groupId, userId) {
  const gid = Number(groupId);
  const uid = Number(userId);
  db.prepare("DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?").run(gid, uid);
  return { ok: true, groupId: gid, userId: uid };
}

export function getServiceSwitches() {
  const result = {};
  for (const key of SERVICE_KEYS) {
    result[key] = parseBool(getSetting(`service.${key}`, "0"), false);
  }
  return result;
}

export function saveServiceSwitches(input = {}) {
  for (const key of SERVICE_KEYS) {
    if (typeof input[key] === "undefined") continue;
    setSetting(`service.${key}`, input[key] ? "1" : "0");
  }
  return getServiceSwitches();
}

export function getRemoteAccessConfig() {
  return {
    enabled: parseBool(getSetting("remote.enabled", "0"), false),
    provider: getSetting("remote.provider", "cloudflare"),
    domain: getSetting("remote.domain", ""),
    tokenMasked: getSetting("remote.token", "") ? "******" : ""
  };
}

export function saveRemoteAccessConfig(input = {}) {
  if (typeof input.enabled !== "undefined") {
    setSetting("remote.enabled", input.enabled ? "1" : "0");
  }
  if (typeof input.provider === "string") {
    setSetting("remote.provider", input.provider.trim() || "cloudflare");
  }
  if (typeof input.domain === "string") {
    setSetting("remote.domain", input.domain.trim());
  }
  if (typeof input.token === "string" && input.token.trim() && input.token.trim() !== "******") {
    setSetting("remote.token", input.token.trim());
  }
  return getRemoteAccessConfig();
}

export function listDDNSRecords() {
  const rows = db
    .prepare(
      `SELECT id, provider, domain, ip_address, status, config_json, last_synced_at, created_at, updated_at
       FROM ddns_records
       ORDER BY id DESC`
    )
    .all();

  return rows.map((r) => {
    let configJson = {};
    try {
      configJson = JSON.parse(r.config_json || "{}");
    } catch {
      configJson = {};
    }
    return {
      ...r,
      config: configJson
    };
  });
}

export function createDDNSRecord({ provider = "cloudflare", domain, ipAddress = "", status = "unknown", config = {} }) {
  const d = String(domain || "").trim();
  if (!d) throw new HttpError(400, "domain 必填");
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO ddns_records (provider, domain, ip_address, status, config_json, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(provider || "cloudflare"),
      d,
      String(ipAddress || ""),
      String(status || "unknown"),
      JSON.stringify(config || {}),
      now,
      now,
      now
    );
  return db.prepare("SELECT * FROM ddns_records WHERE id = ?").get(info.lastInsertRowid);
}

export function deleteDDNSRecord(id) {
  const row = db.prepare("SELECT id FROM ddns_records WHERE id = ?").get(Number(id));
  if (!row) throw new HttpError(404, "DDNS 记录不存在");
  db.prepare("DELETE FROM ddns_records WHERE id = ?").run(Number(id));
  return { ok: true, id: Number(id) };
}
