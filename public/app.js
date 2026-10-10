/* ============================================================
   Golden VB — frontend logic
   ============================================================ */

const $ = (id) => document.getElementById(id);
const peso = (n) => "₱" + Number(n || 0).toLocaleString("en-PH");
const todayISO = () => new Date().toLocaleDateString("sv-SE");

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];

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

async function api(path, method, body) {
  const options = { method: method || "GET", headers: { "Content-Type": "application/json" } };
  if (getToken()) options.headers["Authorization"] = "Bearer " + getToken();
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

let user = null;
let role = "customer";
let step = 0;
let packages = [];
let pkgId = null;
let availability = {};
let pickedDate = null;
let guests = 10;
let uploaded = false;
let reservationId = null;
let holdSeconds = 24 * 3600;
let holdTimer = null;
let queue = [];
let selectedQueueId = null;
let adminPoll = null;
let managerPoll = null;
let mgrQueue = [];
let mgrSelectedId = null;
let mgrCalendarDays = [];
let mgrPickedDate = null;
let adminHistory = [];
let adminHistoryFilter = "all";
let otpEmail = null; // holds email during OTP step

const PKG_ICONS = { "day-tour": "☀", "overnight": "🌙", "happy-stay": "★" };
const PKG_TAGS = {
  "day-tour": "Sun up to sun down",
  "overnight": "Under the string lights",
  "happy-stay": "The full golden weekend",
};
const STEP_NAMES = ["Package", "Date", "Details", "Deposit", "Voucher"];

/* ============================================================
   TOUR VIDEO — ambient autoplay + floating portrait mini player
   ============================================================ */
(function setupTourVideo() {
  const video    = document.getElementById("tour-video");
  const wrap     = document.getElementById("tour-wrap");
  const slot     = document.getElementById("tour-slot");
  const closeBtn = document.getElementById("tour-mini-close");
  if (!video || !slot || !wrap) return;

  video.muted = true;
  video.loop = true;

  let isMini = false;
  let userDismissed = false;
  let placeholder = null;

  function enterMini() {
    if (isMini || userDismissed) return;
    isMini = true;
    const rect = slot.getBoundingClientRect();
    placeholder = document.createElement("div");
    placeholder.className = "tour-slot-placeholder";
    placeholder.style.height = rect.height + "px";
    placeholder.style.width  = rect.width  + "px";
    slot.parentNode.insertBefore(placeholder, slot);
    document.body.appendChild(slot);
    slot.classList.add("mini");
    video.play().catch(() => {});
  }

  function exitMini() {
    if (!isMini) return;
    isMini = false;
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(slot, placeholder);
      placeholder.remove();
      placeholder = null;
    }
    slot.classList.remove("mini");
    video.play().catch(() => {});
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (visible) {
          exitMini(); userDismissed = false;
          video.play().catch(() => {});
        } else {
          if (!userDismissed) enterMini();
        }
      });
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    io.observe(wrap);
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation(); userDismissed = true; exitMini();
    });
  }

  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement === video) {
      video.muted = false; video.loop = false; video.currentTime = 0;
      video.play().catch(() => {});
    } else {
      video.muted = true; video.loop = true;
      video.play().catch(() => {});
    }
  });

  ["webkitbeginfullscreen", "webkitendfullscreen"].forEach((evt) => {
    video.addEventListener(evt, () => {
      const entering = evt === "webkitbeginfullscreen";
      if (entering) { video.muted = false; video.loop = false; video.currentTime = 0; }
      else { video.muted = true; video.loop = true; }
    });
  });

  slot.addEventListener("click", (e) => {
    if (!isMini) return;
    if (e.target === closeBtn) return;
    if (video.requestFullscreen) video.requestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });
})();

/* ============================================================
   VIEW SWITCHERS
   ============================================================ */
function showLanding() {
  $("view-landing").classList.remove("hidden");
  $("login-screen").classList.add("hidden");
  $("app-shell").classList.add("hidden");
  window.scrollTo(0, 0);
}
function showLogin() {
  $("view-landing").classList.add("hidden");
  $("app-shell").classList.add("hidden");
  $("login-screen").classList.remove("hidden");
  $("login-email").value = "";
  $("login-password").value = "";
  $("otp-code").value = "";
  $("login-error").classList.add("hidden");
  $("otp-error").classList.add("hidden");
  $("otp-info").textContent = "";
  $("otp-sent-to").textContent = "";
  $("register-form").classList.add("hidden");
  $("register-error").classList.add("hidden");
  $("invite-form").classList.add("hidden");
  $("invite-error").classList.add("hidden");
  $("otp-form").classList.add("hidden");
  $("login-form").classList.remove("hidden");
  $("guest-btn").classList.remove("hidden");
  $("show-register").classList.remove("hidden");
  $("show-invite").classList.remove("hidden");
  document.querySelector(".login-hint").classList.remove("hidden");
  document.querySelector(".login-divider").classList.remove("hidden");
  otpEmail = null;
}
function showApp() {
  $("view-landing").classList.add("hidden");
  $("login-screen").classList.add("hidden");
  $("app-shell").classList.remove("hidden");
  $("user-name").textContent = "Hi, " + user.name.split(" ")[0];

  const allowedByRole = {
    customer:  ["customer"],
    caretaker: ["customer", "caretaker"],
    manager:   ["customer", "manager"],
    admin:     ["customer", "admin"],
  };
  const allowed = allowedByRole[user.role] || ["customer"];
  document.querySelectorAll("#role-tabs .tab").forEach((t) => {
    t.classList.toggle("hidden", !allowed.includes(t.dataset.role));
  });
  switchRole(user.role);
  loadCustomer();
}

