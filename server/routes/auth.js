import { Router } from "../micro.js";
import db from "../db.js";
import { sign, requireAuth, hashPassword, verifyPassword } from "../auth.js";

const r = Router();

const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone });

// ---------- STAFF LOGIN (with role check) ----------
r.post("/api/auth/login", async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const user = await db.users.byEmail(email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Wrong email or password" });

  if (!user.password_hash || typeof user.password_hash !== "string")
    return res.status(500).json({ error: "This account has no password on file. Re-run the seed." });

  if (!verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: "Wrong email or password" });

  // role check: if the frontend sent a role, it must match
  if (role && user.role !== role) {
    return res.status(403).json({
      error: `This account is not registered as ${role}. Try the correct role.`,
    });
  }

  res.json({ user: pub(user), token: sign(user) });
});

// ---------- GUEST CUSTOMER (one click) ----------
r.post("/api/auth/guest", async (req, res) => {
  const GUEST_EMAIL = "guest@goldenvb.ph";
  let user = await db.users.byEmail(GUEST_EMAIL);
  if (!user) {
    user = await db.users.insert({
      name: "Guest Customer",
      email: GUEST_EMAIL,
      password_hash: hashPassword("12345678"),
      role: "customer",
      phone: null,
    });
  }
  res.json({ user: pub(user), token: sign(user) });
});

// ---------- CARETAKER SELF-REGISTRATION ----------
r.post("/api/auth/register-caretaker", async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email and password are required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (await db.users.byEmail(email.toLowerCase()))
    return res.status(409).json({ error: "That email is already registered" });

  const user = await db.users.insert({
    name,
    email: email.toLowerCase(),
    password_hash: hashPassword(password),
    role: "caretaker",
    phone: phone || null,
  });
  res.status(201).json({ user: pub(user), token: sign(user) });
});

// ---------- whoami ----------
r.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await db.users.byId(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: pub(user) });
});

export default r;