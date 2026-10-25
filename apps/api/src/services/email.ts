import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { getDb } from '../db/client.js';
import { emailOutbox } from '../db/schema.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;

export function emailConfigured(): boolean {
  const e = env();
  return e.EMAIL_TRANSPORT !== 'smtp' || Boolean(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS);
}

export function emailTransportName(): string {
  return env().EMAIL_TRANSPORT;
}

function smtp(): Transporter {
  if (!transporter) {
    const e = env();
    transporter = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/**
 * Deliver a mail through the configured transport. Every send is also recorded in `email_outbox`
 * for traceability; in `outbox` mode that record is the delivery (useful in development and demos).
 */
export async function deliverMail(mail: Mail): Promise<void> {
  const e = env();
  const db = getDb();
  const [row] = await db
    .insert(emailOutbox)
    .values({ to: mail.to, subject: mail.subject, text: mail.text, html: mail.html ?? null, status: 'queued' })
    .returning({ id: emailOutbox.id });
  const id = row!.id;
  try {
    if (e.EMAIL_TRANSPORT === 'smtp') {
      await smtp().sendMail({ from: e.EMAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    } else if (e.EMAIL_TRANSPORT === 'console') {
      console.log(`\n--- email to ${mail.to}: ${mail.subject}\n${mail.text}\n---\n`);
    }
    await db.update(emailOutbox).set({ status: 'sent', sentAt: new Date() }).where(eqId(id));
  } catch (err) {
    await db.update(emailOutbox).set({ status: 'failed', error: (err as Error).message }).where(eqId(id));
    throw err;
  }
}

import { eq } from 'drizzle-orm';
const eqId = (id: string) => eq(emailOutbox.id, id);

/* -------------------------------- templates ------------------------------- */

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
<div style="font-weight:700;font-size:18px;color:#0f766e;margin-bottom:16px">HireWithSense</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
${cta ? `<p style="margin:24px 0"><a href="${esc(cta.url)}" style="background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p><p style="font-size:12px;color:#64748b">Or paste this link in your browser:<br>${esc(cta.url)}</p>` : ''}
<p style="font-size:12px;color:#94a3b8;margin-top:32px">You received this email because an account or invitation was created with this address on HireWithSense.</p>
</div></body></html>`;
}

export function passwordResetMail(to: string, name: string, token: string): Mail {
  const url = `${env().PUBLIC_WEB_URL}/reset-password?token=${token}`;
  return {
    to,
    subject: 'Reset your HireWithSense password',
    text: `Hi ${name},\n\nUse this link to reset your password. It expires in 30 minutes and can be used once:\n${url}\n\nIf you did not request this, ignore this email.`,
    html: layout('Reset your password', `<p>Hi ${esc(name)},</p><p>Use the button below to choose a new password. The link expires in 30 minutes and can be used once.</p><p>If you did not request this, you can ignore this email.</p>`, { label: 'Reset password', url }),
  };
}

export function verifyEmailMail(to: string, name: string, token: string): Mail {
  const url = `${env().PUBLIC_WEB_URL}/verify-email?token=${token}`;
  return {
    to,
    subject: 'Verify your email address',
    text: `Hi ${name},\n\nConfirm your email address:\n${url}`,
    html: layout('Verify your email', `<p>Hi ${esc(name)},</p><p>Please confirm your email address to finish setting up your account.</p>`, { label: 'Verify email', url }),
  };
}

export function interviewInviteMail(opts: { to: string; candidateName: string | null; jobTitle: string; orgName: string; message: string | null; token: string; expiresAt: Date; totalMinutes: number }): Mail {
  const url = `${env().PUBLIC_WEB_URL}/invite/${opts.token}`;
  const greeting = opts.candidateName ? `Hi ${opts.candidateName},` : 'Hello,';
  const when = opts.expiresAt.toUTCString();
  return {
    to: opts.to,
    subject: `${opts.orgName} invites you to interview for ${opts.jobTitle}`,
    text: `${greeting}\n\n${opts.orgName} has invited you to an AI-assisted interview for the ${opts.jobTitle} role. It takes about ${opts.totalMinutes} minutes and can be completed from your browser.\n\n${opts.message ? opts.message + '\n\n' : ''}Accept the invitation: ${url}\n\nThe invitation expires on ${when}.`,
    html: layout(`Interview invitation: ${opts.jobTitle}`, `<p>${esc(greeting)}</p><p><strong>${esc(opts.orgName)}</strong> has invited you to an AI-assisted interview for the <strong>${esc(opts.jobTitle)}</strong> role. It takes about ${opts.totalMinutes} minutes and can be completed from your browser at a time that suits you.</p>${opts.message ? `<blockquote style="border-left:3px solid #e2e8f0;margin:16px 0;padding:4px 12px;color:#334155">${esc(opts.message)}</blockquote>` : ''}<p>The invitation expires on ${esc(when)}.</p>`, { label: 'Accept invitation', url }),
  };
}

export function orgInviteMail(opts: { to: string; orgName: string; inviterName: string; token: string }): Mail {
  const url = `${env().PUBLIC_WEB_URL}/join/${opts.token}`;
  return {
    to: opts.to,
    subject: `${opts.inviterName} invited you to ${opts.orgName} on HireWithSense`,
    text: `${opts.inviterName} invited you to join ${opts.orgName} on HireWithSense as a recruiter.\n\nJoin: ${url}`,
    html: layout(`Join ${opts.orgName}`, `<p><strong>${esc(opts.inviterName)}</strong> invited you to join <strong>${esc(opts.orgName)}</strong> on HireWithSense as a recruiter.</p>`, { label: 'Join organization', url }),
  };
}

export function interviewCompletedMail(opts: { to: string; recruiterName: string; candidateName: string; jobTitle: string; interviewId: string }): Mail {
  const url = `${env().PUBLIC_WEB_URL}/recruiter/interviews/${opts.interviewId}`;
  return {
    to: opts.to,
    subject: `${opts.candidateName} completed the ${opts.jobTitle} interview`,
    text: `Hi ${opts.recruiterName},\n\n${opts.candidateName} has completed the interview for ${opts.jobTitle}. The report is ready for your review:\n${url}`,
    html: layout('Interview completed', `<p>Hi ${esc(opts.recruiterName)},</p><p><strong>${esc(opts.candidateName)}</strong> has completed the interview for <strong>${esc(opts.jobTitle)}</strong>. The report is ready for your review.</p>`, { label: 'Review report', url }),
  };
}
