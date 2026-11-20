// Brand palette matches src/styles/global.css's :root variables on the main site.
// Email HTML can't rely on CSS custom properties (Outlook etc. don't support var()),
// so the literal hex values are duplicated here intentionally.
const COLOR_INK = '#111b4f';
const COLOR_PAPER = '#f8f9f7';
const COLOR_AMBER = '#ff5310';
const COLOR_MUTED = '#657080';
const COLOR_LINE = '#e3e5ea';
const FONT_STACK = "Arial, Helvetica, 'Segoe UI', sans-serif";

/** The logo must be an absolute, publicly reachable URL - email clients can't load relative paths. */
export function logoUrlFor(frontendUrl: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/brand/ceylon-sharks-logo.png`;
}

export interface InvitationEmailParams {
  playerName: string;
  opponent: string;
  matchDate: string;
  competition: string;
  deadline: string;
  magicLink: string;
  logoUrl: string;
}

export interface FinalSummaryParams {
  opponent: string;
  matchDate: string;
  totalInvited: number;
  available: string[];
  unavailable: string[];
  maybe: string[];
  noResponse: string[];
  logoUrl: string;
}

export interface CaptainNotificationParams {
  playerName: string;
  opponent: string;
  matchDate: string;
  newAvailability: string;
  previousAvailability?: string;
  comments?: string;
  submittedAt: string;
  logoUrl: string;
}

export interface TeamSelectionParams {
  playerName: string;
  opponent: string;
  matchDate: string;
  time?: string;
  ground?: string;
  logoUrl: string;
}

export interface AdminLoginCodeParams {
  code: string;
  logoUrl: string;
}

export interface EmailBody {
  subject: string;
  text: string;
  html: string;
}

/** Player-supplied free text (name, comments) is rendered here - always escape before interpolating into HTML. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Table-based layout with inline styles throughout - email clients (especially
 * Outlook desktop) don't reliably support flexbox/grid/CSS custom properties/
 * <style> blocks, so this intentionally avoids all of them.
 */
function emailShell(logoUrl: string, bodyHtml: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR_PAPER};padding:32px 16px;font-family:${FONT_STACK};">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid ${COLOR_LINE};border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background:${COLOR_INK};padding:18px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:10px;">
                  <img src="${logoUrl}" width="32" height="32" alt="" style="display:block;border:0;border-radius:50%;">
                </td>
                <td style="color:#ffffff;font-size:15px;font-weight:bold;letter-spacing:.04em;font-family:${FONT_STACK};">
                  Ceylon Sharks
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;color:${COLOR_INK};font-size:15px;line-height:1.6;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:14px 28px;background:${COLOR_PAPER};border-top:1px solid ${COLOR_LINE};color:${COLOR_MUTED};font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-family:${FONT_STACK};">
            &copy; ${new Date().getFullYear()} Ceylon Sharks
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

function ctaButton(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr>
        <td style="background:${COLOR_AMBER};border-radius:6px;">
          <a href="${href}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-weight:bold;font-size:14px;text-decoration:none;font-family:${FONT_STACK};">${label}</a>
        </td>
      </tr>
    </table>`;
}

export function invitationEmail(params: InvitationEmailParams): EmailBody {
  const subject = 'Ceylon Sharks – Please confirm your availability';

  const text = [
    `Hi ${params.playerName},`,
    '',
    `Please confirm your availability for the upcoming match against ${params.opponent} (${params.competition}) on ${params.matchDate}.`,
    '',
    `Respond here: ${params.magicLink}`,
    '',
    `Please respond by ${params.deadline}. You can revisit this link anytime before the deadline to update your response.`,
    '',
    '- Ceylon Sharks',
  ].join('\n');

  const body = `
    <p style="margin:0 0 16px;">Hi <strong>${escapeHtml(params.playerName)}</strong>,</p>
    <p style="margin:0 0 16px;">Please confirm your availability for the upcoming match against <strong>${escapeHtml(params.opponent)}</strong> (${escapeHtml(params.competition)}) on ${escapeHtml(params.matchDate)}.</p>
    ${ctaButton(params.magicLink, 'Respond to this invitation')}
    <p style="margin:16px 0 0;color:${COLOR_MUTED};font-size:13px;">Please respond by <strong>${escapeHtml(params.deadline)}</strong>. You can revisit this link anytime before the deadline to update your response.</p>
  `;

  return { subject, text, html: emailShell(params.logoUrl, body) };
}

export function reminderEmail(params: InvitationEmailParams): EmailBody {
  const subject = 'Reminder: Ceylon Sharks match availability';

  const text = [
    `Hi ${params.playerName},`,
    '',
    `This is a reminder to confirm your availability for the upcoming match against ${params.opponent} (${params.competition}) on ${params.matchDate}. We haven't heard from you yet.`,
    '',
    `Respond here: ${params.magicLink}`,
    '',
    `Please respond by ${params.deadline}. You can revisit this link anytime before the deadline to update your response.`,
    '',
    '- Ceylon Sharks',
  ].join('\n');

  const body = `
    <p style="margin:0 0 16px;">Hi <strong>${escapeHtml(params.playerName)}</strong>,</p>
    <p style="margin:0 0 16px;">This is a reminder to confirm your availability for the upcoming match against <strong>${escapeHtml(params.opponent)}</strong> (${escapeHtml(params.competition)}) on ${escapeHtml(params.matchDate)}. We haven't heard from you yet.</p>
    ${ctaButton(params.magicLink, 'Respond to this invitation')}
    <p style="margin:16px 0 0;color:${COLOR_MUTED};font-size:13px;">Please respond by <strong>${escapeHtml(params.deadline)}</strong>. You can revisit this link anytime before the deadline to update your response.</p>
  `;

  return { subject, text, html: emailShell(params.logoUrl, body) };
}

