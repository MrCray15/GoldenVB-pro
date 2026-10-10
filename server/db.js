// Golden VB datastore — MongoDB edition.
import { MongoClient } from "mongodb";

const URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "goldenvb";

if (!URI) throw new Error("MONGODB_URI is not set. Add it to your .env file.");

const client = new MongoClient(URI);
await client.connect();
const mongo = client.db(DB_NAME);

const Users        = mongo.collection("users");
const Packages     = mongo.collection("packages");
const Reservations = mongo.collection("reservations");
const Visits       = mongo.collection("ocular_visits");
const Counters     = mongo.collection("counters");
const Invites      = mongo.collection("invites");
const Deleted      = mongo.collection("deleted_records");
const Otps         = mongo.collection("otps");

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

await Reservations.createIndex(
  { date: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["hold", "verify", "approved"] } },
    name: "one_booking_per_day",
  }
);

await Invites.createIndex({ code: 1 }, { unique: true });
await Invites.createIndex({ email: 1 });

// OTP indexes — TTL auto-deletes expired codes
await Otps.createIndex({ email: 1 });
await Otps.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

const strip = (doc) => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
};

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
    byId:    async (id)    => strip(await Users.findOne({ id: Number(id) })),
    all:     async ()      => (await Users.find({}).toArray()).map(strip),
    clear:   async ()      => {
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
            id: p.id, name: p.name, price: p.price,
            hours: p.hours, max_guests: p.max_guests ?? 30,
          },
        },
        { upsert: true }
      );
    },
    all:   async ()   => (await Packages.find({}).toArray()).map(strip),
    byId:  async (id) => strip(await Packages.findOne({ id })),
  },

  reservations: {
    insert: async (r) => {
      const id = await nextId("reservations");
      const doc = {
        id,
        ref: r.ref ?? null,
        user_id: r.user_id ?? null,
        package_id: r.package_id,
        date: r.date,
        guests: r.guests,
        status: r.status || "hold",
        deposit_amount: r.deposit_amount,
        deposit_proof: r.deposit_proof ?? null,
        hold_expires_at: r.hold_expires_at ?? null,
        checked_in: 0,
        checked_in_at: null,
        checked_in_by: null,
        caretaker_note: null,
        created_at: r.created_at ?? new Date().toISOString(),
        guest_name:  r.guest_name  ?? null,
        guest_phone: r.guest_phone ?? null,
        guest_email: r.guest_email ?? null,
        source:      r.source ?? "online",
        created_by:  r.created_by ?? null,
        completed_at: null, completed_by: null,
        cancelled_at: null, cancelled_by: null,
      };
      try {
        await Reservations.insertOne(doc);
      } catch (e) {
        if (e.code === 11000) throw new Error("one_booking_per_day");
        throw e;
      }
      return doc;
    },
    byId:    async (id) => strip(await Reservations.findOne({ id: Number(id) })),
    byUser:  async (uid) =>
      (await Reservations.find({ user_id: uid }).sort({ created_at: -1 }).toArray()).map(strip),
    all: async () =>
      (await Reservations.find({ status: { $ne: "completed" } }).sort({ created_at: -1 }).toArray()).map(strip),
    history: async () =>
      (await Reservations.find({}).sort({ created_at: -1 }).toArray()).map(strip),
    activeDays: async () => {
      const rows = await Reservations.find({ status: { $in: ["hold", "verify", "approved"] } }).toArray();
      return Object.fromEntries(rows.map((x) => [x.date, x.status]));
    },
    update: async (id, patch) => {
      await Reservations.updateOne({ id: Number(id) }, { $set: patch });
      return db.reservations.byId(id);
    },
    complete: async (id, managerId) => {
      await Reservations.updateOne({ id: Number(id) }, { $set: {
        status: "completed", completed_at: new Date().toISOString(),
        completed_by: managerId, hold_expires_at: null,
      }});
      return db.reservations.byId(id);
    },
    cancel: async (id, managerId) => {
      await Reservations.updateOne({ id: Number(id) }, { $set: {
        status: "cancelled", cancelled_at: new Date().toISOString(),
        cancelled_by: managerId, hold_expires_at: null,
      }});
      return db.reservations.byId(id);
    },
    deleteById: async (id) => {
      const r = await Reservations.deleteOne({ id: Number(id) });
      return r.deletedCount;
    },
    expireHolds: async (nowIso) => {
      const r = await Reservations.updateMany(
        { status: "hold", hold_expires_at: { $lt: nowIso } },
        { $set: { status: "cancelled", hold_expires_at: null } }
      );
      return r.modifiedCount;
    },
    bookedOn: async (date) =>
      !!(await Reservations.findOne({ date, status: { $in: ["verify", "approved"] } })),
    clear: async () => { await Reservations.deleteMany({}); },
  },

  visits: {
    insert: async (v) => {
      const id = await nextId("visits");
      const doc = {
        id, user_id: v.user_id, date: v.date, time: v.time,
        party_size: v.party_size ?? 2, status: "scheduled",
        created_at: new Date().toISOString(),
        completed_at: null, completed_by: null,
        cancelled_at: null, cancelled_by: null,
        no_show_at: null, no_show_by: null,
      };
      await Visits.insertOne(doc);
      return doc;
    },
    byUser: async (uid) => (await Visits.find({ user_id: uid }).sort({ date: 1 }).toArray()).map(strip),
    byId: async (id) => strip(await Visits.findOne({ id: Number(id) })),
    all: async () =>
      (await Visits.find({ status: { $nin: ["completed", "cancelled", "no_show"] } }).sort({ date: 1 }).toArray()).map(strip),
    allActiveWithDates: async (dates) =>
      (await Visits.find({ date: { $in: dates }, status: { $nin: ["completed", "cancelled"] } }).sort({ date: 1 }).toArray()).map(strip),
    history: async () =>
      (await Visits.find({}).sort({ created_at: -1 }).toArray()).map(strip),
    complete: async (id, managerId) => {
      await Visits.updateOne({ id: Number(id) }, { $set: {
        status: "completed", completed_at: new Date().toISOString(), completed_by: managerId,
      }});
      return db.visits.byId(id);
    },
    cancel: async (id, managerId) => {
      await Visits.updateOne({ id: Number(id) }, { $set: {
        status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: managerId,
      }});
      return db.visits.byId(id);
    },
    markNoShow: async (id, caretakerId) => {
      await Visits.updateOne({ id: Number(id) }, { $set: {
        status: "no_show", no_show_at: new Date().toISOString(), no_show_by: caretakerId,
      }});
      return db.visits.byId(id);
    },
    markArrived: async (id) => {
      await Visits.updateOne({ id: Number(id) }, { $set: {
        status: "arrived", completed_at: new Date().toISOString(),
      }});
      return db.visits.byId(id);
    },
    deleteById: async (id) => {
      const r = await Visits.deleteOne({ id: Number(id) });
      return r.deletedCount;
    },
    clear: async () => { await Visits.deleteMany({}); },
  },

  deletedRecords: {
    log: async (kind, doc, deletedBy, reason) => {
      await Deleted.insertOne({
        kind, original_id: doc.id, snapshot: doc,
        deleted_by: deletedBy, deleted_at: new Date().toISOString(),
        reason: reason || null,
      });
    },
    all: async () => (await Deleted.find({}).sort({ deleted_at: -1 }).toArray()).map(strip),
    clear: async () => { await Deleted.deleteMany({}); },
  },

  // ---------- OTPs ----------
  otps: {
    insert: async (o) => {
      await Otps.insertOne({
        email: o.email,
        code_hash: o.code_hash,
        purpose: o.purpose,
        expires_at: new Date(o.expires_at),
        created_at: new Date(),
        attempts: 0,
        used_at: null,
      });
    },
    latestFor: async (email, purpose) =>
      await Otps.findOne({ email, purpose, used_at: null }, { sort: { created_at: -1 } }),
    markUsed: async (id) => {
      await Otps.updateOne({ _id: id }, { $set: { used_at: new Date() } });
    },
    bumpAttempts: async (id) => {
      await Otps.updateOne({ _id: id }, { $inc: { attempts: 1 } });
    },
    clearFor: async (email, purpose) => {
      await Otps.deleteMany({ email, purpose });
    },
    clear: async () => { await Otps.deleteMany({}); },
  },

  invites: {
    insert: async (inv) => {
      const id = await nextId("invites");
      const doc = {
        id, code: inv.code, email: inv.email, name: inv.name ?? null,
        role: inv.role, created_by: inv.created_by,
        created_at: new Date().toISOString(), expires_at: inv.expires_at,
        used_at: null, used_by: null, revoked: false,
      };
      await Invites.insertOne(doc);
      return doc;
    },
    byCode: async (code) => strip(await Invites.findOne({ code })),
    byId:   async (id)   => strip(await Invites.findOne({ id: Number(id) })),
    all:    async ()     => (await Invites.find({}).sort({ created_at: -1 }).toArray()).map(strip),
    markUsed: async (id, userId) => {
      await Invites.updateOne({ id: Number(id) }, { $set: {
        used_at: new Date().toISOString(), used_by: userId,
      }});
    },
    revoke: async (id) => {
      await Invites.updateOne({ id: Number(id) }, { $set: { revoked: true } });
    },
    clear: async () => {
      await Invites.deleteMany({});
      await Counters.deleteOne({ _id: "invites" });
    },
  },
};

export default db;