/* ============================================================
   LANDING
   ============================================================ */
document.querySelectorAll("[data-scroll]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.getElementById(el.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
$("nav-login").addEventListener("click", () => showLogin());
$("back-to-landing").addEventListener("click", () => showLanding());

async function bookNow() {
  if (user && getToken()) { showApp(); return; }
  try {
    const data = await api("/api/auth/guest", "POST");
    setSession(data.token, data.user);
    user = data.user;
    showApp();
  } catch (err) { alert("Couldn't start a booking session: " + err.message); }
}
$("cta-book").addEventListener("click", bookNow);
$("cta-book-2").addEventListener("click", bookNow);

/* ============================================================
   LOGIN SCREEN
   ============================================================ */
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

// --- login submit ---
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").classList.add("hidden");
  try {
    const data = await api("/api/auth/login", "POST", {
      email: $("login-email").value,
      password: $("login-password").value,
    });

    // If backend asks for OTP, switch to OTP screen
    if (data.otp_required) {
      otpEmail = data.email;
      $("login-form").classList.add("hidden");
      $("guest-btn").classList.add("hidden");
      $("show-register").classList.add("hidden");
      $("show-invite").classList.add("hidden");
      document.querySelector(".login-hint").classList.add("hidden");
      document.querySelector(".login-divider").classList.add("hidden");
      $("otp-form").classList.remove("hidden");
      $("otp-sent-to").textContent = "Sent to " + data.email;
      $("otp-code").value = "";
      $("otp-error").classList.add("hidden");
      $("otp-info").textContent = "";
      setTimeout(() => $("otp-code").focus(), 100);
      return;
    }

    // Normal login
    setSession(data.token, data.user);
    user = data.user;
    showApp();
  } catch (err) {
    $("login-error").textContent = err.message;
    $("login-error").classList.remove("hidden");
  }
});

// --- OTP verify ---
$("otp-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("otp-error").classList.add("hidden");
  $("otp-info").textContent = "";
  if (!otpEmail) return;
  const code = ($("otp-code").value || "").replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) {
    $("otp-error").textContent = "Enter the 6-digit code";
    $("otp-error").classList.remove("hidden");
    return;
  }
  try {
    const data = await api("/api/auth/otp/verify", "POST", { email: otpEmail, code });
    setSession(data.token, data.user);
    user = data.user;
    otpEmail = null;
    showApp();
  } catch (err) {
    $("otp-error").textContent = err.message;
    $("otp-error").classList.remove("hidden");
  }
});

// --- OTP resend ---
$("otp-resend").addEventListener("click", async () => {
  if (!otpEmail) return;
  $("otp-info").textContent = "Sending a new code…";
  try {
    const r = await api("/api/auth/otp/resend", "POST", { email: otpEmail });
    $("otp-info").textContent = "✓ " + (r.message || "New code sent.");
  } catch (err) {
    $("otp-info").textContent = err.message;
  }
});

// --- OTP back to login ---
$("otp-back").addEventListener("click", () => showLogin());

// --- register caretaker ---
$("show-register").addEventListener("click", () => {
  $("login-form").classList.add("hidden");
  $("guest-btn").classList.add("hidden");
  $("show-register").classList.add("hidden");
  $("show-invite").classList.add("hidden");
  document.querySelector(".login-hint").classList.add("hidden");
  document.querySelector(".login-divider").classList.add("hidden");
  $("register-form").classList.remove("hidden");
});
$("cancel-register").addEventListener("click", () => showLogin());

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

// --- invite code ---
$("show-invite").addEventListener("click", () => {
  $("login-form").classList.add("hidden");
  $("guest-btn").classList.add("hidden");
  $("show-register").classList.add("hidden");
  $("show-invite").classList.add("hidden");
  document.querySelector(".login-hint").classList.add("hidden");
  document.querySelector(".login-divider").classList.add("hidden");
  $("invite-form").classList.remove("hidden");
});
$("cancel-invite").addEventListener("click", () => showLogin());

$("invite-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("invite-error").classList.add("hidden");
  try {
    const data = await api("/api/auth/apply-admin", "POST", {
      code:     $("inv-code").value,
      name:     $("inv-name").value,
      email:    $("inv-email").value,
      password: $("inv-password").value,
      phone:    $("inv-phone").value || null,
    });
    setSession(data.token, data.user);
    user = data.user;
    showApp();
  } catch (err) {
    $("invite-error").textContent = err.message;
    $("invite-error").classList.remove("hidden");
  }
});

$("logout-btn").addEventListener("click", () => {
  clearSession();
  user = null; role = "customer"; step = 0; pickedDate = null;
  uploaded = false; reservationId = null; holdSeconds = 24 * 3600;
  otpEmail = null;
  stopAdminPoll(); stopManagerPoll();
  showLanding();
});

