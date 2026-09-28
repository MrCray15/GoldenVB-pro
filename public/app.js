/* ============================================================
   Golden VB — frontend logic in plain JavaScript (no JSX!)
   Everything talks to the real API with fetch().
   ============================================================ */

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
const peso = (n) => "₱" + Number(n || 0).toLocaleString("en-PH");
const todayISO = () => new Date().toLocaleDateString("sv-SE");

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];

// ---------- session (saved in localStorage) ----------
function getToken() { return localStorage.getItem("gvb_token"); }
function getUser() {
  try { return JSON.parse(localStorage.getItem("gvb_user")); } catch { return null; }
}
function setSession(token, user) {
  localStorage.setItem("gvb_token", token);
  localStorage.setItem("gvb_user", JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem("gvb_token");
  localStorage.removeItem("gvb_user");
}

// ---------- API wrapper: attaches the login token to every request ----------
async function api(path, method, body) {
  const options = { method: method || "GET", headers: { "Content-Type": "application/json" } };
  if (getToken()) options.headers["Authorization"] = "Bearer " + getToken();
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// ---------- app state ----------
let user = null;
let role = "customer";
let step = 0;
let packages = [];
let pkgId = null;
let availability = {};
let pickedDate = null;      // "YYYY-MM-DD"
let guests = 10;
let uploaded = false;
let reservationId = null;
let holdSeconds = 24 * 3600;
let holdTimer = null;
let queue = [];
let selectedQueueId = null;
let adminPoll = null;

const PKG_ICONS = { "day-tour": "☀", "overnight": "🌙", "happy-stay": "★" };
const PKG_TAGS = {
  "day-tour": "Sun up to sun down",
  "overnight": "Under the string lights",
  "happy-stay": "The full golden weekend",
};
const STEP_NAMES = ["Package", "Date", "Details", "Deposit", "Voucher"];

/* ============================================================
   LOGIN
   ============================================================ */

function showLogin() {
  $("login-screen").classList.remove("hidden");
  $("app").classList.add("hidden");
  // clean the form every time we return to the login screen
  $("login-email").value = "";
  $("login-password").value = "";
  $("login-role").value = "";
  $("login-error").classList.add("hidden");
  // make sure the register form isn't stuck open
  $("register-form").classList.add("hidden");
  $("register-error").classList.add("hidden");
  $("login-form").classList.remove("hidden");
  $("guest-btn").classList.remove("hidden");
  $("show-register").classList.remove("hidden");
  document.querySelector(".login-hint").classList.remove("hidden");
  document.querySelector(".login-divider").classList.remove("hidden");
}

function showApp() {
  $("login-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("user-name").textContent = "Hi, " + user.name.split(" ")[0];
  // ALWAYS switch to the logged-in user's role — this is the fix for the
  // "stuck on admin view" bug when logging back in as a customer.
  switchRole(user.role);
  loadCustomer();
}

// ---------- GUEST CUSTOMER (one-click) ----------
$("guest-btn").addEventListener("click", async () => {
  $("login-error").classList.add("hidden");
  try {
    const data = await api("/api/auth/guest", "POST");
    setSession(data.token, data.user);
    user = data.user;
    showApp();
  } catch (err) {
    $("login-error").textContent = err.message;
    $("login-error").classList.remove("hidden");
  }
});

// ---------- STAFF LOGIN (with role) ----------
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").classList.add("hidden");
  try {
    const data = await api("/api/auth/login", "POST", {
      email: $("login-email").value,
      password: $("login-password").value,
      role: $("login-role").value,
    });
    setSession(data.token, data.user);
    user = data.user;
    showApp();
  } catch (err) {
    $("login-error").textContent = err.message;
    $("login-error").classList.remove("hidden");
  }
});

// ---------- CARETAKER REGISTRATION ----------
$("show-register").addEventListener("click", () => {
  $("login-form").classList.add("hidden");
  $("guest-btn").classList.add("hidden");
  $("show-register").classList.add("hidden");
  document.querySelector(".login-hint").classList.add("hidden");
  document.querySelector(".login-divider").classList.add("hidden");
  $("register-form").classList.remove("hidden");
});

$("cancel-register").addEventListener("click", () => {
  $("register-form").classList.add("hidden");
  $("register-error").classList.add("hidden");
  $("login-form").classList.remove("hidden");
  $("guest-btn").classList.remove("hidden");
  $("show-register").classList.remove("hidden");
  document.querySelector(".login-hint").classList.remove("hidden");
  document.querySelector(".login-divider").classList.remove("hidden");
});

$("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("register-error").classList.add("hidden");
  try {
    const data = await api("/api/auth/register-caretaker", "POST", {
      name: $("reg-name").value,
      email: $("reg-email").value,
      password: $("reg-password").value,
      phone: $("reg-phone").value || null,
    });
    setSession(data.token, data.user);
    user = data.user;
    showApp();
  } catch (err) {
    $("register-error").textContent = err.message;
    $("register-error").classList.remove("hidden");
  }
});

