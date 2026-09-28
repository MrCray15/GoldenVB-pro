import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/auth.js";
import reservationRoutes from "./routes/reservations.js";
import reportRoutes from "./routes/reports.js";

const PORT = process.env.PORT || 3001;
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const routers = [authRoutes, reservationRoutes, reportRoutes];

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host}`);
  req.path = url.pathname;

  // json helpers
  res.status = (code) => ({ json: (obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); } });
  res.json = (obj) => res.status(200).json(obj);

  // body
  let body = "";
  for await (const chunk of req) body += chunk;
  try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }

  // static files (the whole frontend)
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    const rel = req.path === "/" ? "/index.html" : req.path;
    const file = path.normalize(path.join(PUBLIC, rel));
    if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
      return res.end(fs.readFileSync(file));
    }
  }

  try {
    for (const r of routers) if (await r.handle(req, res)) return;
    res.status(404).json({ error: "Not found" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

server.listen(PORT, () => console.log(`Golden VB API running on http://localhost:${PORT}`));

// expire pencil bookings every minute
import db from "./db.js";
setInterval(() => {
  db.reservations.expireHolds(new Date().toISOString())
    .then((n) => { if (n) console.log(`Expired ${n} unpaid holds`); })
    .catch((e) => console.error("expireHolds failed:", e.message));
}, 60000);