/* ============================================================
   ROLE TABS
   ============================================================ */
function switchRole(next) {
  role = next;
  document.querySelectorAll("#role-tabs .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.role === role)
  );
  ["customer", "admin", "manager", "caretaker"].forEach((r) =>
    $("view-" + r).classList.toggle("hidden", r !== role)
  );
  stopAdminPoll(); stopManagerPoll();
  if (role === "admin")    { loadAdmin(); loadAdminStats(); loadInvites(); loadAdminHistory(); }
  if (role === "manager")  { loadManager(); }
  if (role === "caretaker") loadCaretaker();
}

document.querySelectorAll("#role-tabs .tab").forEach((t) => {
  t.addEventListener("click", () => switchRole(t.dataset.role));
});

/* ============================================================
   CUSTOMER
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
  } catch {
    showError("customer-error", "Couldn't reach the server. Is it running?");
  }
}

async function refreshAvailability() {
  const data = await api("/api/reservations/availability");
  availability = data.days;
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
    let cls = "cal-day"; let disabled = false;
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

$("g-minus").addEventListener("click", () => { if (guests > 1) guests--; $("g-count").textContent = guests; });
$("g-plus").addEventListener("click", () => { if (guests < currentPkg().max_guests) guests++; $("g-count").textContent = guests; });

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

  if (step === 0) { step = 1; }
  else if (step === 1) {
    if (!pickedDate) return;
    $("f-name").value  = $("f-name").value  || ((user.name === "Guest Customer") ? "" : (user.name || ""));
    $("f-phone").value = $("f-phone").value || (user.phone || "");
    $("f-email").value = $("f-email").value || ((user.email === "guest@goldenvb.ph") ? "" : (user.email || ""));
    step = 2;
  }
  else if (step === 2) {
    if (!$("f-name").value.trim() || !$("f-phone").value.trim()) {
      showError("customer-error", "Name and mobile number are required."); return;
    }
    try {
      const r = await api("/api/reservations", "POST", {
        package_id: pkgId, date: pickedDate, guests,
        guest_name: $("f-name").value,
        guest_phone: $("f-phone").value,
        guest_email: $("f-email").value || null,
      });
      reservationId = r.id;
      await refreshAvailability(); renderCalendars();
      step = 3;
      const pkg = currentPkg();
      $("deposit-line").textContent = "50% down (" + peso(Math.round(pkg.price / 2)) + ") holds your date. Unpaid holds auto-cancel in the database.";
    } catch (err) {
      showError("customer-error", err.message);
      await refreshAvailability(); renderCalendars();
      return;
    }
  }
  else if (step === 3) {
    if (!uploaded) return;
    try {
      await api("/api/reservations/" + reservationId + "/deposit", "POST", { proof_name: "deposit_proof_gcash.jpg" });
      step = 4; renderVoucher();
    } catch (err) { showError("customer-error", err.message); return; }
  } else { step++; }

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

$("visit-date").min = todayISO();
$("visit-book").addEventListener("click", async () => {
  $("visit-msg").textContent = "";
  if (!$("visit-date").value) return;
  try {
    const r = await api("/api/reservations/visits", "POST", { date: $("visit-date").value, time: $("visit-time").value, party_size: 2 });
    $("visit-msg").textContent = r.message;
    $("visit-date").value = "";
    renderVisits();
  } catch (err) { $("visit-msg").textContent = err.message; }
});

async function renderVisits() {
  try {
    const data = await api("/api/reservations/visits");
    $("visit-list").innerHTML = data.visits.length
      ? data.visits.map((v) => `<span class="chip">${v.date} · ${v.time}</span>`).join("")
      : "";
  } catch {}
}

/* ============================================================
   ADMIN
   ============================================================ */
const fmtHoldLeft = (expiresAt) => {
  const ms = new Date(expiresAt) - Date.now();
  if (!expiresAt || ms <= 0) return "expiring...";
  const s = Math.floor(ms / 1000);
  if (s >= 3600) return Math.floor(s / 3600) + "h " + String(Math.floor((s % 3600) / 60)).padStart(2, "0") + "m left";
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + " left";
};

