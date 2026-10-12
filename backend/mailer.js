/* ============================================================
   mailer.js — sends OTP + notification emails via Resend API
   (HTTPS-based, works on Render's free tier)
   ============================================================ */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.EMAIL_USER || "onboarding@resend.dev";
const FROM_NAME = process.env.EMAIL_FROM_NAME || "Golden Villa Resort";

const FROM_HEADER = `${FROM_NAME} <${FROM_EMAIL}>`;

async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_HEADER,
      to: [to],
      subject,
      html,
      text: text || undefined,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[mailer] Resend error:", data);
    throw new Error(data.message || data.error || "Failed to send email");
  }
  return data;
}

/* ============================================================
   OTP EMAIL
   ============================================================ */
export async function sendOtpEmail(toEmail, code, { name = "", purpose = "login" } = {}) {
  const intro = purpose === "refund"
    ? "You requested a refund verification for your booking."
    : "Someone is trying to log into your Golden Villa staff account.";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #2b2416;">
      <h2 style="font-family: Georgia, serif; color: #B8912F; margin: 0 0 8px;">Golden Villa Private Resort</h2>
      <p style="font-size: 13px; color: #8a7a55; margin: 0 0 24px; letter-spacing: 2px;">MALOLOS · BULACAN</p>

      <p style="font-size: 15px; margin: 0 0 12px;">Hi ${name || "there"},</p>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px;">${intro} Enter this code to continue:</p>

      <div style="text-align: center; padding: 24px; background: #FBF7EE; border-radius: 12px; margin: 24px 0;">
        <p style="font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 12px; color: #2b2416; margin: 0;">
          ${code}
        </p>
      </div>

      <p style="font-size: 13px; color: #8a7a55; margin: 0 0 24px;">
        This code expires in <b>5 minutes</b>. If you didn't request it, you can safely ignore this email.
      </p>

      <hr style="border: none; border-top: 1px solid #eadfc9; margin: 24px 0;" />
      <p style="font-size: 11px; color: #8a7a55; text-align: center; margin: 0;">
        Golden Villa Private Resort · Malolos, Bulacan<br>
        Do not reply to this email.
      </p>
    </div>
  `;

  const text = `Your Golden Villa ${purpose} code is: ${code}\n\nIt expires in 5 minutes.`;

  return sendEmail({
    to: toEmail,
    subject: `Your Golden Villa code: ${code}`,
    html,
    text,
  });
}

/* ============================================================
   RESERVATION CONFIRMATION (received — pending verification)
   ============================================================ */
export async function sendReservationEmail(toEmail, reservation) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #2b2416;">
      <h2 style="font-family: Georgia, serif; color: #B8912F; margin: 0 0 8px;">Golden Villa Private Resort</h2>
      <p>Hi ${reservation.guest_name || "there"},</p>
      <p>Your reservation has been received:</p>
      <ul style="font-size: 14px; line-height: 1.8;">
        <li><b>Reference:</b> ${reservation.ref || "pending approval"}</li>
        <li><b>Date:</b> ${reservation.date}</li>
        <li><b>Guests:</b> ${reservation.guests}</li>
      </ul>
      <p>We'll confirm once we verify your deposit.</p>
    </div>
  `;
  return sendEmail({ to: toEmail, subject: "Golden Villa reservation received", html });
}

/* ============================================================
   RESERVATION VOUCHER EMAIL — sent when admin approves a booking
   ============================================================ */
export async function sendReservationVoucherEmail(toEmail, reservation) {
  const ref = reservation.ref || "GVB-2026-" + String(reservation.id || 0).padStart(4, "0");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #2b2416;">
      <h2 style="font-family: Georgia, serif; color: #B8912F; margin: 0 0 8px;">Golden Villa Private Resort</h2>
      <p style="font-size: 13px; color: #8a7a55; margin: 0 0 24px; letter-spacing: 2px;">MALOLOS · BULACAN</p>

      <p style="font-size: 15px; margin: 0 0 12px;">Hi ${reservation.guest_name || "there"},</p>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
        Your reservation is confirmed! Here's your voucher:
      </p>

      <div style="background: #FBF7EE; border: 1px solid #eadfc9; border-radius: 14px; padding: 20px; margin: 20px 0;">
        <p style="font-family: Georgia, serif; font-size: 18px; color: #B8912F; margin: 0 0 6px;">Reservation Voucher</p>
        <p style="font-family: monospace; font-size: 18px; font-weight: 700; color: #2b2416; margin: 0 0 16px;">
          ${ref}
        </p>
        <p style="font-size: 14px; margin: 6px 0;"><b>Guest:</b> ${reservation.guest_name || "—"}</p>
        <p style="font-size: 14px; margin: 6px 0;"><b>Date:</b> ${reservation.date || "—"}</p>
        <p style="font-size: 14px; margin: 6px 0;"><b>Guests:</b> ${reservation.guests || "—"}</p>
        <p style="font-size: 14px; margin: 6px 0;"><b>Deposit:</b> ₱${Number(reservation.deposit_amount || 0).toLocaleString("en-PH")}</p>
      </div>

      <p style="font-size: 13px; color: #8a7a55; margin: 0 0 24px;">
        Present this reference at the gate. Need to cancel? Visit our website and use
        <b>Find my booking</b> to request a refund (up to 7 days before your check-in date).
      </p>

      <hr style="border: none; border-top: 1px solid #eadfc9; margin: 24px 0;" />
      <p style="font-size: 11px; color: #8a7a55; text-align: center; margin: 0;">
        Golden Villa Private Resort · Malolos, Bulacan<br>
        Do not reply to this email.
      </p>
    </div>
  `;

  const text = `Your Golden Villa reservation is confirmed.\nReference: ${ref}\nDate: ${reservation.date}\n\nPresent this reference at the gate.`;

  return sendEmail({
    to: toEmail,
    subject: `Golden Villa reservation confirmed — ${ref}`,
    html,
    text,
  });
}

/* ============================================================
   REFUND STATUS EMAIL — sent when a refund is approved/paid
   ============================================================ */
export async function sendRefundStatusEmail(toEmail, refund, reservation) {
  const ref = reservation?.ref || "GVB-2026-" + String(reservation?.id || 0).padStart(4, "0");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #2b2416;">
      <h2 style="font-family: Georgia, serif; color: #B8912F; margin: 0 0 8px;">Golden Villa Private Resort</h2>
      <p>Hi ${reservation?.guest_name || "there"},</p>
      <p>Your refund for reservation <b>${ref}</b> has been <b>${refund.status}</b>.</p>
      <p><b>Amount:</b> ₱${Number(refund.amount || 0).toLocaleString("en-PH")}</p>
      <p><b>Method:</b> ${refund.method}</p>
      ${refund.reference_number ? `<p><b>Reference:</b> ${refund.reference_number}</p>` : ""}
      <p>Thank you for choosing Golden Villa.</p>
    </div>
  `;
  return sendEmail({ to: toEmail, subject: `Golden Villa refund ${refund.status}`, html });
}