$("logout-btn").addEventListener("click", () => {
  clearSession();
  user = null;
  role = "customer";
  step = 0;
  pickedDate = null;
  uploaded = false;
  reservationId = null;
  holdSeconds = 24 * 3600;
  stopAdminPoll();
  showLogin();
});

/* ============================================================
   ROLE TABS
   ============================================================ */
function switchRole(next) {
  role = next;
  document.querySelectorAll("#role-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.role === role));
  ["customer", "admin", "caretaker", "owner"].forEach((r) => $("view-" + r).classList.toggle("hidden", r !== role));
  stopAdminPoll();
  if (role === "admin") loadAdmin();
  if (role === "caretaker") loadCaretaker();
  if (role === "owner") loadOwner();
}

document.querySelectorAll("#role-tabs .tab").forEach((t) => {
  t.addEventListener("click", () => switchRole(t.dataset.role));
});

/* ============================================================
   CUSTOMER: booking flow
   ============================================================ */
async function loadCustomer() {
  try {
    const pkgs = await api("/api/reservations/packages");
    packages = pkgs.packages;
    if (!pkgId && packages.length) pkgId = packages[packages.length - 1].id;
    renderPackages();
    await refreshAvailability();
    renderCalendars();
    renderVisits();
  } catch (err) {
    showError("customer-error", "Couldn't reach the server. Is it running?");
  }
}

async function refreshAvailability() {
  const data = await api("/api/reservations/availability");
  availability = data.days; // { "2026-09-27": "hold", ... }
}

function renderPackages() {
  $("pkg-grid").innerHTML = packages.map((p) => `
    <button type="button" class="pkg-card ${p.id === pkgId ? "active" : ""}" data-pkg="${p.id}">
      <div class="pkg-icon">${PKG_ICONS[p.id] || "☀"}</div>
      <p class="pkg-name">${p.name}</p>
      <p class="pkg-tag">${PKG_TAGS[p.id] || ""}</p>
      <p class="pkg-price">${peso(p.price)}</p>
      <p class="pkg-hours">${p.hours}</p>
    </button>
  `).join("");
  document.querySelectorAll("[data-pkg]").forEach((b) =>
    b.addEventListener("click", () => { pkgId = b.dataset.pkg; renderPackages(); updateGuestsMax(); })
  );
  updateGuestsMax();
}

function currentPkg() {
  return packages.find((p) => p.id === pkgId) || { price: 0, max_guests: 30, hours: "", name: "" };
}

function updateGuestsMax() {
  $("g-max").textContent = "max " + currentPkg().max_guests;
  if (guests > currentPkg().max_guests) { guests = currentPkg().max_guests; $("g-count").textContent = guests; }
}

// calendar rendering (two months: current + next)
function renderCalendars() {
  const now = new Date();
  renderMonth($("cal-1"), now.getFullYear(), now.getMonth());
  const nxt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  renderMonth($("cal-2"), nxt.getFullYear(), nxt.getMonth());
}

function renderMonth(el, year, month) {
  const firstDow = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const today = todayISO();
  let html = `<p class="cal-title">${MONTHS[month]} <span class="muted">${year}</span></p><div class="cal-grid">`;
  DOW.forEach((d) => { html += `<span class="cal-dow">${d}</span>`; });
  for (let i = 0; i < firstDow; i++) html += "<span></span>";
  for (let d = 1; d <= days; d++) {
    const iso = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    const status = availability[iso];
    let cls = "cal-day";
    let disabled = false;
    if (iso < today) { cls += " past"; disabled = true; }
    if (status === "approved" || status === "verify") { cls += " booked"; disabled = true; }
    if (status === "hold") { cls += " held"; disabled = true; }
    if (iso === today) cls += " today";
    if (iso === pickedDate) cls += " selected";
    html += `<button type="button" class="${cls}" data-date="${iso}" ${disabled ? "disabled" : ""}>${d}</button>`;
  }
  html += `</div><div class="cal-legend">
    <span><span class="dot" style="background:#2E5D4680"></span>Reserved</span>
    <span><span class="dot" style="background:#C4572E"></span>On hold</span>
    <span><span class="dot" style="background:#B8912F"></span>Today</span>
  </div>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-date]").forEach((b) =>
    b.addEventListener("click", () => {
      pickedDate = b.dataset.date;
      renderCalendars();
      const [y, m, d] = pickedDate.split("-").map(Number);
      $("picked-date").textContent = new Date(y, m - 1, d).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
    })
  );
}

// guest stepper
$("g-minus").addEventListener("click", () => { if (guests > 1) guests--; $("g-count").textContent = guests; });
$("g-plus").addEventListener("click", () => { if (guests < currentPkg().max_guests) guests++; $("g-count").textContent = guests; });

// step navigation
function renderSteps() {
  $("steps").innerHTML = STEP_NAMES.map((name, i) => `
    <div class="step-item ${i < step ? "done" : ""} ${i === step ? "now" : ""}">
      <span class="step-dot">${i < step ? "✓" : i + 1}</span>
      <span class="step-label">${name}</span>
      ${i < STEP_NAMES.length - 1 ? '<span class="step-line"></span>' : ""}
    </div>
  `).join("");
  for (let i = 0; i < 5; i++) $("step-" + i).classList.toggle("hidden", i !== step);
  $("step-nav").style.display = step === 4 ? "none" : "flex";
  $("back-btn").disabled = step === 0;
  $("next-btn").textContent = step === 3 ? "Confirm booking →" : "Continue →";
  clearInterval(holdTimer);
  if (step === 3) startHoldTimer();
}

function startHoldTimer() {
  const tick = () => {
    holdSeconds = Math.max(0, holdSeconds - 1);
    const h = String(Math.floor(holdSeconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((holdSeconds % 3600) / 60)).padStart(2, "0");
    const s = String(holdSeconds % 60).padStart(2, "0");
    $("hold-timer").textContent = h + ":" + m + ":" + s;
  };
  tick();
  holdTimer = setInterval(tick, 1000);
}

$("back-btn").addEventListener("click", () => { if (step > 0) { step--; renderSteps(); } });

$("next-btn").addEventListener("click", async () => {
  $("customer-error").classList.add("hidden");
  if (step === 0 && !pkgId) return;

  if (step === 0) {
    // package selected — advance to date picker
    step = 1;

  } else if (step === 1) {
    // date must be picked — just advance, don't create anything yet
    if (!pickedDate) return;
    // prefill form from account (guest account starts blank)
    $("f-name").value = $("f-name").value || ((user.name === "Guest Customer") ? "" : (user.name || ""));
    $("f-phone").value = $("f-phone").value || (user.phone || "");
    $("f-email").value = $("f-email").value || ((user.email === "guest@goldenvb.ph") ? "" : (user.email || ""));
    step = 2;

  } else if (step === 2) {
    // validate name + phone
    if (!$("f-name").value.trim() || !$("f-phone").value.trim()) {
      showError("customer-error", "Name and mobile number are required.");
      return;
    }
    // NOW create the reservation, with the guest's real details
    try {
      const r = await api("/api/reservations", "POST", {
        package_id: pkgId,
        date: pickedDate,
        guests: guests,
        guest_name: $("f-name").value,
        guest_phone: $("f-phone").value,
        guest_email: $("f-email").value || null,
      });
      reservationId = r.id;
      await refreshAvailability();
      renderCalendars();
      step = 3;
      const pkg = currentPkg();
      $("deposit-line").textContent = "50% down (" + peso(Math.round(pkg.price / 2)) + ") holds your date. Unpaid holds auto-cancel in the database.";
    } catch (err) {
      showError("customer-error", err.message);
      await refreshAvailability();
      renderCalendars();
      return;
    }

  } else if (step === 3) {
    if (!uploaded) return;
    try {
      await api("/api/reservations/" + reservationId + "/deposit", "POST", {
        proof_name: "deposit_proof_gcash.jpg",
      });
      step = 4;
      renderVoucher();
    } catch (err) {
      showError("customer-error", err.message);
      return;
    }

  } else {
    step++;
  }

  renderSteps();
});

$("upload-proof").addEventListener("click", () => {
  uploaded = true;
  $("upload-proof").classList.add("done");
  $("upload-text").textContent = "✔ deposit_proof_gcash.jpg attached";
});

function renderVoucher() {
  const pkg = currentPkg();
  const [y, m, d] = pickedDate.split("-").map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const ref = "GVB-2026-" + String(reservationId || 0).padStart(4, "0");
  $("voucher-greet").textContent = "Deposit received, " + ($("f-name").value.split(" ")[0] || "friend");
  $("voucher-slot").innerHTML = `
    <div class="voucher"><div class="voucher-inner">
      <p class="voucher-brand">Golden Villa Private Resort</p>
      <p class="voucher-title">Reservation Voucher</p>
      <p class="voucher-ref">${ref}<span class="voucher-confirmed">Deposit on file</span></p>
      <div class="voucher-perf"></div>
      <div class="voucher-rows">
        <div class="row"><span>Guest</span><span><b>${$("f-name").value}</b></span></div>
        <div class="row"><span>Date</span><span>${dateLabel}</span></div>
        <div class="row"><span>Package</span><span>${guests} guests · ${pkg.name}</span></div>
        <div class="row"><span>Deposit</span><span style="color:var(--green);font-weight:700">${peso(Math.round(pkg.price / 2))} · verifying</span></div>
      </div>
      <p class="voucher-foot">📞 Present this voucher upon arrival · Malolos, Bulacan</p>
    </div></div>`;
}

$("book-again").addEventListener("click", () => {
  step = 0; pickedDate = null; uploaded = false; reservationId = null; holdSeconds = 24 * 3600;
  $("upload-proof").classList.remove("done");
  $("upload-text").textContent = "📤 Upload a photo of your deposit slip or GCash receipt";
  renderSteps(); renderCalendars();
});

// ocular visits
$("visit-date").min = todayISO();
$("visit-book").addEventListener("click", async () => {
  $("visit-msg").textContent = "";
  if (!$("visit-date").value) return;
  try {
    const r = await api("/api/reservations/visits", "POST", { date: $("visit-date").value, time: $("visit-time").value, party_size: 2 });
    $("visit-msg").textContent = r.message;
    $("visit-date").value = "";
    renderVisits();
  } catch (err) {
    $("visit-msg").textContent = err.message;
  }
});

async function renderVisits() {
  try {
    const data = await api("/api/reservations/visits");
    $("visit-list").innerHTML = data.visits.length
      ? data.visits.map((v) => `<span class="chip">${v.date} · ${v.time}</span>`).join("")
      : "";
  } catch { /* not logged in as customer yet */ }
}

/* ============================================================
   ADMIN: live reservation queue
   ============================================================ */
const fmtHoldLeft = (expiresAt) => {
  const ms = new Date(expiresAt) - Date.now();
  if (!expiresAt || ms <= 0) return "expiring...";
  const s = Math.floor(ms / 1000);
  if (s >= 3600) return Math.floor(s / 3600) + "h " + String(Math.floor((s % 3600) / 60)).padStart(2, "0") + "m left";
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + " left";
};

const STATUS_LABELS = { verify: "Verify deposit", hold: "On hold", approved: "Approved", rejected: "Rejected", cancelled: "Auto-cancelled" };

async function loadAdmin() {
  try {
    const data = await api("/api/reservations");
    queue = data.reservations;
    if (!selectedQueueId && queue.length) selectedQueueId = queue[0].id;
    $("verify-count").textContent = queue.filter((r) => r.status === "verify").length + " deposits to verify";
    renderQueue();
    $("admin-error").classList.add("hidden");
  } catch (err) {
    showError("admin-error", err.message);
  }
  adminPoll = setInterval(loadAdminQuiet, 5000);
}

async function loadAdminQuiet() {
  try {
    const data = await api("/api/reservations");
    queue = data.reservations;
    renderQueue();
  } catch { /* keep old data on a hiccup */ }
}

function stopAdminPoll() { clearInterval(adminPoll); }

function renderQueue() {
  $("queue-list").innerHTML = queue.length ? queue.map((r) => `
    <button type="button" class="queue-item ${r.id === selectedQueueId ? "active" : ""}" data-qid="${r.id}">
      <div class="row1">
        <span class="name">${r.guest}</span>
        <span class="status-chip status-${r.status}">${STATUS_LABELS[r.status]}</span>
        ${r.status === "hold" ? `<span class="hold-tick">⏱ ${fmtHoldLeft(r.hold_expires_at)}</span>` : ""}
        <span class="amount">${peso(r.deposit_amount)}</span>
      </div>
      <p class="meta">${r.package} · ${r.date} · ${r.guests} guests</p>
      <p class="note">${
        r.status === "hold" ? "No deposit yet — pencil booking" :
        r.status === "verify" ? "Deposit proof uploaded, waiting on you" :
        r.status === "approved" ? "Voucher " + r.ref + " issued" :
        r.status === "cancelled" ? "Deposit window lapsed, date released" : "Declined, guest notified"
      }</p>
    </button>
  `).join("") : '<p class="muted">No reservations yet. Book one as a customer and it lands here.</p>';

  document.querySelectorAll("[data-qid]").forEach((b) =>
    b.addEventListener("click", () => { selectedQueueId = Number(b.dataset.qid); renderQueue(); })
  );
  renderQueueDetail();
}

function renderQueueDetail() {
  const r = queue.find((x) => x.id === selectedQueueId);
  if (!r) { $("queue-detail").innerHTML = '<p class="muted">Select a reservation to review it.</p>'; return; }

  let body = "";
  if (r.status === "verify") {
    body = `
      <p class="label">PROOF OF DEPOSIT</p>
      <div class="receipt">
        <div class="receipt-head">GCash</div>
        <div class="receipt-body">
          <p style="font-size:10px;letter-spacing:2px;color:#a8a29e">AMOUNT SENT</p>
          <p class="receipt-amt">${peso(r.deposit_amount)}</p>
          <p style="font-size:11px;color:#78716c;margin-top:6px">from ${r.guest}</p>
          <div class="receipt-rows">
            <div class="r"><span>Proof</span><span class="mono">${r.deposit_proof || "—"}</span></div>
            <div class="r"><span>To</span><span>Golden Villa PR</span></div>
          </div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-green" onclick="reviewReservation(${r.id}, 'approve')">Approve & issue voucher</button>
        <button class="btn btn-outline-terra" onclick="reviewReservation(${r.id}, 'reject')">Reject</button>
      </div>`;
  } else if (r.status === "hold") {
    body = `
      <div class="pencil-box">
        <p style="font-weight:700;color:var(--terra)">⚠ Pencil booking</p>
        <p style="margin-top:6px">No deposit on file yet. The database holds ${r.date} until the window closes, then releases it automatically.</p>
        <p class="big">${fmtHoldLeft(r.hold_expires_at)}</p>
      </div>
      <div class="detail-actions">
        <button class="btn btn-outline-terra" onclick="reviewReservation(${r.id}, 'reject')">Release date now</button>
      </div>`;
  } else if (r.status === "approved") {
    body = `<div class="detail-center">
      <p class="icon">✅</p>
      <p style="font-weight:700;margin-top:6px">Voucher issued</p>
      <p class="mono" style="color:var(--gold-dark);margin-top:4px">${r.ref}</p>
      <p class="muted" style="margin-top:6px">Guest notified by SMS and email.</p>
    </div>`;
  } else {
    body = `<div class="detail-center">
      <p class="icon">${r.status === "cancelled" ? "⌛" : "✖"}</p>
      <p style="font-weight:700;margin-top:6px">${r.status === "cancelled" ? "Hold expired" : "Request declined"}</p>
      <p class="muted" style="margin-top:6px">${r.status === "cancelled" ? "The date is available again." : "The guest has been notified."}</p>
    </div>`;
  }

  $("queue-detail").innerHTML = `
    <p style="font-weight:700;font-size:14px">Reservation #${r.id}
      <span class="status-chip status-${r.status}" style="float:right">${STATUS_LABELS[r.status]}</span>
    </p>
    <div style="margin-top:12px">${body}</div>
    <div class="detail-meta">
      <div class="r"><span>Contact</span><span>${r.phone || "—"}</span></div>
      <div class="r"><span>Guests</span><span>${r.guests}</span></div>
      <div class="r"><span>Package price</span><span>${peso(r.price)}</span></div>
    </div>`;
}

// called from the onclick attributes above
window.reviewReservation = async (id, action) => {
  try {
    await api("/api/reservations/" + id + "/review", "POST", { action: action });
    await loadAdminQuiet();
  } catch (err) {
    showError("admin-error", err.message);
  }
};

/* ============================================================
   CARETAKER: arrivals, visits, walk-in check
   ============================================================ */
async function loadCaretaker() {
  $("today-label").textContent = new Date().toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  try {
    const arrivals = await api("/api/reservations/arrivals");
    renderArrivals(arrivals.arrivals);
  } catch (err) { showError("caretaker-error", err.message); }

  try {
    const visits = await api("/api/reservations/visits");
    $("caretaker-visits").innerHTML = visits.visits.length
      ? '<div class="visit-timeline">' + visits.visits.map((v) => `
          <div class="visit-stop">
            <p class="name">${v.guest}</p>
            <p class="meta">${v.date} · ${v.time} · party of ${v.party_size}</p>
            <span class="status-chip status-approved">${v.status}</span>
          </div>`).join("") + "</div>"
      : '<p class="muted">No visits scheduled.</p>';
  } catch { /* visits need staff role */ }

  try {
    const av = await api("/api/reservations/availability");
    renderWalkin(av.days);
  } catch (err) { showError("caretaker-error", err.message); }
}

function renderArrivals(list) {
  $("arrivals-list").innerHTML = list.length ? list.map((a) => `
    <div class="arrival ${a.checked_in ? "in" : ""}">
      <div class="top"><span class="name">${a.guest}</span><span class="ref">${a.ref || ""}</span></div>
      <p class="meta">${a.package} · ${a.guests} pax</p>
      <button class="checkin-btn ${a.checked_in ? "in" : ""}" onclick="toggleCheckin(${a.id})">
        ${a.checked_in ? "✓ Checked in" : "Mark arrived"}
      </button>
    </div>
  `).join("") : '<p class="muted">No approved guests arriving today.</p>';
}

window.toggleCheckin = async (id) => {
  try {
    await api("/api/reservations/" + id + "/checkin", "POST");
    const arrivals = await api("/api/reservations/arrivals");
    renderArrivals(arrivals.arrivals);
  } catch (err) { showError("caretaker-error", err.message); }
};

function renderWalkin(days) {
  const next = [];
  const d = new Date();
  for (let i = 0; i < 5; i++) { next.push(d.toLocaleDateString("sv-SE")); d.setDate(d.getDate() + 1); }
  $("walkin-days").innerHTML = next.map((iso, i) =>
    `<button class="day-chip ${i === 0 ? "active" : ""}" data-day="${iso}">${new Date(iso + "T00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}</button>`
  ).join("");

  const show = (iso) => {
    const s = days[iso];
    const box = $("walkin-result");
    if (s === "approved" || s === "verify") box.innerHTML = `<div class="walkin-result wr-booked"><p class="big">Fully booked</p><p class="sub">Reserved guest on the books</p></div>`;
    else if (s === "hold") box.innerHTML = `<div class="walkin-result wr-held"><p class="big">On hold</p><p class="sub">Pencil booking, deposit pending</p></div>`;
    else box.innerHTML = `<div class="walkin-result wr-open"><p class="big">Open</p><p class="sub">All packages available</p></div>`;
  };
  document.querySelectorAll("[data-day]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-day]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      show(b.dataset.day);
    })
  );
  show(next[0]);
}

