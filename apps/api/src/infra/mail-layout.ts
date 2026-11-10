import { env } from '../config/env.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Minimal branded email layout (Charter Mission palette: green #046D35, red #ED0918, orange #FF8A00).
 * Returns text and HTML bodies. Paragraphs are plain strings; one optional button.
 */
export function renderEmail(opts: {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer?: string;
}) {
  const text = [
    opts.heading,
    '',
    ...opts.paragraphs.flatMap((p) => [p, '']),
    ...(opts.button ? [`${opts.button.label}: ${opts.button.url}`, ''] : []),
    opts.footer ?? 'Charter Mission — where Africa and its diaspora build together.',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F8F9FC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1A202C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px">
<tr><td style="padding:24px 32px;border-bottom:1px solid #E2E8F0"><img src="${esc(webUrl("/brand/charter-mission-mark.png"))}" width="32" height="32" alt="" style="display:inline-block;vertical-align:middle;border:0;border-radius:8px;margin-right:10px"><span style="font-size:18px;font-weight:700;color:#046D35;vertical-align:middle">Charter</span> <span style="font-size:18px;font-weight:700;color:#ED0918;vertical-align:middle">Mission</span></td></tr>
<tr><td style="padding:32px">
<h1 style="font-size:22px;line-height:30px;margin:0 0 16px">${esc(opts.heading)}</h1>
${opts.paragraphs.map((p) => `<p style="font-size:15px;line-height:22px;margin:0 0 16px;color:#475569">${esc(p)}</p>`).join('')}
${opts.button ? `<p style="margin:24px 0"><a href="${esc(opts.button.url)}" style="display:inline-block;background:#046D35;color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(opts.button.label)}</a></p><p style="font-size:12px;color:#718096;word-break:break-all">${esc(opts.button.url)}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #E2E8F0;font-size:12px;color:#718096">${esc(opts.footer ?? 'Charter Mission — where Africa and its diaspora build together.')}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export const webUrl = (path: string) => `${env().WEB_URL.replace(/\/$/, '')}${path}`;
export const adminUrl = (path: string) => `${env().ADMIN_URL.replace(/\/$/, '')}${path}`;
