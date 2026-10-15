import { APP_VERSION } from '@pos/api';

/**
 * Calls from the hub to the cloud API (docs/SYNC.md §11). Injectable, so tests run the cloud
 * in-process; in production it is `fetch` with a timeout and the hub's device token.
 */
export type CloudFetch = (
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown },
) => Promise<Response>;

export class CloudError extends Error {
  override readonly name = 'CloudError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function cloudFetcher(
  baseUrl: string,
  token: () => string | null,
  timeoutMs = 10_000,
): CloudFetch {
  const base = `${baseUrl.replace(/\/$/, '')}/api/v1`;
  return async (path, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const deviceToken = token();
      return await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          // The cloud keeps the hub's heartbeat and version (RNF-16, RNF-17).
          'x-app-version': APP_VERSION,
          ...(deviceToken ? { 'x-terminal-token': deviceToken } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function cloudJson<T>(
  cloud: CloudFetch,
  path: string,
  init?: Parameters<CloudFetch>[1],
): Promise<T> {
  const response = await cloud(path, init);
  if (!response.ok) {
    throw new CloudError(response.status, `${init?.method ?? 'GET'} ${path} → ${response.status}`);
  }
  return (await response.json()) as T;
}