/* ============================================================
   OWNER: stats + charts (canvas, no libraries)
   ============================================================ */
async function loadOwner() {
  try {
    const [summary, monthly] = await Promise.all([
      api("/api/reports/summary"),
      api("/api/reports/monthly"),
    ]);
    renderStats(summary);
    renderMonthlyChart(monthly.monthly);
    renderPkgShare(summary.byPackage);
    renderUpcoming(summary.upcoming);
    $("owner-error").classList.add("hidden");
  } catch (err) {
    showError("owner-error", err.message);
  }
}

function renderStats(s) {
  const stats = [
    { icon: "📈", value: peso(s.revenue), label: "Revenue · approved", sub: s.totalBookings + " confirmed" },
    { icon: "📅", value: s.totalBookings, label: "Total bookings", sub: "approved reservations" },
    { icon: "⏱", value: s.pendingDeposits, label: "Deposits to verify", sub: s.activeHolds + " holds running" },
    { icon: "✖", value: s.cancelled, label: "Expired holds", sub: "auto-cancelled by the system" },
  ];
  $("stat-grid").innerHTML = stats.map((x) => `
    <div class="stat-card">
      <span class="icon">${x.icon}</span>
      <p class="value">${x.value}</p>
      <p class="lbl">${x.label}</p>
      <p class="sub">${x.sub}</p>
    </div>`).join("");
}

