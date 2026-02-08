import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const feedbackSchema = z.object({
  type: z.enum(['bug', 'feature', 'general']),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  email: z.string().email().optional().or(z.literal('')),
});

// Simple in-memory rate limiter (per-worker, resets on restart)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count++;
  return false;
}

export async function feedbackRoute(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/feedback
   * Sends user feedback as a formatted email
   */
  app.post('/api/feedback', async (request, reply) => {
    const ip = request.ip;

    if (isRateLimited(ip)) {
      return reply.status(429).send({
        error: 'Too many feedback submissions. Please try again later.',
        statusCode: 429,
      });
    }

    let body: any;
    try {
      body = feedbackSchema.parse(request.body);
    } catch (err: any) {
      return reply.status(400).send({
        error: err.errors?.[0]?.message || 'Invalid input',
        statusCode: 400,
      });
    }

    const { type, subject, message, email } = body;

    try {
      // Dynamic import to avoid loading nodemailer at startup if not needed
      const nodemailer = await import('nodemailer');

      const transporter = nodemailer.createTransport({
        direct: true,
        name: 'artorizer.com',
      } as any);

      const typeLabel = type === 'bug' ? 'Bug Report' : type === 'feature' ? 'Feature Request' : 'General Feedback';

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #18181b; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">Artorize Feedback: ${typeLabel}</h2>
          </div>
          <div style="border: 1px solid #e4e4e7; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
              <tr>
                <td style="padding: 8px 0; color: #71717a; font-size: 14px; width: 80px; vertical-align: top;">Type</td>
                <td style="padding: 8px 0; font-size: 14px; font-weight: 500;">${typeLabel}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #71717a; font-size: 14px; vertical-align: top;">Subject</td>
                <td style="padding: 8px 0; font-size: 14px; font-weight: 500;">${escapeHtml(subject)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #71717a; font-size: 14px; vertical-align: top;">From</td>
                <td style="padding: 8px 0; font-size: 14px;">${email ? escapeHtml(email) : '<em style="color:#a1a1aa;">Not provided</em>'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #71717a; font-size: 14px; vertical-align: top;">IP</td>
                <td style="padding: 8px 0; font-size: 14px; color: #a1a1aa;">${ip}</td>
              </tr>
            </table>
            <div style="border-top: 1px solid #e4e4e7; padding-top: 16px;">
              <p style="color: #71717a; font-size: 13px; margin: 0 0 8px 0;">Message</p>
              <div style="background: #fafafa; padding: 16px; border-radius: 6px; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</div>
            </div>
          </div>
        </div>
      `;

      await transporter.sendMail({
        from: `"Artorize Feedback" <feedback@artorizer.com>`,
        to: 'neilhuang007@gmail.com',
        subject: `[${typeLabel}] ${subject}`,
        html: htmlBody,
        replyTo: email || undefined,
      });

      request.log.info({ type, subject, email: email || 'none', ip }, 'Feedback sent successfully');

      return reply.send({ success: true });
    } catch (err: any) {
      request.log.error({ err, type, subject }, 'Failed to send feedback email');
      return reply.status(500).send({
        error: 'Failed to send feedback. Please try again later.',
        statusCode: 500,
      });
    }
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
