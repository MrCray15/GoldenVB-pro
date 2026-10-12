import { createHash, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const b64url = (buf) => Buffer.from(buf).toString("base64url");

export const hashPassword = (pw) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pw, salt, 32).toString("hex");
};

export const verifyPassword = (pw, stored) => {
  const [salt, hash] = stored.split(":");
  const calc = scryptSync(pw, salt, 32);
  return timingSafeEqual(Buffer.from(hash, "hex"), calc);
};

export const sign = (user) => {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 7 * 86400,
    })
  );
  const sig = createHash("sha256")
    .update(header + "." + payload + "." + SECRET)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
};

const verifyToken = (token) => {
  const [h, p, s] = token.split(".");
  const expect = createHash("sha256")
    .update(h + "." + p + "." + SECRET)
    .digest("base64url");
  if (s !== expect) return null;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (payload.exp < Date.now() / 1000) return null;
  return payload;
};

export const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Not logged in or session expired" });
  req.user = payload;
  next();
};

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "You don't have access to that" });
    next();
  };