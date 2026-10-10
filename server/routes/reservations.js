import { Router } from "../micro.js";
import db from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const r = Router();

// ---------- list packages ----------
r.get("/api/reservations/packages", async (req, res) => {
  const packages = await db.packages.all();
  res.json({ packages });
});

// ---------- availability ----------
r.get("/api/reservations/availability", async (req, res) => {
  const days = await db.reservations.activeDays();
  res.json({ days });
});

// ---------- create a reservation ----------
r.post("/api/reservations", requireAuth, async (req, res) => {
  const { package_id, date, guests, guest_name, guest_phone, guest_email } = req.body || {};
  if (!package_id || !date || !guests) return res.status(400).json({ error: "package_id, date and guests are required" });

  const pkg = await db.packages.byId(package_id);
  if (!pkg) return res.status(404).json({ error: "Package not found" });

  if (guests > (pkg.max_guests ?? 30))
    return res.status(400).json({ error: "Too many guests for this package" });

  const holdExpiry = new Date(Date.now() + 24 * 3600e3).toISOString();

  try {
    const reservation = await db.reservations.insert({
      user_id: req.user.id,
      package_id,
      date,
      guests,
      guest_name,
      guest_phone,
      guest_email,
      status: "hold",
      deposit_amount: Math.round(pkg.price / 2),
      hold_expires_at: holdExpiry,
    });
    res.status(201).json(reservation);
  } catch (err) {
    if (err.message === "one_booking_per_day")
      return res.status(409).json({ error: "That date is already taken. Pick another." });
    throw err;
  }
});

// ---------- attach a deposit proof ----------
r.post("/api/reservations/:id/deposit", requireAuth, async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });
  if (resv.user_id !== req.user.id && req.user.role === "customer")
    return res.status(403).json({ error: "Not your reservation" });

  const updated = await db.reservations.update(resv.id, {
    deposit_proof: req.body?.proof_name || "proof.jpg",
    status: "verify",
  });
  res.json(updated);
});

// ---------- list all reservations (admin only) ----------
r.get("/api/reservations", requireAuth, requireRole("admin"), async (req, res) => {
  const all = await db.reservations.all();
  const pkgs = await db.packages.all();
  const pkgMap = Object.fromEntries(pkgs.map((p) => [p.id, p]));

  const enriched = all.map((x) => ({
    ...x,
    guest: x.guest_name || "Guest",
    package: pkgMap[x.package_id]?.name || x.package_id,
    price: pkgMap[x.package_id]?.price || 0,
  }));
  res.json({ reservations: enriched });
});

// ---------- admin review (approve / reject) ----------
r.post("/api/reservations/:id/review", requireAuth, requireRole("admin"), async (req, res) => {
  const { action } = req.body || {};
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "action must be approve or reject" });

  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });

  const patch = action === "approve"
    ? { status: "approved", ref: "GVB-2026-" + String(resv.id).padStart(4, "0") }
    : { status: "rejected" };

  const updated = await db.reservations.update(resv.id, patch);
  res.json(updated);
});

// ---------- caretaker: arrivals (today + tomorrow) ----------
r.get("/api/reservations/arrivals", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

  const all = await db.reservations.all();
  const pkgs = await db.packages.all();
  const pkgMap = Object.fromEntries(pkgs.map((p) => [p.id, p]));

  const build = (rows) =>
    rows
      .filter((x) => x.status === "approved")
      .map((x) => ({
        id: x.id,
        guest: x.guest_name || "Guest",
        ref: x.ref,
        package: pkgMap[x.package_id]?.name || x.package_id,
        guests: x.guests,
        phone: x.guest_phone,
        checked_in: x.checked_in,
        checked_in_at: x.checked_in_at || null,
        note: x.caretaker_note || null,
        source: x.source || "online",
      }));

  res.json({
    arrivals: build(all.filter((x) => x.date === today)),
    tomorrow: build(all.filter((x) => x.date === tomorrow)),
    todayLabel: today,
    tomorrowLabel: tomorrow,
  });
});

// ---------- caretaker: toggle check-in (with timestamp + undo) ----------
r.post("/api/reservations/:id/checkin", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });

  if (resv.checked_in) {
    // undo
    const updated = await db.reservations.update(resv.id, {
      checked_in: 0,
      checked_in_at: null,
      checked_in_by: null,
    });
    return res.json(updated);
  }

  const updated = await db.reservations.update(resv.id, {
    checked_in: 1,
    checked_in_at: new Date().toISOString(),
    checked_in_by: req.user.id,
  });
  res.json(updated);
});

// ---------- caretaker: save a note on a reservation ----------
r.post("/api/reservations/:id/note", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });

  const note = (req.body?.note || "").slice(0, 400); // cap length
  const updated = await db.reservations.update(resv.id, { caretaker_note: note || null });
  res.json(updated);
});

// ---------- ocular visits ----------
r.post("/api/reservations/visits", requireAuth, async (req, res) => {
  const { date, time, party_size } = req.body || {};
  if (!date || !time) return res.status(400).json({ error: "date and time are required" });

  const status = (await db.reservations.activeDays())[date];
  if (status === "approved" || status === "verify")
    return res.status(409).json({ error: "That date is already booked. Choose another." });

  const visit = await db.visits.insert({
    user_id: req.user.id,
    date,
    time,
    party_size: party_size ?? 2,
  });
  res.status(201).json({ message: "Ocular visit booked for " + date + " at " + time, visit });
});

r.get("/api/reservations/visits", requireAuth, async (req, res) => {
  if (req.user.role === "customer") {
    const mine = await db.visits.byUser(req.user.id);
    const active = mine.filter((v) => !["completed", "cancelled", "no_show"].includes(v.status));
    return res.json({ visits: active });
  }
  const active = await db.visits.all();
  res.json({ visits: active });
});

// ---------- caretaker: visit arrived ----------
r.post("/api/reservations/visits/:id/arrived", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const v = await db.visits.byId(req.params.id);
  if (!v) return res.status(404).json({ error: "Visit not found" });
  if (["completed", "cancelled", "no_show"].includes(v.status))
    return res.status(400).json({ error: "Visit is already closed" });

  const updated = await db.visits.markArrived(v.id);
  res.json({ visit: updated });
});

// ---------- caretaker: visit no-show ----------
r.post("/api/reservations/visits/:id/no-show", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const v = await db.visits.byId(req.params.id);
  if (!v) return res.status(404).json({ error: "Visit not found" });
  if (["completed", "cancelled", "no_show"].includes(v.status))
    return res.status(400).json({ error: "Visit is already closed" });

  const updated = await db.visits.markNoShow(v.id, req.user.id);
  res.json({ visit: updated });
});

export default r;