export function finalSummaryEmail(params: FinalSummaryParams): EmailBody {
  const subject = `Ceylon Sharks availability summary – vs ${params.opponent} (${params.matchDate})`;

  const textSection = (label: string, names: string[]) => `${label} (${names.length}): ${names.length ? names.join(', ') : 'none'}`;
  const htmlSection = (label: string, names: string[]) => `
    <tr>
      <td style="padding:10px 0;border-top:1px solid ${COLOR_LINE};">
        <span style="display:inline-block;min-width:110px;color:${COLOR_INK};font-weight:bold;">${label} (${names.length})</span>
        <span style="color:${COLOR_MUTED};">${names.length ? names.map(escapeHtml).join(', ') : 'none'}</span>
      </td>
    </tr>`;

  const text = [
    `Availability summary for the match vs ${params.opponent} on ${params.matchDate}.`,
    `Total invited: ${params.totalInvited}`,
    '',
    textSection('Available', params.available),
    textSection('Unavailable', params.unavailable),
    textSection('Maybe', params.maybe),
    textSection('No response', params.noResponse),
  ].join('\n');

  const body = `
    <p style="margin:0 0 4px;">Availability summary for the match vs <strong>${escapeHtml(params.opponent)}</strong> on ${escapeHtml(params.matchDate)}.</p>
    <p style="margin:0 0 16px;color:${COLOR_MUTED};font-size:13px;">Total invited: ${params.totalInvited}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
      ${htmlSection('Available', params.available)}
      ${htmlSection('Unavailable', params.unavailable)}
      ${htmlSection('Maybe', params.maybe)}
      ${htmlSection('No response', params.noResponse)}
    </table>
  `;

  return { subject, text, html: emailShell(params.logoUrl, body) };
}

export function adminLoginCodeEmail(params: AdminLoginCodeParams): EmailBody {
  const subject = 'Ceylon Sharks admin panel – your sign-in code';

  const text = [
    `Your sign-in code is: ${params.code}`,
    '',
    'This code expires in 10 minutes and can only be used once.',
    '',
    "If you didn't request this, you can ignore this email.",
  ].join('\n');

  const body = `
    <p style="margin:0 0 16px;">Your sign-in code is:</p>
    <p style="margin:0 0 16px;font-size:28px;font-weight:bold;letter-spacing:.08em;color:${COLOR_INK};">${escapeHtml(params.code)}</p>
    <p style="margin:0;color:${COLOR_MUTED};font-size:13px;">This code expires in 10 minutes and can only be used once. If you didn't request this, you can ignore this email.</p>
  `;

  return { subject, text, html: emailShell(params.logoUrl, body) };
}

export function teamSelectionEmail(params: TeamSelectionParams): EmailBody {
  const subject = `You're selected! Ceylon Sharks vs ${params.opponent}`;

  const details = [params.matchDate, params.time, params.ground].filter((part): part is string => Boolean(part)).join(' · ');

  const text = [
    `Hi ${params.playerName},`,
    '',
    `Congratulations - you've been selected for the match against ${params.opponent}.`,
    '',
    details,
    '',
    '- Ceylon Sharks',
  ].join('\n');

  const body = `
    <p style="margin:0 0 16px;">Hi <strong>${escapeHtml(params.playerName)}</strong>,</p>
    <p style="margin:0 0 16px;">Congratulations – you've been selected for the match against <strong>${escapeHtml(params.opponent)}</strong>.</p>
    <p style="margin:0;background:${COLOR_PAPER};border-radius:6px;padding:12px 14px;font-weight:bold;">${escapeHtml(details)}</p>
  `;

  return { subject, text, html: emailShell(params.logoUrl, body) };
}

export function captainNotificationEmail(params: CaptainNotificationParams): EmailBody {
  const subject = `Ceylon Sharks availability update: ${params.playerName}`;
  const changeSuffix = params.previousAvailability && params.previousAvailability !== 'NOT_SUBMITTED' ? ` (changed from ${params.previousAvailability})` : '';

  const text = [
    `${params.playerName} responded ${params.newAvailability}${changeSuffix} for the match vs ${params.opponent} on ${params.matchDate}.`,
    params.comments ? `Comments: ${params.comments}` : null,
    `Submitted at: ${params.submittedAt}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const body = `
    <p style="margin:0 0 16px;"><strong>${escapeHtml(params.playerName)}</strong> responded <strong style="color:${COLOR_AMBER};">${escapeHtml(params.newAvailability)}</strong>${escapeHtml(changeSuffix)} for the match vs <strong>${escapeHtml(params.opponent)}</strong> on ${escapeHtml(params.matchDate)}.</p>
    ${params.comments ? `<p style="margin:0 0 16px;background:${COLOR_PAPER};border-radius:6px;padding:12px 14px;">${escapeHtml(params.comments)}</p>` : ''}
    <p style="margin:0;color:${COLOR_MUTED};font-size:13px;">Submitted at: ${escapeHtml(params.submittedAt)}</p>
  `;

  return { subject, text, html: emailShell(params.logoUrl, body) };
}
