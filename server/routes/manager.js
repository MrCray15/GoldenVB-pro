import { Router } from "../micro.js";
import db from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const r = Router();
const managerOnly = [requireAuth, requireRole("manager")];

// ---------- dashboard overview ----------
r.get("/api/manager/overview", ...managerOnly, async (req, res) => {
  const all = await db.reservations.all();
  const today = new Date().toISOString().slice(0, 10);

  const pending   = all.filter((x) => x.status === "verify");
  const holds     = all.filter((x) => x.status === "hold");
  const approved  = all.filter((x) => x.status === "approved");
  const todayList = all.filter((x) => x.date === today);

  res.json({
    today: todayList,
    queue: { pending: pending.length, holds: holds.length },
    approved: approved.length,
    pending_list: pending,
  });
});

// ---------- queue ----------
r.get("/api/manager/queue", ...managerOnly, async (req, res) => {
  const all = await db.reservations.all();
  const queue = all
    .filter((x) => ["hold", "verify", "approved"].includes(x.status))
    .sort((a, b) => (a.date > b.date ? 1 : -1));
  res.json({ queue });
});

// ---------- schedule ----------
r.get("/api/manager/schedule", ...managerOnly, async (req, res) => {
  const all = await db.reservations.all();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cutoff = new Date(now.getTime() + 30 * 86400e3).toISOString().slice(0, 10);

  const schedule = all
    .filter((x) => x.status === "approved" && x.date >= today && x.date <= cutoff)
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  res.json({ schedule });
});

// ---------- payments ----------
r.get("/api/manager/payments", ...managerOnly, async (req, res) => {
  const all = await db.reservations.all();
  const payments = all
    .filter((x) => x.deposit_amount != null)
    .map((x) => ({
      id: x.id,
      ref: x.ref,
      guest_name: x.guest_name,
      guest_email: x.guest_email,
      date: x.date,
      deposit_amount: x.deposit_amount,
      deposit_proof: x.deposit_proof,
      status: x.status,
      source: x.source,
    }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));
  res.json({ payments });
});

// ---------- CREATE: walk-in booking ----------
r.post("/api/manager/walk-in", ...managerOnly, async (req, res) => {
  const {
    guest_name, guest_phone, guest_email,
    package_id, date, guests, deposit_amount,
  } = req.body || {};

  if (!guest_name || !guest_phone || !package_id || !date || !guests)
    return res.status(400).json({ error: "guest_name, guest_phone, package_id, date, and guests are required" });

  const guestsNum = Number(guests);
  if (!Number.isFinite(guestsNum) || guestsNum < 1)
    return res.status(400).json({ error: "guests must be a positive number" });

  const pkg = await db.packages.byId(package_id);
  if (!pkg) return res.status(404).json({ error: "Package not found" });

  if (guestsNum > (pkg.max_guests ?? 30))
    return res.status(400).json({ error: `Too many guests — max for this package is ${pkg.max_guests ?? 30}` });

  const already = await db.reservations.bookedOn(date);
  if (already) return res.status(409).json({ error: "That date is already booked. Pick another." });

  const deposit = (typeof deposit_amount === "number" && deposit_amount >= 0)
    ? deposit_amount
    : Math.round(pkg.price / 2);

  try {
    const r1 = await db.reservations.insert({
      user_id: null,
      package_id,
      date,
      guests: guestsNum,
      status: "approved",
      deposit_amount: deposit,
      deposit_proof: "walk-in · paid on site",
      hold_expires_at: null,
      guest_name,
      guest_phone,
      guest_email: guest_email || null,
      source: "walk-in",
      created_by: req.user.id,
      ref: null,
    });
    res.status(201).json({ reservation: r1, message: `Walk-in booking #${r1.id} created` });
  } catch (err) {
    if (err.message === "one_booking_per_day")
      return res.status(409).json({ error: "That date is already taken" });
    throw err;
  }
});

// ---------- verify a deposit ----------
r.post("/api/manager/reservations/:id/verify", ...managerOnly, async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });
  if (!["verify", "hold"].includes(resv.status))
    return res.status(400).json({ error: "Only pending or held reservations can be verified" });

  const updated = await db.reservations.update(resv.id, { status: "approved" });
  res.json({ reservation: updated });
});

