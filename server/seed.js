import db from "./db.js";
import { hashPassword } from "./auth.js";

// wipe everything first
await db.users.clear();
await db.reservations.clear();
await db.visits.clear();

const seedUser = async (name, email, pw, role, phone) => {
  if (!(await db.users.byEmail(email))) {
    await db.users.insert({
      name,
      email,
      password_hash: hashPassword(pw),
      role,
      phone,
    });
    console.log("INSERTED user:", email, "role:", role);
  }
};

// ---------- packages ----------
await Promise.all([
  ["day-tour", "Paradise Day Tour", 5500, "8:00 AM - 5:00 PM"],
  ["overnight", "Colorful Overnight", 6500, "6:00 PM - 6:00 AM"],
  ["happy-stay", "Happy Stay", 12500, "Up to 22 hours"],
].map(([id, name, price, hours]) =>
  db.packages.insertIgnore({ id, name, price, hours, max_guests: 30 })
));
console.log("Packages: 3 inserted");

// ---------- staff accounts ----------
await seedUser("Admin Ana", "admin@gmail.com", "12345678", "admin", null);
await seedUser("Mang Carding", "caretaker@gmail.com", "12345678", "caretaker", null);
await seedUser("Villa Owner", "owner.owner@gmail.com", "12345678", "owner", null);

// ---------- shared guest customer ----------
await seedUser("Guest Customer", "guest@goldenvb.ph", "12345678", "customer", null);

// ---------- done ----------
const usersCount = (await db.users.all()).length;
const resCount = (await db.reservations.all()).length;
const visitCount = (await db.visits.all()).length;

console.log(`\nSeeded: 3 packages, ${usersCount} users, ${resCount} reservations, ${visitCount} visits`);
console.log("No sample reservations were created. The admin queue starts empty until a real booking is made.");

process.exit(0);