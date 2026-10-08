/**
 * Requests of the POS to a node (the cloud origin or a LAN hub, docs/SYNC.md §1). Every request
 * has a short timeout: a hanging WAN must never freeze the POS, it just counts as offline.
 */

export class NodeError extends Error {
  override readonly name = 'NodeError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The cloud is this origin; hubs are absolute URLs from the location settings. */
export const CLOUD = 'cloud';
export const nodeBase = (node: string) =>
  node === CLOUD ? '/api/v1' : `${node.replace(/\/$/, '')}/api/v1`;

export async function callNode<T>(
  node: string,
  path: string,
  init: {
    method?: 'GET' | 'POST';
    body?: unknown;
    deviceToken?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
  try {
    const response = await fetch(`${nodeBase(node)}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(init.deviceToken ? { 'x-terminal-token': init.deviceToken } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const error = (data as { error?: { code?: string; message?: string; details?: unknown } })
        ?.error;
      throw new NodeError(
        response.status,
        error?.code ?? 'HTTP_ERROR',
        error?.message ?? response.statusText,
        error?.details,
      );
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}