// ---------- cancel a reservation ----------
r.post("/api/manager/reservations/:id/cancel", ...managerOnly, async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });
  if (resv.status === "cancelled") return res.status(400).json({ error: "Already cancelled" });

  const updated = await db.reservations.cancel(resv.id, req.user.id);
  res.json({ reservation: updated });
});

// ---------- complete a reservation ----------
r.post("/api/manager/reservations/:id/complete", ...managerOnly, async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });
  if (resv.status === "completed") return res.status(400).json({ error: "Already completed" });
  if (resv.status !== "approved") return res.status(400).json({ error: "Only approved reservations can be completed" });

  const updated = await db.reservations.complete(resv.id, req.user.id);
  res.json({ reservation: updated });
});

// ---------- DELETE: hard-delete a closed reservation ----------
r.delete("/api/manager/reservations/:id", ...managerOnly, async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });

  const deletable = ["cancelled", "rejected", "completed"];
  if (!deletable.includes(resv.status))
    return res.status(400).json({ error: "Only cancelled, rejected, or completed reservations can be deleted" });

  await db.deletedRecords.log("reservation", resv, req.user.id, req.body?.reason || null);
  await db.reservations.deleteById(resv.id);

  res.json({ ok: true, deleted: resv.id, message: `Reservation #${resv.id} permanently deleted` });
});

// ---------- complete a visit ----------
r.post("/api/manager/visits/:id/complete", ...managerOnly, async (req, res) => {
  const v = await db.visits.byId(req.params.id);
  if (!v) return res.status(404).json({ error: "Visit not found" });
  if (["completed", "cancelled"].includes(v.status))
    return res.status(400).json({ error: "Visit is already closed" });

  const updated = await db.visits.complete(v.id, req.user.id);
  res.json({ visit: updated });
});

// ---------- cancel a visit ----------
r.post("/api/manager/visits/:id/cancel", ...managerOnly, async (req, res) => {
  const v = await db.visits.byId(req.params.id);
  if (!v) return res.status(404).json({ error: "Visit not found" });
  if (["completed", "cancelled"].includes(v.status))
    return res.status(400).json({ error: "Visit is already closed" });

  const updated = await db.visits.cancel(v.id, req.user.id);
  res.json({ visit: updated });
});

// ---------- DELETE: hard-delete a closed visit ----------
r.delete("/api/manager/visits/:id", ...managerOnly, async (req, res) => {
  const v = await db.visits.byId(req.params.id);
  if (!v) return res.status(404).json({ error: "Visit not found" });

  const deletable = ["cancelled", "completed"];
  if (!deletable.includes(v.status))
    return res.status(400).json({ error: "Only cancelled or completed visits can be deleted" });

  await db.deletedRecords.log("visit", v, req.user.id, req.body?.reason || null);
  await db.visits.deleteById(v.id);

  res.json({ ok: true, deleted: v.id, message: `Visit #${v.id} permanently deleted` });
});

// ---------- calendar ----------
r.get("/api/manager/calendar", ...managerOnly, async (req, res) => {
  const [allResv, activeVisits] = await Promise.all([
    db.reservations.all(),
    db.visits.all(),
  ]);

  const byDate = {};
  for (const r of allResv) {
    if (r.status === "cancelled" || r.status === "rejected") continue;
    if (!byDate[r.date]) byDate[r.date] = { date: r.date, bookings: [], visits: [] };
    byDate[r.date].bookings.push({
      id: r.id,
      guest: r.guest_name || "Guest",
      guests: r.guests,
      package_id: r.package_id,
      status: r.status,
      ref: r.ref,
      deposit_amount: r.deposit_amount,
      source: r.source,
    });
  }

  for (const v of activeVisits) {
    if (!byDate[v.date]) byDate[v.date] = { date: v.date, bookings: [], visits: [] };
    byDate[v.date].visits.push({
      id: v.id,
      time: v.time,
      party_size: v.party_size,
      status: v.status,
    });
  }

  const days = Object.values(byDate).sort((a, b) => (a.date > b.date ? 1 : -1));
  res.json({ days });
});

// ---------- caretakers ----------
r.get("/api/manager/caretakers", ...managerOnly, async (req, res) => {
  const all = await db.users.all();
  const caretakers = all
    .filter((u) => u.role === "caretaker")
    .map(({ password_hash, ...u }) => u);
  res.json({ caretakers });
});

export default r;