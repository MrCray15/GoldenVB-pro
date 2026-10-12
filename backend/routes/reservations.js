import { Router } from "../micro.js";
import db from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { sendOtpEmail, sendReservationVoucherEmail } from "../mailer.js";
import { randomInt, createHash } from "node:crypto";

const r = Router();

function generateOtp() { return String(randomInt(100000, 999999)); }
function hashOtp(code) { return createHash("sha256").update(code).digest("hex"); }

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

// ---------- check a promo code ----------
r.post("/api/reservations/check-promo", requireAuth, async (req, res) => {
  const { code, package_id } = req.body || {};
  if (!code) return res.status(400).json({ error: "Promo code required" });

  const promo = await db.promos.validate(code);
  if (!promo) return res.status(404).json({ error: "Invalid or expired promo" });

  let preview = null;
  if (package_id) {
    const pkg = await db.packages.byId(package_id);
    if (pkg) {
      let newPrice = pkg.price;
      if (promo.discount_percent) newPrice = Math.round(pkg.price * (1 - promo.discount_percent / 100));
      else if (promo.discount_amount) newPrice = Math.max(0, pkg.price - promo.discount_amount);
      preview = { original: pkg.price, discounted: newPrice, savings: pkg.price - newPrice };
    }
  }

  res.json({
    promo: {
      code: promo.code,
      discount_percent: promo.discount_percent,
      discount_amount: promo.discount_amount,
    },
    preview,
  });
});

