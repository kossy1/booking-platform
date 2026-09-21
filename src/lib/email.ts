// src/lib/email.ts
import { config } from '../config.js';

export type EmailTemplate =
  | 'business_approved'
  | 'business_suspended'
  | 'business_closed'
  | 'welcome'
  | 'booking_confirmed'
  | 'booking_cancelled';

interface TemplateData {
  recipientName: string;
  [key: string]: unknown;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = {
  name: 'BookEasy',
  primary: '#667eea',
  url: 'http://localhost:3001',
};

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;font-size:28px;">✂️</div>
      <div style="font-weight:800;font-size:18px;color:#111827;">${BRAND.name}</div>
    </div>
    <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      ${body}
    </div>
    <div style="text-align:center;margin-top:24px;color:#6b7280;font-size:12px;">
      © ${new Date().getFullYear()} ${BRAND.name} · <a href="${BRAND.url}" style="color:${BRAND.primary};">Visit site</a>
    </div>
  </div>
</body></html>`;
}

function button(href: string, text: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND.primary};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin-top:16px;">${text}</a>`;
}

export function renderEmail(template: EmailTemplate, data: TemplateData): RenderedEmail {
  const name = data.recipientName || 'there';

  switch (template) {
    case 'business_approved': {
      const bizName = String(data.businessName ?? 'your business');
      const subject = `🎉 ${bizName} is now live on BookEasy`;
      const html = layout(subject, `
        <h1 style="font-size:22px;margin:0 0 16px;">Your business is live!</h1>
        <p>Hi ${name},</p>
        <p>Great news — <strong>${bizName}</strong> has been approved and is now visible to customers on BookEasy.</p>
        <p>You can start accepting bookings immediately. Make sure your services and availability are set up so customers can book.</p>
        ${button(`${BRAND.url}/dashboard.html`, 'Go to dashboard')}
        <p style="margin-top:24px;color:#6b7280;font-size:13px;">— The ${BRAND.name} team</p>
      `);
      const text = `Hi ${name},\n\n${bizName} is now live on ${BRAND.name}.\n\nGo to your dashboard: ${BRAND.url}/dashboard.html`;
      return { subject, html, text };
    }

    case 'business_suspended': {
      const bizName = String(data.businessName ?? 'your business');
      const reason = data.reason ? `\n\nReason: ${data.reason}` : '';
      const subject = `⚠️ ${bizName} has been suspended`;
      const html = layout(subject, `
        <h1 style="font-size:22px;margin:0 0 16px;">Your business is suspended</h1>
        <p>Hi ${name},</p>
        <p>Your business <strong>${bizName}</strong> has been temporarily suspended from BookEasy.</p>
        ${reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
        <p>If you believe this is a mistake, please reply to this email.</p>
        ${button(`mailto:support@bookeasy.demo`, 'Contact support')}
      `);
      const text = `Hi ${name},\n\n${bizName} has been suspended.${reason}\n\nContact support if you have questions.`;
      return { subject, html, text };
    }

    case 'business_closed': {
      const bizName = String(data.businessName ?? 'your business');
      const subject = `${bizName} has been closed`;
      const html = layout(subject, `
        <h1 style="font-size:22px;margin:0 0 16px;">Business closed</h1>
        <p>Hi ${name},</p>
        <p>Your business <strong>${bizName}</strong> has been marked as closed on BookEasy.</p>
        <p>If you'd like to reopen it, you can do so from your dashboard.</p>
        ${button(`${BRAND.url}/dashboard.html`, 'Open dashboard')}
      `);
      const text = `Hi ${name},\n\n${bizName} has been closed on ${BRAND.name}.`;
      return { subject, html, text };
    }

    case 'welcome': {
      const subject = `Welcome to ${BRAND.name}!`;
      const html = layout(subject, `
        <h1 style="font-size:22px;margin:0 0 16px;">Welcome aboard 👋</h1>
        <p>Hi ${name},</p>
        <p>Thanks for joining ${BRAND.name}. You can now browse and book appointments instantly.</p>
        ${button(`${BRAND.url}/browse.html`, 'Start browsing')}
      `);
      const text = `Hi ${name}, welcome to ${BRAND.name}! Browse businesses: ${BRAND.url}/browse.html`;
      return { subject, html, text };
    }

    case 'booking_confirmed': {
      const subject = `Your booking is confirmed`;
      const html = layout(subject, `
        <h1 style="font-size:22px;margin:0 0 16px;">Booking confirmed ✅</h1>
        <p>Hi ${name},</p>
        <p>Your booking with <strong>${data.businessName}</strong> is confirmed for <strong>${data.when}</strong>.</p>
        ${button(`${BRAND.url}/my-bookings.html`, 'View booking')}
      `);
      const text = `Hi ${name}, your booking with ${data.businessName} is confirmed for ${data.when}.`;
      return { subject, html, text };
    }

    case 'booking_cancelled': {
      const subject = `Your booking was cancelled`;
      const html = layout(subject, `
        <h1 style="font-size:22px;margin:0 0 16px;">Booking cancelled</h1>
        <p>Hi ${name},</p>
        <p>Your booking with <strong>${data.businessName}</strong> on <strong>${data.when}</strong> has been cancelled.</p>
        <p>You can rebook anytime.</p>
        ${button(`${BRAND.url}/browse.html`, 'Find a new time')}
      `);
      const text = `Hi ${name}, your booking with ${data.businessName} was cancelled.`;
      return { subject, html, text };
    }

    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}

// ─── Actual sending ─────────────────────────────────
// Dev: log to console. Prod: swap for SendGrid/Postmark/Resend.

export async function sendEmail(to: string, template: EmailTemplate, data: TemplateData) {
  const { subject, html, text } = renderEmail(template, data);

  if (config.NODE_ENV === 'development') {
    console.log('\n════════ EMAIL ════════');
    console.log('To:     ', to);
    console.log('Subject:', subject);
    console.log('Text:   ', text);
    console.log('════════════════════════\n');
    return;
  }

  // Production — plug in your provider
  // Example with Resend:
  //   const resend = new Resend(config.RESEND_API_KEY);
  //   await resend.emails.send({ from: 'BookEasy <hello@bookeasy.demo>', to, subject, html, text });

  throw new Error('No email provider configured for production');
}