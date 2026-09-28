import { Router } from "../micro.js";
import db from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const r = Router();
const isoDate = (d) => d.toLocaleDateString("sv-SE");

// ---------- public ----------
r.get("/api/reservations/packages", async (req, res) => {
  res.json({ packages: await db.packages.all() });
});

r.get("/api/reservations/availability", async (req, res) => {
  res.json({ days: await db.reservations.activeDays() });
});

// ---------- customer: create a 24h hold ----------
r.post("/api/reservations", requireAuth, requireRole("customer", "admin"), async (req, res) => {
  const { package_id, date, guests, guest_name, guest_phone, guest_email } = req.body || {};
  const pkg = await db.packages.byId(package_id);
  if (!pkg || !date || !guests)
    return res.status(400).json({ error: "Package, date and guests are required" });
  if (guests > pkg.max_guests)
    return res.status(400).json({ error: `Max ${pkg.max_guests} guests for ${pkg.name}` });

  try {
    const row = await db.reservations.insert({
      user_id: req.user.id,
      package_id,
      date,
      guests,
      deposit_amount: Math.round(pkg.price / 2),
      hold_expires_at: new Date(Date.now() + 24 * 3600e3).toISOString(),
      // 👇 the guest's real name/contact, captured by the booking form
      guest_name: guest_name || null,
      guest_phone: guest_phone || null,
      guest_email: guest_email || null,
    });
    res.status(201).json({
      id: row.id,
      message: "Date held for 24 hours. Upload your deposit to confirm.",
    });
  } catch (e) {
    if (e.message === "one_booking_per_day")
      return res.status(409).json({ error: "That date is already taken. Pick another one." });
    throw e;
  }
});

// ---------- upload deposit proof → verify ----------
r.post("/api/reservations/:id/deposit", requireAuth, async (req, res) => {
  const row = await db.reservations.byId(req.params.id);
  if (!row || (row.user_id !== req.user.id && req.user.role !== "admin"))
    return res.status(404).json({ error: "Reservation not found" });
  await db.reservations.update(row.id, {
    deposit_proof: req.body?.proof_name || "deposit.jpg",
    status: "verify",
  });
  res.json({ message: "Deposit submitted. The admin will verify it shortly." });
});

// ---------- list (scoped by role) ----------
r.get("/api/reservations", requireAuth, async (req, res) => {
  const raw =
    req.user.role === "customer"
      ? (await db.reservations.byUser(req.user.id)).reverse()
      : await db.reservations.all();

  const [users, pkgs] = await Promise.all([db.users.all(), db.packages.all()]);
  const uMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const pMap = Object.fromEntries(pkgs.map((p) => [p.id, p]));

  const rows = raw.map((r) => ({
    ...r,
    // prefer the guest name captured at booking time; fall back to the account name
    guest: r.guest_name || uMap[r.user_id]?.name || "Guest",
    phone: r.guest_phone || uMap[r.user_id]?.phone || null,
    package: pMap[r.package_id]?.name,
    price: pMap[r.package_id]?.price,
  }));
  res.json({ reservations: rows });
});

// ---------- admin review ----------
r.post("/api/reservations/:id/review", requireAuth, requireRole("admin"), async (req, res) => {
  const row = await db.reservations.byId(req.params.id);
  if (!row) return res.status(404).json({ error: "Reservation not found" });

  const { action } = req.body || {};
  if (action === "approve") {
    const ref = "GVB-2026-" + String(row.id).padStart(4, "0");
    await db.reservations.update(row.id, { status: "approved", ref });
    return res.json({ message: "Approved. Voucher " + ref + " issued.", ref });
  }
  if (action === "reject") {
    await db.reservations.update(row.id, { status: "rejected", hold_expires_at: null });
    return res.json({ message: "Rejected. The guest has been notified." });
  }
  res.status(400).json({ error: "action must be approve or reject" });
});

// ---------- caretaker: today's arrivals + check-in ----------
r.get("/api/reservations/arrivals", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const today = isoDate(new Date());
  const all = await db.reservations.all();
  const todays = all.filter((x) => x.date === today && x.status === "approved");

  const [users, pkgs] = await Promise.all([db.users.all(), db.packages.all()]);
  const uMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const pMap = Object.fromEntries(pkgs.map((p) => [p.id, p]));

  const arrivals = todays.map((x) => ({
    id: x.id,
    ref: x.ref,
    guests: x.guests,
    checked_in: x.checked_in,
    guest: x.guest_name || uMap[x.user_id]?.name || "Guest",
    package: pMap[x.package_id]?.name,
  }));
  res.json({ arrivals });
});

r.post("/api/reservations/:id/checkin", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const row = await db.reservations.byId(req.params.id);
  if (!row) return res.status(404).json({ error: "Reservation not found" });
  const next = row.checked_in ? 0 : 1;
  await db.reservations.update(row.id, { checked_in: next });
  res.json({ id: row.id, checked_in: !!next });
});

// ---------- system: expire unpaid holds ----------
r.post("/api/reservations/expire-holds", async (req, res) => {
  res.json({ expired: await db.reservations.expireHolds(new Date().toISOString()) });
});

// ---------- ocular visits ----------
r.post("/api/reservations/visits", requireAuth, async (req, res) => {
  const { date, time, party_size } = req.body || {};
  if (!date || !time) return res.status(400).json({ error: "Date and time are required" });
  if (await db.reservations.bookedOn(date))
    return res.status(409).json({ error: "The resort is reserved that day. Pick a free date." });

  const row = await db.visits.insert({
    user_id: req.user.id,
    date,
    time,
    party_size: party_size || 2,
  });
  res.status(201).json({ id: row.id, message: "Ocular visit scheduled. See you there!" });
});

r.get("/api/reservations/visits", requireAuth, async (req, res) => {
  const raw =
    req.user.role === "customer"
      ? await db.visits.byUser(req.user.id)
      : await db.visits.all();

  const users = await db.users.all();
  const uMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const rows = raw.map((v) => ({
    ...v,
    guest: v.guest_name || uMap[v.user_id]?.name || "",
  }));
  res.json({ visits: rows });
});

export default r;