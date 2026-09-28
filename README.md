# Golden VB — plain HTML + CSS + JavaScript edition

Online Booking System & Ocular Visit Scheduling for Golden Villa Private Resort.
System Analysis and Design case study (BSIT) — Capua, Del Rosario, Palabay — Sept 2026.

NO JSX. NO React. NO npm for the frontend. NO build step.
Just the three languages from class: HTML, CSS, and plain JavaScript
(const, functions, fetch). The backend is plain Node.js with a real
SQLite database (built into Node 22, so still zero installs).

## Run it — ONE terminal, three commands

    cd server
    node seed.js
    node index.js

Then open http://localhost:3001 in your browser. Done.
(The same server that answers the API also serves the website,
so there is nothing else to start.)

Requires Node.js 22+ (https://nodejs.org). Check with: node --version

## Demo accounts (created by seed.js)

| Role      | Email                  | Password     |
|-----------|------------------------|--------------|
| Customer  | customer@goldenvb.ph   | password123  |
| Admin     | admin@goldenvb.ph      | admin123     |
| Caretaker | caretaker@goldenvb.ph  | caretaker123 |
| Owner     | owner@goldenvb.ph      | owner123     |

## The files (all readable, all vanilla)

- public/index.html — every screen: login, customer booking flow,
  admin queue, caretaker board, owner dashboard
- public/style.css — the whole golden design, plain CSS
- public/app.js — all frontend logic: fetch() calls to the API,
  calendar drawing, step navigation, charts on a <canvas>
- server/index.js — Node server: serves the website + the API
- server/db.js — SQLite database (goldenvb.db gets created for you)
- server/auth.js — password hashing (scrypt) + login tokens (JWT)
- server/routes/*.js — the API endpoints
- server/seed.js — demo data

## What's real

Everything. Login/register (passwords hashed with scrypt), the booking
hold, deposit verification, admin approve/reject, caretaker check-ins,
the owner's charts, and the 24-hour pencil-booking auto-cancel all read
and write the SQLite database. Double-booking is blocked by a UNIQUE
index in the database itself, tested with two simultaneous requests.

## How to present it

1. node seed.js && node index.js
2. Log in as the customer, book a date, upload the deposit
3. Switch to the Administrator tab, approve it, show the voucher ref
4. Caretaker tab: check in today's arrival
5. Owner tab: the revenue number just went up, live
