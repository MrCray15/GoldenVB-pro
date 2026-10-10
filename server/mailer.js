// Golden VB — email sender via Gmail SMTP
import nodemailer from "nodemailer";

const { EMAIL_USER, EMAIL_APP_PASSWORD, EMAIL_FROM_NAME } = process.env;

if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
  console.warn("[mailer] EMAIL_USER or EMAIL_APP_PASSWORD missing — OTP emails will fail.");
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
});

async function sendMail({ to, subject, html, text }) {
  if (!to || !subject) throw new Error("sendMail: 'to' and 'subject' are required");
  return transporter.sendMail({
    from: `"${EMAIL_FROM_NAME || "Golden Villa"}" <${EMAIL_USER}>`,
    to, subject,
    text: text || "",
    html: html || "",
  });
}

async function sendOtpEmail(to, otp, { name, purpose } = {}) {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const purposeLine =
    purpose === "reset"
      ? "You requested to reset your password."
      : "Someone just tried to log in to your Golden Villa staff account.";

  const subject = "Your Golden Villa verification code";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #E8C466, #C79A2E); border-radius: 16px 16px 0 0; padding: 24px; text-align: center; color: white;">
        <h1 style="margin: 0; font-size: 22px;">Golden Villa Resort</h1>
        <p style="margin: 6px 0 0; font-size: 12px; letter-spacing: 2px; opacity: .9;">PRIVATE RESORT · MALOLOS</p>
      </div>
      <div style="background: #FFFDF8; border: 1px solid #eadfc9; border-top: none; border-radius: 0 0 16px 16px; padding: 28px;">
        <p style="font-size: 15px; color: #1F1A12;">${greeting}</p>
        <p style="font-size: 14px; color: #5c4a2a;">${purposeLine}</p>
        <p style="font-size: 13px; color: #7A6A52; margin-top: 20px;">Your one-time code is:</p>
        <div style="background: #F5E7BE; border-radius: 12px; padding: 20px; text-align: center; margin: 12px 0 20px;">
          <p style="font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #6E4F0F; margin: 0;">${otp}</p>
        </div>
        <p style="font-size: 12px; color: #7A6A52;">This code expires in <b>5 minutes</b>. If you didn't request it, ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eadfc9; margin: 22px 0;" />
        <p style="font-size: 11px; color: #a8a29e; text-align: center;">Golden Villa Private Resort · Malolos, Bulacan</p>
      </div>
    </div>`;

  const text = `${greeting}\n\n${purposeLine}\n\nYour one-time code is: ${otp}\n\nExpires in 5 minutes.`;

  return sendMail({ to, subject, html, text });
}

export { sendMail, sendOtpEmail };