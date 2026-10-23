import nodemailer from "nodemailer";

export function isEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS &&
    process.env.SMTP_FROM && process.env.PASSWORD_RESET_URL
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

export async function sendPasswordResetEmail({ email, name, token }) {
  const resetUrl = new URL(process.env.PASSWORD_RESET_URL);
  resetUrl.searchParams.set("token", token);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Reset your HireWithSenseAI password",
    text: `Hi ${name},\n\nUse this link to reset your password. It expires in 30 minutes and can only be used once:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Use the link below to reset your HireWithSenseAI password. It expires in 30 minutes and can only be used once.</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`
  });
}