const STATUS_LABELS = { verify: "Verify deposit", hold: "On hold", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", completed: "Completed", scheduled: "Scheduled", arrived: "Arrived", no_show: "No-show" };

async function loadAdmin() {
  try {
    const data = await api("/api/reservations");
    queue = data.reservations;
    if (!selectedQueueId && queue.length) selectedQueueId = queue[0].id;
    $("verify-count").textContent = queue.filter((r) => r.status === "verify").length + " deposits to verify";
    renderQueue();
    $("admin-error").classList.add("hidden");
  } catch (err) { showError("admin-error", err.message); }
  adminPoll = setInterval(loadAdminQuiet, 5000);
}
async function loadAdminQuiet() {
  try {
    const data = await api("/api/reservations");
    queue = data.reservations;
    renderQueue();
    loadAdminStats();
  } catch {}
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
    body = `<div class="detail-center"><p class="icon">✅</p><p style="font-weight:700;margin-top:6px">Voucher issued</p><p class="mono" style="color:var(--gold-dark);margin-top:4px">${r.ref}</p><p class="muted" style="margin-top:6px">Guest notified by SMS and email.</p></div>`;
  } else {
    body = `<div class="detail-center"><p class="icon">${r.status === "cancelled" ? "⌛" : "✖"}</p><p style="font-weight:700;margin-top:6px">${r.status === "cancelled" ? "Hold expired" : "Request declined"}</p><p class="muted" style="margin-top:6px">${r.status === "cancelled" ? "The date is available again." : "The guest has been notified."}</p></div>`;
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

window.reviewReservation = async (id, action) => {
  try {
    await api("/api/reservations/" + id + "/review", "POST", { action });
    await loadAdminQuiet();
  } catch (err) { showError("admin-error", err.message); }
};

$("invite-create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("invite-create-msg");
  msg.textContent = ""; msg.classList.remove("error", "success");
  try {
    const data = await api("/api/admin/invites", "POST", {
      email: $("new-inv-email").value,
      name:  $("new-inv-name").value  || null,
      role:  $("new-inv-role").value,
    });
    msg.classList.add("success");
    msg.innerHTML = `✓ Invite created. Code: <span class="invite-code">${data.invite.code}</span><br>${data.note}`;
    e.target.reset();
    loadInvites();
  } catch (err) { msg.classList.add("error"); msg.textContent = err.message; }
});

async function loadInvites() {
  try {
    const data = await api("/api/admin/invites");
    const now = new Date();
    $("invite-list").innerHTML = data.invites.length ? data.invites.map((i) => {
      let status = "active";
      if (i.revoked) status = "revoked";
      else if (i.used_at) status = "used";
      else if (new Date(i.expires_at) < now) status = "expired";
      return `<div class="invite-row"><span class="invite-code">${i.code}</span><span>${i.email}</span><span>${i.role}</span><span>${i.name || "—"}</span><span class="status-pill status-${status}">${status}</span></div>`;
    }).join("") : '<p class="muted">No invites yet.</p>';
  } catch (err) { $("invite-list").innerHTML = `<p class="error">${err.message}</p>`; }
}

async function loadAdminHistory() {
  try {
    const data = await api("/api/admin/history");
    adminHistory = data.records || [];
    renderAdminHistory();
  } catch (err) { $("admin-history").innerHTML = `<p class="error">${err.message}</p>`; }
}

function renderHistoryFilters() {
  const filters = ["all", "booking", "visit", "approved", "verify", "hold", "completed", "cancelled"];
  $("history-filter").innerHTML = filters.map((s) =>
    `<button class="day-chip ${s === adminHistoryFilter ? "active" : ""}" data-hfilter="${s}">${s}</button>`
  ).join("");
  document.querySelectorAll("[data-hfilter]").forEach((b) =>
    b.addEventListener("click", () => {
      adminHistoryFilter = b.dataset.hfilter;
      renderHistoryFilters(); renderAdminHistory();
    })
  );
}

function renderHistorySummary(rows) {
  const totals = {
    all: rows.length,
    booking: rows.filter((r) => r.type === "booking").length,
    visit: rows.filter((r) => r.type === "visit").length,
    completed: rows.filter((r) => r.status === "completed").length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
  };
  return `
    <div class="history-summary">
      <div class="stat"><p class="n">${totals.all}</p><p class="k">Total records</p></div>
      <div class="stat"><p class="n">${totals.booking}</p><p class="k">Bookings</p></div>
      <div class="stat"><p class="n">${totals.visit}</p><p class="k">Ocular visits</p></div>
      <div class="stat"><p class="n">${totals.completed}</p><p class="k">Completed</p></div>
      <div class="stat"><p class="n">${totals.cancelled}</p><p class="k">Cancelled</p></div>
    </div>`;
}

function renderAdminHistory() {
  const container = $("admin-history");
  const summaryEl = document.getElementById("admin-history-summary");
  if (summaryEl) summaryEl.innerHTML = renderHistorySummary(adminHistory);
  renderHistoryFilters();
  let rows = adminHistory;
  if (adminHistoryFilter === "booking" || adminHistoryFilter === "visit") {
    rows = rows.filter((r) => r.type === adminHistoryFilter);
  } else if (adminHistoryFilter !== "all") {
    rows = rows.filter((r) => r.status === adminHistoryFilter);
  }
  if (!rows.length) { container.innerHTML = '<div class="history-empty">No records match this filter.</div>'; return; }
  container.innerHTML = '<div class="history-list">' + rows.map((r) => {
    const [y, m, d] = (r.date || "").split("-");
    const dayNum = d || "—";
    const monthYear = m ? `${MONTHS_SHORT[Number(m) - 1]} ${y}` : "";
    const isVisit = r.type === "visit";
    const typeBadge = isVisit
      ? '<span class="type-badge visit">Ocular visit</span>'
      : '<span class="type-badge booking">Booking</span>';
    const title = isVisit ? `Ocular visit · ${r.time || ""}` : `Reservation #${r.id} — ${r.guest_name || "Guest"}`;
    const sub = isVisit ? `${r.guests} pax visit` : `${r.package_id} · ${r.guests} pax · ref ${r.ref || "—"}`;
    const metaParts = [];
    if (r.created_at) metaParts.push(`<b>Booked</b> ${r.created_at.slice(0, 10)}`);
    if (r.completed_at) metaParts.push(`<b>Completed</b> ${r.completed_at.slice(0, 10)} by ${r.completed_by_name || "—"}`);
    if (r.cancelled_at) metaParts.push(`<b>Cancelled</b> ${r.cancelled_at.slice(0, 10)} by ${r.cancelled_by_name || "—"}`);
    const meta = metaParts.join(" · ");
    return `
      <div class="history-item ${isVisit ? "type-visit" : "type-booking"}">
        <div class="date-col"><p class="day">${dayNum}</p><p class="month-year">${monthYear}</p></div>
        <div class="main-col">
          <div class="title-row">${typeBadge}<span class="title">${title}</span></div>
          <p class="sub">${sub}</p>
          ${meta ? `<p class="meta">${meta}</p>` : ""}
        </div>
        <div class="right-col">
          ${r.deposit_amount != null ? `<span class="amount">${peso(r.deposit_amount)}</span>` : ""}
          <span class="status-chip status-${r.status}">${r.status}</span>
        </div>
      </div>`;
  }).join("") + "</div>";
}

/* ============================================================
   MANAGER
   ============================================================ */
async function loadManager() {
  try {
    const [overview, queueData, schedule, payments, caretakers, calendar] = await Promise.all([
      api("/api/manager/overview"),
      api("/api/manager/queue"),
      api("/api/manager/schedule"),
      api("/api/manager/payments"),
      api("/api/manager/caretakers"),
      api("/api/manager/calendar"),
    ]);
    mgrQueue = queueData.queue || [];
    if (!mgrSelectedId && mgrQueue.length) mgrSelectedId = mgrQueue[0].id;
    mgrCalendarDays = calendar.days || [];
    $("mgr-pending-count").textContent = overview.queue.pending + " deposits to verify";

    const pkgSelect = $("wi-package");
    if (pkgSelect) {
      if (!packages.length) {
        try { const pkgs = await api("/api/reservations/packages"); packages = pkgs.packages || []; } catch {}
      }
      if (packages.length) {
        const previous = pkgSelect.value;
        pkgSelect.innerHTML = packages.map((p) => `<option value="${p.id}">${p.name} — ${peso(p.price)}</option>`).join("");
        if (previous) pkgSelect.value = previous;
      } else {
        pkgSelect.innerHTML = '<option value="">No packages available</option>';
      }
    }

    renderMgrStats(overview);
    renderMgrCalendar();
    renderMgrQueue();
    renderMgrSchedule(schedule.schedule);
    renderMgrPayments(payments.payments);
    renderMgrCaretakers(caretakers.caretakers);
    $("manager-error").classList.add("hidden");
  } catch (err) { showError("manager-error", err.message); }
  managerPoll = setInterval(loadManagerQuiet, 5000);
}
async function loadManagerQuiet() {
  try {
    const [overview, queueData, calendar] = await Promise.all([
      api("/api/manager/overview"),
      api("/api/manager/queue"),
      api("/api/manager/calendar"),
    ]);
    mgrQueue = queueData.queue || [];
    mgrCalendarDays = calendar.days || [];
    renderMgrStats(overview);
    renderMgrCalendar();
    renderMgrQueue();
  } catch {}
}
function stopManagerPoll() { clearInterval(managerPoll); }

function renderMgrStats(o) {
  const stats = [
    { icon: "📅", value: o.today.length, label: "Bookings today",  sub: "approved arrivals" },
    { icon: "⏱", value: o.queue.pending,  label: "Pending deposits", sub: "need your verification" },
    { icon: "⏳", value: o.queue.holds,   label: "Active holds",   sub: "pencil bookings" },
    { icon: "✅", value: o.approved,       label: "Approved",       sub: "on the books" },
  ];
  $("mgr-stat-grid").innerHTML = stats.map((x) => `
    <div class="stat-card">
      <span class="icon">${x.icon}</span>
      <p class="value">${x.value}</p>
      <p class="lbl">${x.label}</p>
      <p class="sub">${x.sub}</p>
    </div>`).join("");
}

function renderMgrCalendar() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const curr = new Date(now.getFullYear(), now.getMonth(), 1);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  renderMgrMonth($("mgr-cal-1"), prev.getFullYear(), prev.getMonth());
  renderMgrMonth($("mgr-cal-2"), curr.getFullYear(), curr.getMonth());
  renderMgrMonth($("mgr-cal-3"), next.getFullYear(), next.getMonth());
  renderMgrCalendarDetail();
}

