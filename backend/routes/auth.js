import { Router } from "../micro.js";
import db from "../db.js";
import { sign, requireAuth, hashPassword, verifyPassword } from "../auth.js";
import { sendOtpEmail } from "../mailer.js";
import { randomInt, createHash } from "node:crypto";

const r = Router();
const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone });

// roles that must verify with OTP
const OTP_ROLES = ["admin", "manager"];

function generateOtp() { return String(randomInt(100000, 999999)); }
function hashOtp(code) { return createHash("sha256").update(code).digest("hex"); }

// helper: is this account blocked?
function isBlocked(user) {
  return user && (user.status === "suspended" || user.status === "banned");
}
function blockMessage(user) {
  return "Your account is " + user.status + ". Contact the admin.";
}

// ============================================================
// LOGIN
// ============================================================
r.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const user = await db.users.byEmail(email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Wrong email or password" });

  if (!user.password_hash || typeof user.password_hash !== "string")
    return res.status(500).json({ error: "Account has no password on file." });

  if (!verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: "Wrong email or password" });

    // ⬇️ BLOCK SUSPENDED / BANNED USERS
  if (isBlocked(user)) return res.status(403).json({ error: blockMessage(user) });

  // ⬇️ BLOCK PENDING CARETAKERS (Awaiting Admin Approval)
  if (user.status === "pending") {
    return res.status(403).json({ error: "Your account is pending admin approval. Please wait." });
  }

  // ---- staff 2FA ----
  if (OTP_ROLES.includes(user.role)) {
    try {
      const code = generateOtp();
      const code_hash = hashOtp(code);
      const expires_at = new Date(Date.now() + 5 * 60 * 1000);

      await db.otps.clearFor(user.email, "login");
      await db.otps.insert({ email: user.email, code_hash, purpose: "login", expires_at });
      await sendOtpEmail(user.email, code, { name: user.name, purpose: "login" });

      return res.json({
        otp_required: true,
        email: user.email,
        message: "A 6-digit code was sent to your email. It expires in 5 minutes.",
      });
    } catch (err) {
      console.error("[auth] failed to send OTP:", err);
      return res.status(500).json({ error: "Could not send the verification code. Try again." });
    }
  }

  // ---- normal login ----
  res.json({ user: pub(user), token: sign(user) });
});

// ============================================================
// VERIFY OTP
// ============================================================
r.post("/api/auth/otp/verify", async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: "Email and code are required" });

  const user = await db.users.byEmail(email.toLowerCase());
  if (!user) return res.status(404).json({ error: "User not found" });

  // ⬇️ BLOCK SUSPENDED / BANNED USERS (defense in depth — could have been banned mid-OTP)
  if (isBlocked(user)) return res.status(403).json({ error: blockMessage(user) });

  // ⬇️ BLOCK PENDING CARETAKERS (Awaiting Admin Approval)
  if (user.status === "pending") {
    return res.status(403).json({ error: "Your account is pending admin approval. Please wait." });
  }

  const record = await db.otps.latestFor(user.email, "login");
  if (!record) return res.status(400).json({ error: "No active code. Please log in again." });

  if (new Date(record.expires_at) < new Date())
    return res.status(400).json({ error: "That code has expired. Please log in again." });

  if (record.attempts >= 5) {
    await db.otps.markUsed(record._id);
    return res.status(429).json({ error: "Too many wrong attempts. Please log in again." });
  }

  if (hashOtp(String(code).trim()) !== record.code_hash) {
    await db.otps.bumpAttempts(record._id);
    return res.status(401).json({ error: "That code is not correct." });
  }

  await db.otps.markUsed(record._id);
  res.json({ user: pub(user), token: sign(user) });
});

