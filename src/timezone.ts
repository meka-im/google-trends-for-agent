import { GTrendsError } from './core.js';

/** Default display time zone for charts when neither an option nor GTFA_TZ is set. */
export const DEFAULT_TIME_ZONE = 'UTC';

/** Validate an IANA time zone with Intl.DateTimeFormat and return it trimmed. */
export function validateTimeZone(timeZone: string): string {
  const value = typeof timeZone === 'string' ? timeZone.trim() : '';
  if (!value) throw new GTrendsError('INVALID_INPUT', 'timeZone must be a valid IANA time zone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch {
    throw new GTrendsError('INVALID_INPUT', `invalid IANA time zone: ${value.slice(0, 100)}`);
  }
  return value;
}

/** Resolve the chart time zone: explicit option > GTFA_TZ > UTC. */
export function resolveTimeZone(timeZone?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (timeZone !== undefined) return validateTimeZone(timeZone);
  const fromEnv = env.GTFA_TZ?.trim();
  return fromEnv ? validateTimeZone(fromEnv) : DEFAULT_TIME_ZONE;
}
