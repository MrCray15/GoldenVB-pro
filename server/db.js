// Golden VB datastore — MongoDB edition.
// Same interface as the SQLite version, so routes/auth/seed only need `await`.
import { MongoClient } from "mongodb";

const URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "goldenvb";

if (!URI) throw new Error("MONGODB_URI is not set. Add it to your .env file.");

const client = new MongoClient(URI);
await client.connect();
const mongo = client.db(DB_NAME);

// ---------- collections ----------
const Users = mongo.collection("users");
const Packages = mongo.collection("packages");
const Reservations = mongo.collection("reservations");
const Visits = mongo.collection("ocular_visits");
const Counters = mongo.collection("counters");

// Mongo has no AUTOINCREMENT — emulate integer ids with a counters collection.
async function nextId(name) {
  const r = await Counters.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return r.seq;
}

// ---------- indexes ----------
await Users.createIndex({ email: 1 }, { unique: true });

// The double-booking killer: at most ONE active reservation per date.
// Partial unique index — only enforced for these statuses.
await Reservations.createIndex(
  { date: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["hold", "verify", "approved"] } },
    name: "one_booking_per_day",
  }
);

// strip Mongo's _id when returning rows (routes expect plain objects)
const strip = (doc) => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
};

// ---------- the db facade the routes call ----------
const db = {
  users: {
    insert: async (u) => {
      const id = await nextId("users");
      const doc = {
        id,
        name: u.name,
        email: u.email,
        password_hash: u.password_hash,
        role: u.role,
        phone: u.phone ?? null,
        created_at: new Date().toISOString(),
      };
      await Users.insertOne(doc);
      return doc;
    },
    byEmail: async (email) => strip(await Users.findOne({ email })),
    byId: async (id) => strip(await Users.findOne({ id: Number(id) })),
    all: async () => (await Users.find({}).toArray()).map(strip),


    clear: async () => {
      await Users.deleteMany({});
      await Counters.deleteOne({ _id: "users" });
    }, 
  },

  packages: {
    insertIgnore: async (p) => {
      await Packages.updateOne(
        { id: p.id },
        {
          $setOnInsert: {
            id: p.id,
            name: p.name,
            price: p.price,
            hours: p.hours,
            max_guests: p.max_guests ?? 30,
          },
        },
        { upsert: true }
      );
    },
    all: async () => (await Packages.find({}).toArray()).map(strip),
    byId: async (id) => strip(await Packages.findOne({ id })),
  },

  reservations: {
    insert: async (r) => {
      const id = await nextId("reservations");
      const doc = {
        id,
        ref: r.ref ?? null,
        user_id: r.user_id,
        package_id: r.package_id,
        date: r.date,
        guests: r.guests,
        status: r.status || "hold",
        deposit_amount: r.deposit_amount,
        deposit_proof: r.deposit_proof ?? null,
        hold_expires_at: r.hold_expires_at ?? null,
        checked_in: 0,
        created_at: r.created_at ?? new Date().toISOString(),

        guest_name: r.guest_name ?? null,
        guest_phone: r.guest_phone ?? null,
        guest_email: r.guest_email ?? null, 
      };
      try {
        await Reservations.insertOne(doc);
      } catch (e) {
        if (e.code === 11000) throw new Error("one_booking_per_day");
        throw e;
      }
      return doc;
    },
    byId: async (id) => strip(await Reservations.findOne({ id: Number(id) })),
    byUser: async (uid) =>
      (await Reservations.find({ user_id: uid }).sort({ created_at: -1 }).toArray()).map(strip),
    all: async () =>
      (await Reservations.find({}).sort({ created_at: -1 }).toArray()).map(strip),
    activeDays: async () => {
      const rows = await Reservations.find({
        status: { $in: ["hold", "verify", "approved"] },
      }).toArray();
      return Object.fromEntries(rows.map((x) => [x.date, x.status]));
    },
    update: async (id, patch) => {
      await Reservations.updateOne({ id: Number(id) }, { $set: patch });
      return db.reservations.byId(id);
    },
    expireHolds: async (nowIso) => {
      const r = await Reservations.updateMany(
        { status: "hold", hold_expires_at: { $lt: nowIso } },
        { $set: { status: "cancelled", hold_expires_at: null } }
      );
      return r.modifiedCount;
    },
    bookedOn: async (date) =>
      !!(await Reservations.findOne({
        date,
        status: { $in: ["verify", "approved"] },
      })),
    clear: async () => {
      await Reservations.deleteMany({});
    },
  },

  visits: {
    insert: async (v) => {
      const id = await nextId("visits");
      const doc = {
        id,
        user_id: v.user_id,
        date: v.date,
        time: v.time,
        party_size: v.party_size ?? 2,
        status: "scheduled",
        created_at: new Date().toISOString(),
      };
      await Visits.insertOne(doc);
      return doc;
    },
    byUser: async (uid) =>
      (await Visits.find({ user_id: uid }).sort({ date: 1 }).toArray()).map(strip),
    all: async () =>
      (await Visits.find({}).sort({ date: 1 }).toArray()).map(strip),
    clear: async () => {
      await Visits.deleteMany({});
    },
  },
};

export default db;