// ---------- create a reservation ----------
r.post("/api/reservations", requireAuth, async (req, res) => {
  const { package_id, date, guests, guest_name, guest_phone, guest_email, promo_code } = req.body || {};
  if (!package_id || !date || !guests)
    return res.status(400).json({ error: "package_id, date and guests are required" });
  if (!guest_name || !String(guest_name).trim())
    return res.status(400).json({ error: "Guest name is required" });
  if (!guest_phone || !String(guest_phone).trim())
    return res.status(400).json({ error: "Mobile number is required" });
  if (!guest_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(guest_email).trim()))
    return res.status(400).json({ error: "A valid email address is required" });

  const pkg = await db.packages.byId(package_id);
  if (!pkg) return res.status(404).json({ error: "Package not found" });

  if (guests > (pkg.max_guests ?? 30))
    return res.status(400).json({ error: "Too many guests for this package" });

  let promo = null;
  let discountedPrice = pkg.price;
  if (promo_code) {
    promo = await db.promos.validate(promo_code);
    if (!promo) return res.status(400).json({ error: "Invalid or expired promo code" });
    if (promo.discount_percent) discountedPrice = Math.round(pkg.price * (1 - promo.discount_percent / 100));
    else if (promo.discount_amount) discountedPrice = Math.max(0, pkg.price - promo.discount_amount);
  }

  const holdExpiry = new Date(Date.now() + 24 * 3600e3).toISOString();

  try {
    const reservation = await db.reservations.insert({
      user_id: req.user.id,
      package_id,
      date,
      guests,
      guest_name: String(guest_name).trim(),
      guest_phone: String(guest_phone).trim(),
      guest_email: String(guest_email).trim().toLowerCase(),
      status: "hold",
      deposit_amount: Math.round(discountedPrice / 2),
      promo_code: promo ? promo.code : null,
      promo_discount: promo ? (pkg.price - discountedPrice) : 0,
      hold_expires_at: holdExpiry,
    });

    // Fire-and-forget voucher email — don't block the response
    sendReservationVoucherEmail(reservation.guest_email, reservation, pkg)
      .catch((e) => console.error("[reservations] voucher email failed:", e.message));

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

// ============================================================
// PUBLIC LOOKUP — 3-step OTP flow
// ============================================================

async function findBookingByRefAndName(ref, name) {
  const wantedRef = String(ref || "").trim().toUpperCase();
  const wantedName = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!wantedRef || !wantedName) return { error: "Reference number and name are required" };

  const all = await db.reservations.history();
  const match = all.find((x) =>
    (x.ref && String(x.ref).toUpperCase() === wantedRef) ||
    (`GVB-2026-${String(x.id).padStart(4, "0")}` === wantedRef)
  );
  if (!match) return { error: "No booking found for that reference", status: 404 };

  const bookedName = String(match.guest_name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!bookedName || bookedName !== wantedName)
    return { error: "Name does not match this booking", status: 403 };

  let ownerEmail = (match.guest_email || "").trim().toLowerCase();
  if (!ownerEmail && match.user_id) {
    const u = await db.users.byId(match.user_id);
    ownerEmail = (u?.email || "").trim().toLowerCase();
  }
  if (!ownerEmail)
    return { error: "This booking has no email on file. Please call 0917 555 0101 for help.", status: 400 };

  return { match, ownerEmail };
}

// ---------- STEP 1: start OTP ----------
r.post("/api/reservations/lookup/start", async (req, res) => {
  const { ref, name } = req.body || {};
  const found = await findBookingByRefAndName(ref, name);
  if (found.error) return res.status(found.status || 400).json({ error: found.error });

  const { match, ownerEmail } = found;

  try {
    const code = generateOtp();
    const code_hash = hashOtp(code);
    const expires_at = new Date(Date.now() + 5 * 60 * 1000);
    const purpose = `refund-lookup:${match.id}`;

    await db.otps.clearFor(ownerEmail, purpose);
    await db.otps.insert({ email: ownerEmail, code_hash, purpose, expires_at });
    await sendOtpEmail(ownerEmail, code, { name: match.guest_name, purpose: "refund" });

    const [local, domain] = ownerEmail.split("@");
    const maskedLocal = local.length <= 2
      ? local[0] + "*"
      : local[0] + "*".repeat(local.length - 2) + local.slice(-1);
    const maskedEmail = `${maskedLocal}@${domain}`;

    res.json({
      ok: true,
      reservation_id: match.id,
      ref: match.ref || `GVB-2026-${String(match.id).padStart(4, "0")}`,
      maskedEmail,
      message: `A 6-digit code was sent to ${maskedEmail}. It expires in 5 minutes.`,
    });
  } catch (err) {
    console.error("[lookup] failed to send OTP:", err);
    res.status(500).json({ error: "Could not send the verification code. Try again." });
  }
});

// ---------- STEP 1b: resend OTP ----------
r.post("/api/reservations/lookup/resend", async (req, res) => {
  const { ref, name } = req.body || {};
  const found = await findBookingByRefAndName(ref, name);
  if (found.error) return res.status(found.status || 400).json({ error: found.error });

  const { match, ownerEmail } = found;
  try {
    const code = generateOtp();
    const code_hash = hashOtp(code);
    const expires_at = new Date(Date.now() + 5 * 60 * 1000);
    const purpose = `refund-lookup:${match.id}`;
    await db.otps.clearFor(ownerEmail, purpose);
    await db.otps.insert({ email: ownerEmail, code_hash, purpose, expires_at });
    await sendOtpEmail(ownerEmail, code, { name: match.guest_name, purpose: "refund" });
    res.json({ ok: true, message: "A new code was sent." });
  } catch (err) {
    console.error("[lookup] failed to resend OTP:", err);
    res.status(500).json({ error: "Could not send the code. Try again." });
  }
});

// ---------- STEP 2: verify OTP → return details ----------
r.post("/api/reservations/lookup/verify", async (req, res) => {
  const { ref, name, code } = req.body || {};
  if (!code) return res.status(400).json({ error: "Enter the 6-digit code" });

  const found = await findBookingByRefAndName(ref, name);
  if (found.error) return res.status(found.status || 400).json({ error: found.error });

  const { match, ownerEmail } = found;
  const purpose = `refund-lookup:${match.id}`;

  const record = await db.otps.latestFor(ownerEmail, purpose);
  if (!record) return res.status(400).json({ error: "No active code. Please start again." });

  if (new Date(record.expires_at) < new Date())
    return res.status(400).json({ error: "That code has expired. Please start again." });

  if (record.attempts >= 5) {
    await db.otps.markUsed(record._id);
    return res.status(429).json({ error: "Too many wrong attempts. Please start again." });
  }

  if (hashOtp(String(code).trim()) !== record.code_hash) {
    await db.otps.bumpAttempts(record._id);
    return res.status(401).json({ error: "That code is not correct." });
  }

  await db.otps.markUsed(record._id);

  const token = "RT-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const token_hash = hashOtp(token);
  const token_expires_at = new Date(Date.now() + 10 * 60 * 1000);
  await db.otps.clearFor(ownerEmail, `refund-token:${match.id}`);
  await db.otps.insert({
    email: ownerEmail,
    code_hash: token_hash,
    purpose: `refund-token:${match.id}`,
    expires_at: token_expires_at,
  });

  const pkgs = await db.packages.all();
  const pkgMap = Object.fromEntries(pkgs.map((p) => [p.id, p]));
  const refunds = await db.refunds.byReservation(match.id);
  const activeRefund = refunds.find((x) => ["pending", "approved", "paid"].includes(x.status)) || null;

  let refundEligible = false;
  let refundBlockedReason = null;
  if (match.status !== "approved") {
    refundBlockedReason = "Only approved bookings can be refunded. Current status: " + match.status;
  } else {
    const eventDate = new Date(match.date + "T00:00:00");
    const daysUntil = Math.floor((eventDate - Date.now()) / 86400e3);
    if (daysUntil < 7) refundBlockedReason = "Refunds are only allowed at least 7 days before the check-in date.";
    else if (activeRefund) refundBlockedReason = "A refund for this booking is already " + activeRefund.status + ".";
    else refundEligible = true;
  }

  res.json({
    reservation: {
      id: match.id,
      ref: match.ref || `GVB-2026-${String(match.id).padStart(4, "0")}`,
      guest_name: match.guest_name || "Guest",
      guest_phone: match.guest_phone || null,
      date: match.date,
      guests: match.guests,
      status: match.status,
      package_id: match.package_id,
      package_name: pkgMap[match.package_id]?.name || match.package_id,
      package_price: pkgMap[match.package_id]?.price || 0,
      deposit_amount: match.deposit_amount || 0,
      promo_code: match.promo_code || null,
      promo_discount: match.promo_discount || 0,
      created_at: match.created_at,
    },
    refund: activeRefund,
    refundEligible,
    refundBlockedReason,
    refundDefaultAmount: Math.round((match.deposit_amount || 0) * 0.8),
    refundToken: token,
  });
});

// ---------- STEP 3: request refund ----------
r.post("/api/reservations/lookup/refund", async (req, res) => {
  const { ref, name, refundToken, reason, method } = req.body || {};
  if (!refundToken) return res.status(400).json({ error: "Verification required" });

  const found = await findBookingByRefAndName(ref, name);
  if (found.error) return res.status(found.status || 400).json({ error: found.error });

  const { match, ownerEmail } = found;
  const purpose = `refund-token:${match.id}`;

  const record = await db.otps.latestFor(ownerEmail, purpose);
  if (!record) return res.status(400).json({ error: "Your session expired. Please look up your booking again." });
  if (new Date(record.expires_at) < new Date())
    return res.status(400).json({ error: "Your session expired. Please look up your booking again." });
  if (hashOtp(String(refundToken).trim()) !== record.code_hash)
    return res.status(403).json({ error: "Invalid verification token" });

  if (match.status !== "approved")
    return res.status(400).json({ error: "Only approved reservations can be refunded" });

  const eventDate = new Date(match.date + "T00:00:00");
  const daysUntil = Math.floor((eventDate - Date.now()) / 86400e3);
  if (daysUntil < 7)
    return res.status(400).json({ error: "Refunds are only allowed at least 7 days before the check-in date." });

  const existing = await db.refunds.byReservation(match.id);
  const active = existing.find((x) => ["pending", "approved"].includes(x.status));
  if (active) return res.status(409).json({ error: "A refund for this booking is already " + active.status });

  const amount = Math.round((match.deposit_amount || 0) * 0.8);

  const refund = await db.refunds.insert({
    reservation_id: match.id,
    amount,
    reason: reason || "Customer cancellation",
    method: method || "GCash",
    requested_by: null,
  });

  await db.otps.markUsed(record._id);

  res.status(201).json({
    refund,
    message: `Refund request submitted: ₱${amount.toLocaleString("en-PH")} (80% of deposit, 20% cancellation fee).`,
  });
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

// ---------- admin review ----------
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

// ---------- customer: request a refund (logged-in) ----------
r.post("/api/reservations/:id/refund-request", requireAuth, async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });

  if (req.user.role === "customer" && resv.user_id !== req.user.id)
    return res.status(403).json({ error: "Not your reservation" });

  if (resv.status !== "approved")
    return res.status(400).json({ error: "Only approved reservations can be refunded" });

  const eventDate = new Date(resv.date + "T00:00:00");
  const daysUntil = Math.floor((eventDate - Date.now()) / 86400e3);
  if (daysUntil < 7)
    return res.status(400).json({ error: "Refunds are only allowed at least 7 days before the check-in date." });

  const existing = await db.refunds.byReservation(resv.id);
  const active = existing.find((x) => ["pending", "approved"].includes(x.status));
  if (active) return res.status(409).json({ error: "A refund for this reservation is already " + active.status });

  const amount = Math.round(resv.deposit_amount * 0.8);

  const refund = await db.refunds.insert({
    reservation_id: resv.id,
    amount,
    reason: req.body?.reason || "Customer cancellation",
    method: req.body?.method || "GCash",
    requested_by: req.user.id,
  });

  res.status(201).json({
    refund,
    message: `Refund request submitted: ₱${amount.toLocaleString("en-PH")} (80% of deposit, 20% cancellation fee).`,
  });
});