function renderMgrMonth(el, year, month) {
  if (!el) return;
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayISO();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const byDate = {};
  for (const d of mgrCalendarDays) if (d.date.startsWith(monthPrefix)) byDate[d.date] = d;
  let html = `<p class="cal-title">${MONTHS[month]} <span class="muted">${year}</span></p><div class="cal-grid">`;
  DOW.forEach((d) => { html += `<span class="cal-dow">${d}</span>`; });
  for (let i = 0; i < firstDow; i++) html += "<span></span>";
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const day = byDate[iso];
    let cls = "cal-day";
    if (iso === today) cls += " today";
    if (iso === mgrPickedDate) cls += " selected";
    if (day) {
      const hasApproved = day.bookings.some((b) => b.status === "approved");
      const hasVerify   = day.bookings.some((b) => b.status === "verify");
      const hasHold     = day.bookings.some((b) => b.status === "hold");
      const hasVisits   = day.visits.length > 0;
      if (hasApproved || hasVerify) { cls += " booked"; if (hasVisits) cls += " has-visit"; }
      else if (hasVisits) { cls += " mgr-visit"; }
      else if (hasHold) { cls += " held"; }
    }
    html += `<button type="button" class="${cls}" data-mgrday="${iso}">${d}</button>`;
  }
  html += `</div>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-mgrday]").forEach((b) =>
    b.addEventListener("click", () => { mgrPickedDate = b.dataset.mgrday; renderMgrCalendar(); renderMgrCalendarDetail(); })
  );
}

function renderMgrCalendarDetail() {
  const box = $("mgr-calendar-detail");
  if (!box) return;
  if (!mgrPickedDate) {
    box.innerHTML = '<p class="muted">Click any date on the calendars above to see the bookings and ocular visits for that day.</p>';
    return;
  }
  const day = mgrCalendarDays.find((d) => d.date === mgrPickedDate);
  if (!day) {
    box.innerHTML = `<p class="label">${mgrPickedDate}</p><p class="muted" style="margin-top:8px">Nothing scheduled on this date.</p>`;
    return;
  }
  const bookings = day.bookings.length
    ? day.bookings.map((b) => `
        <div class="upcoming-row" style="display:grid;grid-template-columns:1fr auto auto auto auto;gap:12px;align-items:center">
          <span>${b.guest} · ${b.guests} pax · ${b.package_id}${b.source === "walk-in" ? " · walk-in" : ""}</span>
          <span class="status-chip status-${b.status}">${STATUS_LABELS[b.status] || b.status}</span>
          <span>${peso(b.deposit_amount)}</span>
          ${b.status === "approved" ? `<button class="btn btn-outline-terra" onclick="mgrComplete(${b.id})">Mark completed</button>` : ""}
          ${["completed","cancelled"].includes(b.status) ? `<button class="btn btn-outline-terra" onclick="mgrDeleteReservation(${b.id})">Delete</button>` : ""}
        </div>
      `).join("")
    : '<p class="muted">No bookings on this date.</p>';
  const visits = day.visits.length
    ? day.visits.map((v) => `
        <div class="upcoming-row" style="display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center">
          <span>${v.time} · ${v.party_size} pax</span>
          <span class="status-chip status-${v.status}">${STATUS_LABELS[v.status] || v.status}</span>
          <span style="display:flex;gap:6px">
            <button class="btn btn-green" onclick="mgrCompleteVisit(${v.id})">Mark completed</button>
            <button class="btn btn-outline-terra" onclick="mgrCancelVisit(${v.id})">Cancel visit</button>
          </span>
        </div>
      `).join("")
    : '<p class="muted">No ocular visits on this date.</p>';
  box.innerHTML = `
    <p class="label">${mgrPickedDate}</p>
    <p class="panel-sub" style="margin-top:8px">Bookings</p>
    <div>${bookings}</div>
    <p class="panel-sub" style="margin-top:14px">Ocular visits</p>
    <div>${visits}</div>`;
}

window.mgrComplete = async (id) => {
  if (!confirm("Mark this reservation as completed?")) return;
  try { await api("/api/manager/reservations/" + id + "/complete", "POST"); await loadManagerQuiet(); }
  catch (err) { showError("manager-error", err.message); }
};
window.mgrCompleteVisit = async (id) => {
  if (!confirm("Mark this ocular visit as completed?")) return;
  try { await api("/api/manager/visits/" + id + "/complete", "POST"); await loadManagerQuiet(); }
  catch (err) { showError("manager-error", err.message); }
};
window.mgrCancelVisit = async (id) => {
  if (!confirm("Cancel this ocular visit? The caretaker will no longer see it.")) return;
  try { await api("/api/manager/visits/" + id + "/cancel", "POST"); await loadManagerQuiet(); }
  catch (err) { showError("manager-error", err.message); }
};
window.mgrDeleteReservation = async (id) => {
  if (!confirm("Permanently delete this reservation? The admin will still have a record of it.")) return;
  try { await api("/api/manager/reservations/" + id, "DELETE"); await loadManagerQuiet(); }
  catch (err) { showError("manager-error", err.message); }
};

function renderMgrQueue() {
  $("mgr-queue-list").innerHTML = mgrQueue.length ? mgrQueue.map((r) => `
    <button type="button" class="queue-item ${r.id === mgrSelectedId ? "active" : ""}" data-mqid="${r.id}">
      <div class="row1">
        <span class="name">${r.guest_name || "Guest"}</span>
        ${r.source === "walk-in" ? '<span class="status-chip" style="background:var(--gold-bg);color:var(--gold-dark)">Walk-in</span>' : ""}
        <span class="status-chip status-${r.status}">${STATUS_LABELS[r.status] || r.status}</span>
        <span class="amount">${peso(r.deposit_amount)}</span>
      </div>
      <p class="meta">${r.date} · ${r.guests} guests</p>
    </button>
  `).join("") : '<p class="muted">No active reservations.</p>';
  document.querySelectorAll("[data-mqid]").forEach((b) =>
    b.addEventListener("click", () => { mgrSelectedId = Number(b.dataset.mqid); renderMgrQueue(); renderMgrDetail(); })
  );
  renderMgrDetail();
}

function renderMgrDetail() {
  const r = mgrQueue.find((x) => x.id === mgrSelectedId);
  if (!r) { $("mgr-queue-detail").innerHTML = '<p class="muted">Select a reservation.</p>'; return; }
  const actions = [];
  if (r.status === "verify" || r.status === "hold") actions.push(`<button class="btn btn-green" onclick="mgrVerify(${r.id})">Verify & approve</button>`);
  if (r.status !== "cancelled") actions.push(`<button class="btn btn-outline-terra" onclick="mgrCancel(${r.id})">Cancel</button>`);
  if (["cancelled", "rejected", "completed"].includes(r.status)) actions.push(`<button class="btn btn-outline-terra" onclick="mgrDeleteReservation(${r.id})">Delete permanently</button>`);
  $("mgr-queue-detail").innerHTML = `
    <p style="font-weight:700;font-size:14px">Reservation #${r.id}
      <span class="status-chip status-${r.status}" style="float:right">${STATUS_LABELS[r.status] || r.status}</span>
    </p>
    ${r.source === "walk-in" ? '<p class="label" style="margin-top:8px">WALK-IN BOOKING</p>' : ""}
    <div class="detail-meta" style="margin-top:12px">
      <div class="r"><span>Guest</span><span>${r.guest_name || "—"}</span></div>
      <div class="r"><span>Email</span><span>${r.guest_email || "—"}</span></div>
      <div class="r"><span>Phone</span><span>${r.guest_phone || "—"}</span></div>
      <div class="r"><span>Date</span><span>${r.date}</span></div>
      <div class="r"><span>Guests</span><span>${r.guests}</span></div>
      <div class="r"><span>Deposit</span><span>${peso(r.deposit_amount)}</span></div>
      <div class="r"><span>Ref</span><span class="mono">${r.ref || "—"}</span></div>
    </div>
    <div class="detail-actions" style="margin-top:16px">${actions.join("")}</div>`;
}

window.mgrVerify = async (id) => {
  try { await api("/api/manager/reservations/" + id + "/verify", "POST"); await loadManagerQuiet(); }
  catch (err) { showError("manager-error", err.message); }
};
window.mgrCancel = async (id) => {
  try { await api("/api/manager/reservations/" + id + "/cancel", "POST"); await loadManagerQuiet(); }
  catch (err) { showError("manager-error", err.message); }
};

function renderMgrSchedule(list) {
  $("mgr-schedule-list").innerHTML = list.length ? list.map((r) => `
    <div class="upcoming-row">
      <span>${r.date}</span>
      <span>${r.guest_name || "Guest"} · ${r.guests} pax${r.source === "walk-in" ? " · walk-in" : ""}</span>
      <span class="mono">${r.ref || "—"}</span>
    </div>
  `).join("") : '<p class="muted">No approved bookings in the next 30 days.</p>';
}

function renderMgrPayments(list) {
  $("mgr-payments-list").innerHTML = list.length ? list.map((p) => `
    <div class="upcoming-row">
      <span>${p.date}</span>
      <span>${p.guest_name || "Guest"} · ${peso(p.deposit_amount)}</span>
      <span class="status-chip status-${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
    </div>
  `).join("") : '<p class="muted">No deposits on file yet.</p>';
}

function renderMgrCaretakers(list) {
  $("mgr-caretakers-list").innerHTML = list.length ? list.map((c) => `
    <div class="upcoming-row">
      <span>${c.name}</span>
      <span>${c.email}</span>
      <span>${c.phone || "—"}</span>
    </div>
  `).join("") : '<p class="muted">No caretakers on staff yet.</p>';
}

document.addEventListener("submit", async (e) => {
  if (e.target && e.target.id === "walkin-form") {
    e.preventDefault();
    const msg = $("walkin-msg");
    msg.textContent = ""; msg.classList.remove("error", "success");
    const body = {
      guest_name:   $("wi-name").value,
      guest_phone:  $("wi-phone").value,
      guest_email:  $("wi-email").value || null,
      package_id:   $("wi-package").value,
      date:         $("wi-date").value,
      guests:       Number($("wi-guests").value) || 1,
      deposit_amount: Number($("wi-deposit").value) || undefined,
    };
    try {
      const r = await api("/api/manager/walk-in", "POST", body);
      msg.classList.add("success");
      msg.textContent = "✓ " + r.message;
      e.target.reset();
      await loadManagerQuiet();
    } catch (err) {
      msg.classList.add("error");
      msg.textContent = err.message;
    }
  }
});

/* ============================================================
   CARETAKER
   ============================================================ */
async function loadCaretaker() {
  $("today-label").textContent = new Date().toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  try {
    const arrivals = await api("/api/reservations/arrivals");
    renderArrivals(arrivals.arrivals, $("arrivals-list"), "today");
    renderArrivals(arrivals.tomorrow, $("arrivals-tomorrow"), "tomorrow");
  } catch (err) { showError("caretaker-error", err.message); }

  try {
    const visits = await api("/api/reservations/visits");
    $("caretaker-visits").innerHTML = visits.visits.length
      ? '<div class="visit-timeline">' + visits.visits.map((v) => `
          <div class="visit-stop">
            <p class="name">Visit</p>
            <p class="meta">${v.date} · ${v.time} · party of ${v.party_size}</p>
            <span class="status-chip status-${v.status}">${v.status}</span>
            <div style="display:flex;gap:6px;margin-top:8px">
              ${v.status === "scheduled" ? `<button class="checkin-btn" onclick="visitArrived(${v.id})">✓ Guest arrived</button>` : ""}
              ${v.status === "scheduled" ? `<button class="checkin-btn" onclick="visitNoShow(${v.id})">✖ No-show</button>` : ""}
            </div>
          </div>`).join("") + "</div>"
      : '<p class="muted">No visits scheduled.</p>';
  } catch {}

  try {
    const av = await api("/api/reservations/availability");
    renderWalkin(av.days);
  } catch (err) { showError("caretaker-error", err.message); }
}

function renderArrivals(list, el, scope) {
  if (!el) return;
  const emptyMsg = scope === "today" ? "No approved guests arriving today." : "No approved guests arriving tomorrow.";
  el.innerHTML = list.length ? list.map((a) => `
    <div class="arrival ${a.checked_in ? "in" : ""}">
      <div class="top">
        <span class="name">${a.guest}</span>
        <span class="ref">${a.ref || ""}</span>
      </div>
      <p class="meta">${a.package} · ${a.guests} pax ${a.source === "walk-in" ? '· <b>walk-in</b>' : ""}</p>
      ${a.checked_in_at ? `<p class="meta" style="color:var(--green)">Arrived at ${new Date(a.checked_in_at).toLocaleTimeString("en-PH",{hour:"numeric",minute:"2-digit"})}</p>` : ""}
      ${scope === "today" ? `
        <button class="checkin-btn ${a.checked_in ? "in" : ""}" onclick="toggleCheckin(${a.id})">
          ${a.checked_in ? "✓ Arrived · Undo" : "Mark arrived"}
        </button>
        <div style="margin-top:6px">
          <input class="note-input" placeholder="Note (e.g. extra towels)" value="${a.note || ""}" data-note-id="${a.id}" />
        </div>
      ` : ""}
    </div>
  `).join("") : `<p class="muted">${emptyMsg}</p>`;

  el.querySelectorAll("[data-note-id]").forEach((input) => {
    input.addEventListener("blur", async () => {
      try { await api("/api/reservations/" + input.dataset.noteId + "/note", "POST", { note: input.value }); }
      catch {}
    });
  });
}

window.toggleCheckin = async (id) => {
  try {
    await api("/api/reservations/" + id + "/checkin", "POST");
    const arrivals = await api("/api/reservations/arrivals");
    renderArrivals(arrivals.arrivals, $("arrivals-list"), "today");
    renderArrivals(arrivals.tomorrow, $("arrivals-tomorrow"), "tomorrow");
  } catch (err) { showError("caretaker-error", err.message); }
};

window.visitArrived = async (id) => {
  try { await api("/api/reservations/visits/" + id + "/arrived", "POST"); await loadCaretaker(); }
  catch (err) { showError("caretaker-error", err.message); }
};

window.visitNoShow = async (id) => {
  if (!confirm("Mark this visit as a no-show?")) return;
  try { await api("/api/reservations/visits/" + id + "/no-show", "POST"); await loadCaretaker(); }
  catch (err) { showError("caretaker-error", err.message); }
};

function renderWalkin(days) {
  const next = [];
  const d = new Date();
  for (let i = 0; i < 10; i++) { next.push(d.toLocaleDateString("sv-SE")); d.setDate(d.getDate() + 1); }
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
   ADMIN STATS + CHARTS
   ============================================================ */
async function loadAdminStats() {
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
  } catch (err) { showError("owner-error", err.message); }
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
  if (!canvas) return;
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
  ctx.strokeStyle = "#84786022"; ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const y = pad.t + (h / 3) * g;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
  }
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  grad.addColorStop(0, "#D9B23F8C"); grad.addColorStop(1, "#D9B23F05");
  ctx.beginPath();
  rows.forEach((r, i) => i ? ctx.lineTo(px(i), py(r.revenue)) : ctx.moveTo(px(0), py(r.revenue)));
  ctx.lineTo(px(rows.length - 1), pad.t + h); ctx.lineTo(px(0), pad.t + h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  rows.forEach((r, i) => i ? ctx.lineTo(px(i), py(r.revenue)) : ctx.moveTo(px(0), py(r.revenue)));
  ctx.strokeStyle = "#B8912F"; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = "#B8912F";
  rows.forEach((r, i) => { ctx.beginPath(); ctx.arc(px(i), py(r.revenue), 3.5, 0, 7); ctx.fill(); });
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
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
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
  showLanding();
})();