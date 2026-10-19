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

// ============================================
// 1. AUTH RATE LIMITING
// ============================================
const rateLimitMap = new Map();
function rateLimit(req, res, limit = 5, windowMs = 60000) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const now = Date.now();
  
  if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
  const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
  
  if (timestamps.length >= limit) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return false; 
  }
  
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return true; 
}

// ---------- create invite ----------
r.post("/api/admin/invites", requireAuth, requireRole("admin"), async (req, res) => {
  if (!rateLimit(req, res, 10)) return;

  try {
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
      code, email: lower, name: name || null, role,
      created_by: req.user.id, expires_at,
    });

    res.status(201).json({
      invite: {
        id: invite.id, code: invite.code, email: invite.email,
        name: invite.name, role: invite.role, expires_at: invite.expires_at,
      },
      note: "Send this code to the applicant. It will not be shown again.",
    });
  } catch (err) {
    console.error("[admin] invite creation failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
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

// ---------- list users (TABS SYSTEM) ----------
r.get("/api/admin/users", requireAuth, requireRole("admin"), async (req, res) => {
  const all = await db.users.all();

  // Parse the "tab" from the URL (default is 'active')
  let tab = "active";
  if (req.url && req.url.includes("?")) {
    const qs = req.url.split("?")[1];
    const params = new URLSearchParams(qs);
    tab = params.get("tab") || "active";
  }

  // If tab is archived, show ONLY archived. If active, show EVERYTHING ELSE.
  const filtered = tab === "archived" 
    ? all.filter((u) => u.status === "archived")
    : all.filter((u) => u.status !== "archived");

  const safe = filtered.map(({ password_hash, ...u }) => u);
  res.json({ users: safe });
});

// ---------- update user status (with email freeing) ----------
r.post("/api/admin/users/:id/status", requireAuth, requireRole("admin"), async (req, res) => {
  if (!rateLimit(req, res, 10)) return;

  try {
    const { status } = req.body || {};
    const allowed = ["active", "suspended", "banned", "archived"];
    if (!allowed.includes(status))
      return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });

    const target = await db.users.byId(req.params.id);
    if (!target) return res.status(404).json({ error: "User not found" });

    if (target.role === "admin" && target.id !== req.user.id)
      return res.status(403).json({ error: "Cannot modify another admin" });

    if (target.id === req.user.id && (status === "archived" || status === "suspended" || status === "banned"))
      return res.status(403).json({ error: "You cannot archive or suspend your own account" });

    if (status === "archived" && target.role === "admin")
      return res.status(403).json({ error: "Admins cannot be archived" });

    let patch = { status };

    // ⬇️ FREE UP THE EMAIL WHEN ARCHIVING ⬇️
    if (status === "archived" && target.status !== "archived") {
      const timestamp = Date.now();
      patch.email = `${target.email}_archived_${timestamp}`;
    }

    const updated = await db.users.update(target.id, patch);
    const { password_hash, ...safe } = updated;
    res.json({ user: safe });
  } catch (err) {
    console.error("[admin] status update failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- history ----------
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
    promo_code: x.promo_code || null,
    promo_discount: x.promo_discount || 0,
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
    promo_code: null,
    promo_discount: 0,
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

// ---------- deletion log ----------
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

// ---------- PROMOS ----------
r.post("/api/admin/promos", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { code, discount_percent, discount_amount, expires_at } = req.body || {};
    if (!code) return res.status(400).json({ error: "Promo code is required" });
    if (await db.promos.byCode(code))
      return res.status(409).json({ error: "That promo code already exists" });
    if (!discount_percent && !discount_amount)
      return res.status(400).json({ error: "Provide either discount_percent or discount_amount" });

    const promo = await db.promos.insert({
      code,
      discount_percent: Number(discount_percent) || 0,
      discount_amount: Number(discount_amount) || 0,
      expires_at: expires_at || null,
      created_by: req.user.id,
    });
    res.status(201).json({ promo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

r.get("/api/admin/promos", requireAuth, requireRole("admin"), async (req, res) => {
  const promos = await db.promos.all();
  res.json({ promos });
});

r.put("/api/admin/promos/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const p = await db.promos.byId(req.params.id);
  if (!p) return res.status(404).json({ error: "Promo not found" });
  const updated = await db.promos.update(p.id, req.body);
  res.json({ promo: updated });
});

r.post("/api/admin/promos/:id/revoke", requireAuth, requireRole("admin"), async (req, res) => {
  const p = await db.promos.byId(req.params.id);
  if (!p) return res.status(404).json({ error: "Promo not found" });
  await db.promos.update(p.id, { active: false });
  res.json({ ok: true, message: "Promo revoked" });
});

r.delete("/api/admin/promos/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const p = await db.promos.byId(req.params.id);
  if (!p) return res.status(404).json({ error: "Promo not found" });
  await db.promos.deleteById(p.id);
  res.json({ ok: true, message: "Promo deleted" });
});

// ---------- REFUNDS ----------
r.get("/api/admin/refunds", requireAuth, requireRole("admin"), async (req, res) => {
  const refunds = await db.refunds.all();
  const allResv = await db.reservations.all();
  const users = await db.users.all();
  const resvMap = Object.fromEntries(allResv.map((x) => [x.id, x]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  const enriched = refunds.map((r) => ({
    ...r,
    guest_name: resvMap[r.reservation_id]?.guest_name || "Guest",
    reservation_date: resvMap[r.reservation_id]?.date || "—",
    package_id: resvMap[r.reservation_id]?.package_id || "—",
    requested_by_name: userMap[r.requested_by] || "—",
    approved_by_name: r.approved_by ? (userMap[r.approved_by] || "—") : null,
    paid_by_name: r.paid_by ? (userMap[r.paid_by] || "—") : null,
    rejected_by_name: r.rejected_by ? (userMap[r.rejected_by] || "—") : null,
  }));
  res.json({ refunds: enriched });
});

r.post("/api/admin/refunds/:id/pay", requireAuth, requireRole("admin"), async (req, res) => {
  const refund = await db.refunds.byId(req.params.id);
  if (!refund) return res.status(404).json({ error: "Refund not found" });
  if (refund.status !== "approved")
    return res.status(400).json({ error: "Only approved refunds can be marked as paid" });

  const reference = (req.body?.reference_number || "").trim();
  if (!reference) return res.status(400).json({ error: "Reference number is required" });

  const updated = await db.refunds.markPaid(refund.id, req.user.id, reference);

  await db.reservations.update(refund.reservation_id, {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancelled_by: req.user.id,
    hold_expires_at: null,
  });

  res.json({ refund: updated, message: "Refund marked as paid. Reservation now cancelled." });
});

export default r;