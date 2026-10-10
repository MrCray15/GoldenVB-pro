import { Router } from "../micro.js";
import db from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const r = Router();

// ---------- invite code generator ----------
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeCode() {
  const pick = () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  const block = (n) => Array.from({ length: n }, pick).join("");
  return `GVB-${block(4)}-${block(2)}`;
}

// ---------- create invite ----------
r.post("/api/admin/invites", requireAuth, requireRole("admin"), async (req, res) => {
  const { email, name, role } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });
  if (!["admin", "manager", "caretaker"].includes(role))
    return res.status(400).json({ error: "Role must be 'admin', 'manager', or 'caretaker'" });

  const lower = email.toLowerCase();
  if (await db.users.byEmail(lower))
    return res.status(409).json({ error: "That email is already registered" });

  const expires_at = new Date(Date.now() + 24 * 3600e3).toISOString();
  const code = makeCode();

  const invite = await db.invites.insert({
    code,
    email: lower,
    name: name || null,
    role,
    created_by: req.user.id,
    expires_at,
  });

  res.status(201).json({
    invite: {
      id: invite.id,
      code: invite.code,
      email: invite.email,
      name: invite.name,
      role: invite.role,
      expires_at: invite.expires_at,
    },
    note: "Send this code to the applicant. It will not be shown again.",
  });
});

// ---------- list invites ----------
r.get("/api/admin/invites", requireAuth, requireRole("admin"), async (req, res) => {
  const all = await db.invites.all();
  res.json({ invites: all });
});

// ---------- revoke invite ----------
r.post("/api/admin/invites/:id/revoke", requireAuth, requireRole("admin"), async (req, res) => {
  const invite = await db.invites.byId(req.params.id);
  if (!invite) return res.status(404).json({ error: "Invite not found" });
  if (invite.used_at) return res.status(400).json({ error: "Already used — nothing to revoke" });
  await db.invites.revoke(invite.id);
  res.json({ ok: true });
});

// ---------- list users ----------
r.get("/api/admin/users", requireAuth, requireRole("admin"), async (req, res) => {
  const all = await db.users.all();
  const safe = all.map(({ password_hash, ...u }) => u);
  res.json({ users: safe });
});

// ---------- full schedule history ----------
r.get("/api/admin/history", requireAuth, requireRole("admin"), async (req, res) => {
  const [resv, visits, users] = await Promise.all([
    db.reservations.history(),
    db.visits.history(),
    db.users.all(),
  ]);
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  const bookingRows = resv.map((x) => ({
    type: "booking",
    id: x.id,
    ref: x.ref,
    guest_name: x.guest_name,
    guest_email: x.guest_email,
    guest_phone: x.guest_phone,
    package_id: x.package_id,
    date: x.date,
    guests: x.guests,
    status: x.status,
    deposit_amount: x.deposit_amount,
    deposit_proof: x.deposit_proof,
    source: x.source,
    created_at: x.created_at,
    completed_at: x.completed_at || null,
    completed_by_name: x.completed_by ? (userMap[x.completed_by] || "—") : null,
    cancelled_at: x.cancelled_at || null,
    cancelled_by_name: x.cancelled_by ? (userMap[x.cancelled_by] || "—") : null,
  }));

  const visitRows = visits.map((v) => ({
    type: "visit",
    id: v.id,
    ref: null,
    guest_name: null,
    guest_email: null,
    guest_phone: null,
    package_id: "ocular visit",
    date: v.date,
    guests: v.party_size,
    time: v.time,
    status: v.status,
    deposit_amount: null,
    deposit_proof: null,
    source: "online",
    created_at: v.created_at,
    completed_at: v.completed_at || null,
    completed_by_name: v.completed_by ? (userMap[v.completed_by] || "—") : null,
    cancelled_at: v.cancelled_at || null,
    cancelled_by_name: v.cancelled_by ? (userMap[v.cancelled_by] || "—") : null,
  }));

  const records = [...bookingRows, ...visitRows]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  res.json({ records });
});

// ---------- deletion log (admin only) ----------
r.get("/api/admin/deletions", requireAuth, requireRole("admin"), async (req, res) => {
  const all = await db.deletedRecords.all();
  const users = await db.users.all();
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  res.json({
    deletions: all.map((d) => ({
      id: d.id,
      kind: d.kind,
      original_id: d.original_id,
      deleted_by_name: userMap[d.deleted_by] || "—",
      deleted_at: d.deleted_at,
      reason: d.reason,
      snapshot: d.snapshot,
    })),
  });
});

export default r;