// ---------- caretaker: arrivals ----------
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

r.post("/api/reservations/:id/checkin", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });

  if (resv.checked_in) {
    const updated = await db.reservations.update(resv.id, {
      checked_in: 0, checked_in_at: null, checked_in_by: null,
    });
    return res.json(updated);
  }

  const updated = await db.reservations.update(resv.id, {
    checked_in: 1, checked_in_at: new Date().toISOString(), checked_in_by: req.user.id,
  });
  res.json(updated);
});

r.post("/api/reservations/:id/note", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const resv = await db.reservations.byId(req.params.id);
  if (!resv) return res.status(404).json({ error: "Reservation not found" });
  const note = (req.body?.note || "").slice(0, 400);
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
    user_id: req.user.id, date, time, party_size: party_size ?? 2,
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

r.post("/api/reservations/visits/:id/arrived", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const v = await db.visits.byId(req.params.id);
  if (!v) return res.status(404).json({ error: "Visit not found" });
  if (["completed", "cancelled", "no_show"].includes(v.status))
    return res.status(400).json({ error: "Visit is already closed" });
  const updated = await db.visits.markArrived(v.id);
  res.json({ visit: updated });
});

r.post("/api/reservations/visits/:id/no-show", requireAuth, requireRole("caretaker", "admin"), async (req, res) => {
  const v = await db.visits.byId(req.params.id);
  if (!v) return res.status(404).json({ error: "Visit not found" });
  if (["completed", "cancelled", "no_show"].includes(v.status))
    return res.status(400).json({ error: "Visit is already closed" });
  const updated = await db.visits.markNoShow(v.id, req.user.id);
  res.json({ visit: updated });
});

export default r;