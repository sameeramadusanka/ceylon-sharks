type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  matchId?: string;
  actionId?: string;
  actionType?: string;
  /** Email or other identifier — automatically masked before logging. */
  recipient?: string;
  result?: string;
  sesMessageId?: string;
  errorCategory?: string;
  route?: string;
  requestId?: string;
  [key: string]: unknown;
}

const FORBIDDEN_KEY_FRAGMENTS = ['token', 'password', 'secret', 'credential'];

function assertNoForbiddenFields(context: LogContext): void {
  for (const key of Object.keys(context)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lowerKey.includes(fragment))) {
      throw new Error(`Refusing to log field that may contain sensitive data: ${key}`);
    }
  }
}

export function maskRecipient(identifier: string): string {
  const [user, domain] = identifier.split('@');
  if (!domain) return '***';
  const maskedUser = user.length <= 2 ? '*'.repeat(user.length) : `${user[0]}***${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
}

function write(level: LogLevel, message: string, context: LogContext): void {
  assertNoForbiddenFields(context);
  const safeContext: LogContext = { ...context };
  if (typeof safeContext.recipient === 'string') {
    safeContext.recipient = maskRecipient(safeContext.recipient);
  }
  const entry = { level, message, timestamp: new Date().toISOString(), ...safeContext };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context: LogContext = {}) => write('info', message, context),
  warn: (message: string, context: LogContext = {}) => write('warn', message, context),
  error: (message: string, context: LogContext = {}) => write('error', message, context),
};
