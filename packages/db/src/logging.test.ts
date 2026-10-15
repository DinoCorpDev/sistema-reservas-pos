import { describe, expect, it } from 'vitest';
import { createLogger, expiredLogFiles, loggableError, redact } from './logging';

describe('structured logs (RNF-18)', () => {
  it('one JSON line with the service, the context and the fields', () => {
    const lines: string[] = [];
    const logger = createLogger(
      'api',
      {},
      { level: 'info', dir: null, write: (l) => lines.push(l) },
    ).child({ requestId: 'r-1', organizationId: 'org-1', locationId: null, userId: 'u-1' });
    logger.info('request', { route: '/sync/push', status: 200, durationMs: 12 });
    logger.debug('not written below the level');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'info',
      service: 'api',
      msg: 'request',
      requestId: 'r-1',
      organizationId: 'org-1',
      userId: 'u-1',
      route: '/sync/push',
      status: 200,
      durationMs: 12,
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    // Empty context is left out instead of written as null.
    expect(JSON.parse(lines[0]!)).not.toHaveProperty('locationId');
  });

  it('never writes a PIN, a password, a token or a hash, at any depth', () => {
    expect(
      redact({
        pin: '1234',
        body: { password: 'x', nested: { deviceToken: 't', pinLookup: 'h' } },
        headers: { authorization: 'Bearer y', 'x-terminal-token': 'z' },
        keep: 'visible',
      }),
    ).toEqual({
      pin: '[redacted]',
      body: {
        password: '[redacted]',
        nested: { deviceToken: '[redacted]', pinLookup: '[redacted]' },
      },
      headers: { authorization: '[redacted]', 'x-terminal-token': '[redacted]' },
      keep: 'visible',
    });
  });

  it('a failed query keeps its SQL, never its parameters', () => {
    const error = Object.assign(new Error('Failed query'), {
      query: 'select * from users where pin_lookup = ?',
      params: ['secret-lookup'],
      cause: { code: 'ER_X', message: 'boom' },
    });
    expect(JSON.stringify(loggableError(error))).not.toContain('secret-lookup');
    expect(loggableError(error)).toEqual({
      query: 'select * from users where pin_lookup = ?',
      code: 'ER_X',
      cause: 'boom',
    });
  });

  it('daily files older than the retention are pruned', () => {
    expect(
      expiredLogFiles(
        ['api-2026-07-16.jsonl', 'api-2026-07-17.jsonl', 'api-2026-10-15.jsonl', 'notes.txt'],
        '2026-10-15',
        90,
      ),
    ).toEqual(['api-2026-07-16.jsonl']);
  });
});
