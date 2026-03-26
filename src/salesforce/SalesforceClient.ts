/**
 * Fetch-based Salesforce REST client for the Chrome extension.
 * Runs inside the service worker — uses browser fetch, not Node https.
 *
 * SECURITY: session ID is stored only in chrome.storage.session
 * (cleared when the browser profile session ends) and never logged.
 */

export class SalesforceApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: string
  ) {
    super(message);
    this.name = 'SalesforceApiError';
  }
}

// ── Session state (in-memory only within the service worker) ─────────────────
let _instanceUrl: string | null = null;
let _sessionId:   string | null = null;

export const SalesforceClient = {
  init(instanceUrl: string, sessionId: string): void {
    _instanceUrl = instanceUrl.replace(/\/$/, '');
    _sessionId   = sessionId;
  },

  clear(): void {
    _instanceUrl = null;
    if (_sessionId) _sessionId = _sessionId.replace(/./g, '0');
    _sessionId = null;
  },

  get instanceUrl(): string | null { return _instanceUrl; },
  get isConnected(): boolean { return !!_instanceUrl && !!_sessionId; },

  async get<T>(path: string): Promise<T> {
    if (!_instanceUrl || !_sessionId) {
      throw new SalesforceApiError('Not connected', 401);
    }

    const url = `${_instanceUrl}${path}`;
    const res  = await fetch(url, {
      headers: {
        Authorization: `Bearer ${_sessionId}`,
        Accept: 'application/json',
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new SalesforceApiError('Session expired or invalid', res.status, 'INVALID_SESSION_ID');
    }
    if (!res.ok) {
      throw new SalesforceApiError(`HTTP ${res.status}`, res.status);
    }

    // Some endpoints (like /Body) return plain text
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return res.json() as Promise<T>;
    }
    return res.text() as unknown as T;
  },
};