function renderMonthlyChart(rows) {
  const canvas = $("monthly-chart");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!rows.length) {
    ctx.fillStyle = "#847860"; ctx.font = "12px Asap, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("No booking data yet. Approve a few reservations and the chart fills in.", canvas.width / 2, 110);
    return;
  }
  const pad = { l: 36, r: 10, t: 14, b: 26 };
  const w = canvas.width - pad.l - pad.r;
  const h = canvas.height - pad.t - pad.b;
  const max = Math.max(...rows.map((r) => r.revenue)) * 1.15;
  const stepX = w / (rows.length - 1 || 1);
  const px = (i) => pad.l + i * stepX;
  const py = (v) => pad.t + h - (v / max) * h;

  // grid lines
  ctx.strokeStyle = "#84786022"; ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const y = pad.t + (h / 3) * g;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
  }
  // gold area fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  grad.addColorStop(0, "#D9B23F8C"); grad.addColorStop(1, "#D9B23F05");
  ctx.beginPath();
  rows.forEach((r, i) => i ? ctx.lineTo(px(i), py(r.revenue)) : ctx.moveTo(px(0), py(r.revenue)));
  ctx.lineTo(px(rows.length - 1), pad.t + h); ctx.lineTo(px(0), pad.t + h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  // line + dots
  ctx.beginPath();
  rows.forEach((r, i) => i ? ctx.lineTo(px(i), py(r.revenue)) : ctx.moveTo(px(0), py(r.revenue)));
  ctx.strokeStyle = "#B8912F"; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = "#B8912F";
  rows.forEach((r, i) => { ctx.beginPath(); ctx.arc(px(i), py(r.revenue), 3.5, 0, 7); ctx.fill(); });
  // labels
  ctx.fillStyle = "#847860"; ctx.font = "11px Asap, sans-serif"; ctx.textAlign = "center";
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  rows.forEach((r, i) => ctx.fillText(names[Number(r.m) - 1], px(i), canvas.height - 8));
}

function renderPkgShare(list) {
  const colors = ["#B8912F", "#2E5D46", "#C4572E", "#D9B23F"];
  const max = Math.max(...list.map((x) => x.c), 1);
  $("pkg-share").innerHTML = list.length ? list.map((x, i) => `
    <div class="share-row">
      <span class="share-name">${x.name}</span>
      <span class="bar" style="width:${(x.c / max) * 100}%;background:${colors[i % 4]}"></span>
      <span class="share-c">${x.c}</span>
    </div>`).join("") : '<p class="muted">Nothing approved yet.</p>';
}

function renderUpcoming(list) {
  $("upcoming-list").innerHTML = list.length
    ? list.map((u) => `<div class="upcoming-row"><span>${u.guest}</span><span>${u.date} · ${u.package}</span></div>`).join("")
    : '<p class="muted">None on the calendar.</p>';
}

/* ============================================================
   boot
   ============================================================ */
function showError(id, msg) {
  $(id).textContent = msg;
  $(id).classList.remove("hidden");
}

(async function boot() {
  renderSteps();
  const saved = getUser();
  if (saved && getToken()) {
    try {
      const me = await api("/api/auth/me");
      user = me.user;
      showApp();
      return;
    } catch { clearSession(); }
  }
  showLogin();
})();