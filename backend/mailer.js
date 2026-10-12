// server/mailer.js
import nodemailer from "nodemailer";

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "Golden Villa";

let transporter = null;
if (EMAIL_USER && EMAIL_APP_PASSWORD) {
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_APP_PASSWORD.replace(/\s+/g, ""), // Gmail app passwords sometimes have spaces
    },
  });
}

const FROM = `${EMAIL_FROM_NAME} <${EMAIL_USER || "no-reply@goldenvb.ph"}>`;

/* ---------- shared HTML shell ---------- */
function shell(title, bodyHtml) {
  return `
    <div style="font-family:Asap,Arial,sans-serif;background:#FBF7EE;padding:32px 16px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #eadfc9;box-shadow:0 4px 20px rgba(184,145,47,0.08)">
        <p style="font-family:Fraunces,serif;font-size:22px;color:#2E5D46;margin:0 0 4px;">☀ Golden Villa Private Resort</p>
        <p style="font-size:11px;letter-spacing:2px;color:#B8912F;margin:0 0 20px;text-transform:uppercase;">Malolos, Bulacan</p>
        <h1 style="font-family:Fraunces,serif;font-size:22px;color:#2b2416;margin:0 0 16px;">${title}</h1>
        ${bodyHtml}
        <p style="font-size:12px;color:#8a7a55;margin-top:28px;border-top:1px solid #eadfc9;padding-top:16px;line-height:1.6;">
          Golden Villa Private Resort · Malolos, Bulacan<br>
          📞 0917 555 0101
        </p>
      </div>
    </div>`;
}

/* ---------- OTP email ---------- */
export async function sendOtpEmail(to, code, { name, purpose } = {}) {
  const subject = purpose === "login"
    ? "Your Golden Villa login code"
    : "Your Golden Villa verification code";

  const body = `
    <p style="font-size:15px;color:#4a3f2b;margin:0 0 12px;">Hi ${name || "there"},</p>
    <p style="font-size:15px;color:#4a3f2b;margin:0 0 20px;">Use this 6-digit code to continue. It expires in 5 minutes.</p>
    <p style="font-family:ui-monospace,monospace;font-size:34px;letter-spacing:12px;text-align:center;color:#B8912F;background:#FFF9E6;padding:18px;border-radius:12px;margin:0 0 20px;font-weight:700;">${code}</p>
    <p style="font-size:13px;color:#8a7a55;margin:0;">If you didn't request this, you can ignore this email.</p>
  `;

  const html = shell("Verification code", body);

  if (!transporter) {
    console.log(`[mailer] (no email configured) would send OTP to ${to}: ${code}`);
    return { ok: true, preview: true };
  }

  return transporter.sendMail({ from: FROM, to, subject, html });
}

/* ---------- Reservation voucher email ---------- */
export async function sendReservationVoucherEmail(to, reservation, pkg) {
  if (!to) return { ok: false, error: "no_email" };

  const ref = reservation.ref || `GVB-2026-${String(reservation.id).padStart(4, "0")}`;
  const dateLabel = new Date(reservation.date + "T00:00:00").toLocaleDateString("en-PH", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const deposit = reservation.deposit_amount
    ? "₱" + Number(reservation.deposit_amount).toLocaleString("en-PH")
    : "—";

  const subject = `Your Golden Villa booking — ${ref}`;

  const body = `
    <p style="font-size:15px;color:#4a3f2b;margin:0 0 16px;">Hi ${reservation.guest_name || "there"},</p>
    <p style="font-size:15px;color:#4a3f2b;margin:0 0 20px;">
      We received your deposit and your date is now on hold pending admin verification.
      Here are your booking details:
    </p>

    <div style="background:#FFF9E6;border:2px dashed #B8912F;border-radius:14px;padding:20px;margin:0 0 20px;">
      <p style="font-size:11px;letter-spacing:2px;color:#B8912F;margin:0 0 6px;text-transform:uppercase;font-weight:700;">Your reference number</p>
      <p style="font-family:ui-monospace,monospace;font-size:26px;font-weight:700;color:#2b2416;margin:0 0 14px;letter-spacing:2px;">${ref}</p>
      <p style="font-size:13px;color:#8a3a1a;margin:0;background:#FFF1E6;padding:10px;border-radius:8px;border-left:3px solid #C4572E;">
        <b>Save this email.</b> You'll need this reference for check-in, refunds, or looking up your booking.
      </p>
    </div>

    <table style="width:100%;font-size:14px;color:#2b2416;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#8a7a55;">Guest</td><td style="padding:8px 0;text-align:right;font-weight:600;">${reservation.guest_name || "—"}</td></tr>
      <tr><td style="padding:8px 0;color:#8a7a55;border-top:1px solid #f0e7d2;">Mobile</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f0e7d2;">${reservation.guest_phone || "—"}</td></tr>
      <tr><td style="padding:8px 0;color:#8a7a55;border-top:1px solid #f0e7d2;">Date</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f0e7d2;">${dateLabel}</td></tr>
      <tr><td style="padding:8px 0;color:#8a7a55;border-top:1px solid #f0e7d2;">Package</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f0e7d2;">${pkg?.name || reservation.package_id}</td></tr>
      <tr><td style="padding:8px 0;color:#8a7a55;border-top:1px solid #f0e7d2;">Guests</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f0e7d2;">${reservation.guests}</td></tr>
      <tr><td style="padding:8px 0;color:#8a7a55;border-top:1px solid #f0e7d2;">Deposit</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f0e7d2;color:#2E5D46;">${deposit}</td></tr>
      ${reservation.promo_code ? `<tr><td style="padding:8px 0;color:#8a7a55;border-top:1px solid #f0e7d2;">Promo</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f0e7d2;">${reservation.promo_code}</td></tr>` : ""}
    </table>

    <p style="font-size:14px;color:#4a3f2b;margin:24px 0 8px;">
      <b>What's next?</b> Our admin will verify your deposit and you'll receive a follow-up email once your booking is confirmed.
    </p>
    <p style="font-size:13px;color:#8a7a55;margin:0;">
      Need to change or cancel? Visit our website and click <b>Find my booking</b> — enter your reference number and name to manage it.
    </p>
  `;

  const html = shell("Your booking is on file", body);

  if (!transporter) {
    console.log(`[mailer] (no email configured) would send voucher for ${ref} to ${to}`);
    return { ok: true, preview: true };
  }

  try {
    const info = await transporter.sendMail({ from: FROM, to, subject, html });
    return { ok: true, info };
  } catch (err) {
    console.error("[mailer] voucher send failed:", err.message);
    return { ok: false, error: err.message };
  }
}