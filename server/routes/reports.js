import { Router } from "../micro.js";
import db from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const r = Router();

async function loadMaps() {
  const [users, pkgs] = await Promise.all([db.users.all(), db.packages.all()]);
  return {
    uMap: Object.fromEntries(users.map((u) => [u.id, u])),
    pMap: Object.fromEntries(pkgs.map((p) => [p.id, p])),
  };
}

r.get("/api/reports/summary", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const all = await db.reservations.all();
  const { uMap, pMap } = await loadMaps();

  const approved = all.filter((x) => x.status === "approved");
  const revenue = approved.reduce((s, x) => s + (pMap[x.package_id]?.price || 0), 0);

  const byPackage = {};
  for (const x of approved) {
    const name = pMap[x.package_id]?.name || x.package_id;
    byPackage[name] = (byPackage[name] || 0) + 1;
  }

  const today = new Date().toLocaleDateString("sv-SE");

  res.json({
    totalBookings: approved.length,
    revenue,
    pendingDeposits: all.filter((x) => x.status === "verify").length,
    activeHolds: all.filter((x) => x.status === "hold").length,
    cancelled: all.filter((x) => x.status === "cancelled").length,
    byPackage: Object.entries(byPackage).map(([name, c]) => ({ name, c })),
    upcoming: approved
      .filter((x) => x.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10)
      .map((x) => ({
        date: x.date,
        guest: uMap[x.user_id]?.name,
        package: pMap[x.package_id]?.name,
      })),
  });
});

r.get("/api/reports/monthly", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const all = await db.reservations.all();
  const { pMap } = await loadMaps();

  const map = {};
  for (const x of all) {
    if (!["approved", "verify"].includes(x.status) || !x.date.startsWith("2026")) continue;
    const m = x.date.slice(5, 7);
    if (!map[m]) map[m] = { m, bookings: 0, revenue: 0 };
    map[m].bookings++;
    map[m].revenue += Math.round((pMap[x.package_id]?.price || 0) / 1000);
  }
  res.json({ monthly: Object.values(map).sort((a, b) => a.m.localeCompare(b.m)) });
});

r.get("/api/reports/by-status", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const all = await db.reservations.all();
  const map = {};
  for (const x of all) map[x.status] = (map[x.status] || 0) + 1;
  res.json({ byStatus: Object.entries(map).map(([status, c]) => ({ status, c })) });
});

export default r;