// ============================================================
// RESEND OTP
// ============================================================
r.post("/api/auth/otp/resend", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });

  const user = await db.users.byEmail(email.toLowerCase());
  if (!user || !OTP_ROLES.includes(user.role))
    return res.status(404).json({ error: "No OTP-login account for that email" });

  // ⬇️ BLOCK SUSPENDED / BANNED USERS
  if (isBlocked(user)) return res.status(403).json({ error: blockMessage(user) });

  // ⬇️ BLOCK PENDING CARETAKERS (Awaiting Admin Approval)
  if (user.status === "pending") {
    return res.status(403).json({ error: "Your account is pending admin approval. Please wait." });
  }

  try {
    const code = generateOtp();
    const code_hash = hashOtp(code);
    const expires_at = new Date(Date.now() + 5 * 60 * 1000);

    await db.otps.clearFor(user.email, "login");
    await db.otps.insert({ email: user.email, code_hash, purpose: "login", expires_at });
    await sendOtpEmail(user.email, code, { name: user.name, purpose: "login" });

    res.json({ ok: true, message: "A new code was sent." });
  } catch (err) {
    console.error("[auth] failed to resend OTP:", err);
    res.status(500).json({ error: "Could not send the code. Try again." });
  }
});

// ============================================================
// GUEST
// ============================================================
r.post("/api/auth/guest", async (req, res) => {
  const GUEST_EMAIL = "guest@goldenvb.ph";
  let user = await db.users.byEmail(GUEST_EMAIL);
  if (!user) {
    user = await db.users.insert({
      name: "Guest Customer", email: GUEST_EMAIL,
      password_hash: hashPassword("12345678"),
      role: "customer", phone: null,
    });
  }
  // ⬇️ BLOCK SUSPENDED / BANNED GUEST (rare, but consistent)
  if (isBlocked(user)) return res.status(403).json({ error: blockMessage(user) });

  res.json({ user: pub(user), token: sign(user) });
});

// ============================================================
// CARETAKER SELF-REGISTRATION (Needs Admin Approval)
// ============================================================
r.post("/api/auth/register-caretaker", async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email and password are required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (await db.users.byEmail(email.toLowerCase()))
    return res.status(409).json({ error: "That email is already registered" });

  // Create the user, but force the status to "pending"
  const user = await db.users.insert({
    name, 
    email: email.toLowerCase(),
    password_hash: hashPassword(password),
    role: "caretaker", 
    phone: phone || null,
    status: "pending" // force pending approval
  });
  
  // Note: We DO NOT return a token. They cannot log in yet.
  res.status(201).json({ 
    message: "Registration successful. Please wait for the admin to approve your account." 
  });
});

// ============================================================
// APPLY WITH INVITE CODE
// ============================================================
r.post("/api/auth/apply-admin", async (req, res) => {
  const { name, email, password, phone, code } = req.body || {};
  if (!name || !email || !password || !code)
    return res.status(400).json({ error: "Name, email, password and invite code are required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  const lower = email.toLowerCase();
  if (await db.users.byEmail(lower))
    return res.status(409).json({ error: "That email is already registered" });

  const invite = await db.invites.byCode(code.trim().toUpperCase());
  if (!invite) return res.status(403).json({ error: "That invite code is not valid" });
  if (invite.email !== lower) return res.status(403).json({ error: "This code was issued for a different email" });
  if (invite.used_at) return res.status(403).json({ error: "This invite has already been used" });
  if (invite.revoked) return res.status(403).json({ error: "This invite has been revoked" });
  if (new Date(invite.expires_at) < new Date())
    return res.status(403).json({ error: "This invite has expired." });

  const user = await db.users.insert({
    name, email: lower,
    password_hash: hashPassword(password),
    role: invite.role, phone: phone || null,
  });
  await db.invites.markUsed(invite.id, user.id);
  res.status(201).json({ user: pub(user), token: sign(user) });
});

// ============================================================
// whoami
// ============================================================
r.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await db.users.byId(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  // ⬇️ BLOCK SUSPENDED / BANNED USERS
  if (isBlocked(user)) return res.status(403).json({ error: blockMessage(user) });

  res.json({ user: pub(user) });
});

export default r;