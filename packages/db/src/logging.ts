import { createWriteStream, mkdirSync, readdirSync, unlinkSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

/**
 * Structured logs (RNF-18): one JSON object per line, with who and where (organization,
 * location, terminal, user, request id), to stdout and, with `LOG_DIR`, to one file per service
 * and day kept 90 days (`LOG_RETENTION_DAYS`). Secrets never reach a log: keys that look like a
 * PIN, password, token, secret, hash, cookie or authorization are replaced (revDSG, RNF-10).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  requestId?: string | null;
  organizationId?: string | null;
  locationId?: string | null;
  terminalId?: string | null;
  userId?: string | null;
  supportStaffId?: string | null;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** The same logger with more context on every line. */
  child(context: LogContext & Record<string, unknown>): Logger;
}

const SECRET_KEY = /pin|passw|token|secret|hash|cookie|authorization|apikey|api_key|otp|totp/i;
const MAX_STRING = 2_000;

/** A copy of `value` without secrets and with long strings cut, safe to log. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (depth > 6) return '[deep]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: redact(value.stack) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return result;
}

/**
 * A failed Drizzle query carries its bound parameters (PIN lookups, hashes, personal data): only
 * the SQL text and the driver's error code are kept.
 */
export function loggableError(error: unknown): unknown {
  if (error && typeof error === 'object' && 'query' in error && 'params' in error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return { query: (error as { query: string }).query, code: cause?.code, cause: cause?.message };
  }
  return redact(error);
}

/** Daily log files older than `days` (names `<service>-YYYY-MM-DD.jsonl`), to delete. */
export function expiredLogFiles(names: readonly string[], today: string, days: number): string[] {
  const limit = Date.parse(`${today}T00:00:00Z`) - days * 86_400_000;
  return names.filter((name) => {
    const day = /-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name)?.[1];
    return day !== undefined && Date.parse(`${day}T00:00:00Z`) < limit;
  });
}

/** One open file per day; the old ones are pruned when the day changes. */
class DailyFile {
  private day = '';
  private stream: WriteStream | null = null;

  constructor(
    private readonly dir: string,
    private readonly service: string,
    private readonly retentionDays: number,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  write(line: string, now: Date) {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.stream?.end();
      this.day = day;
      this.stream = createWriteStream(join(this.dir, `${this.service}-${day}.jsonl`), {
        flags: 'a',
      });
      this.prune(day);
    }
    this.stream!.write(`${line}\n`);
  }

  private prune(today: string) {
    try {
      for (const name of expiredLogFiles(readdirSync(this.dir), today, this.retentionDays)) {
        unlinkSync(join(this.dir, name));
      }
    } catch {
      // Pruning never stops the service; the next day tries again.
    }
  }
}

const files = new Map<string, DailyFile>();

function levelFromEnv(): LogLevel {
  const level = process.env.LOG_LEVEL as LogLevel | undefined;
  if (level && level in LEVELS) return level;
  // Tests run thousands of requests: only warnings and errors.
  return process.env.VITEST || process.env.NODE_ENV === 'test' ? 'warn' : 'info';
}

/** A logger for one service (`api`, `hub`, `worker`, `monitor`, `web`). */
export function createLogger(
  service: string,
  context: Record<string, unknown> = {},
  options: { level?: LogLevel; dir?: string | null; write?: (line: string) => void } = {},
): Logger {
  const minimum = LEVELS[options.level ?? levelFromEnv()];
  const dir = options.dir === undefined ? process.env.LOG_DIR : options.dir;
  let file: DailyFile | null = null;
  if (dir) {
    const key = `${dir}|${service}`;
    file =
      files.get(key) ?? new DailyFile(dir, service, Number(process.env.LOG_RETENTION_DAYS ?? 90));
    files.set(key, file);
  }
  const output = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));

  const log = (level: LogLevel, msg: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[level] < minimum) return;
    const now = new Date();
    const entry = redact({ time: now.toISOString(), level, service, msg, ...context, ...fields });
    const line = JSON.stringify(entry);
    output(line);
    file?.write(line, now);
  };
  return {
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: (more) =>
      createLogger(service, { ...context, ...withoutEmpty(more) }, { ...options, dir }),
  };
}

const withoutEmpty = (record: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => value !== null && value !== undefined && value !== '',
    ),
  );
