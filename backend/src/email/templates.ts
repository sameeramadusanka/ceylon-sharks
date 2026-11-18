export interface InvitationEmailParams {
  playerName: string;
  opponent: string;
  matchDate: string;
  competition: string;
  deadline: string;
  magicLink: string;
}

export interface CaptainNotificationParams {
  playerName: string;
  opponent: string;
  matchDate: string;
  newAvailability: string;
  previousAvailability?: string;
  comments?: string;
  submittedAt: string;
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

  const html = `
    <p>Hi ${escapeHtml(params.playerName)},</p>
    <p>Please confirm your availability for the upcoming match against <strong>${escapeHtml(params.opponent)}</strong> (${escapeHtml(params.competition)}) on ${escapeHtml(params.matchDate)}.</p>
    <p><a href="${params.magicLink}">Respond to this invitation</a></p>
    <p>Please respond by ${escapeHtml(params.deadline)}. You can revisit this link anytime before the deadline to update your response.</p>
    <p>- Ceylon Sharks</p>
  `.trim();

  return { subject, text, html };
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

  const html = `
    <p><strong>${escapeHtml(params.playerName)}</strong> responded <strong>${escapeHtml(params.newAvailability)}</strong>${escapeHtml(changeSuffix)} for the match vs ${escapeHtml(params.opponent)} on ${escapeHtml(params.matchDate)}.</p>
    ${params.comments ? `<p>Comments: ${escapeHtml(params.comments)}</p>` : ''}
    <p>Submitted at: ${escapeHtml(params.submittedAt)}</p>
  `.trim();

  return { subject, text, html };
}
