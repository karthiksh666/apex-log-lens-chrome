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

// ── Session state — in-memory + chrome.storage.session for SW restart survival ─
let _instanceUrl: string | null = null;
let _sessionId:   string | null = null;

export const SalesforceClient = {
  init(instanceUrl: string, sessionId: string): void {
    _instanceUrl = instanceUrl.replace(/\/$/, '');
    _sessionId   = sessionId;
    // Persist so service worker restarts can recover the session
    void chrome.storage.session.set({ sf_instanceUrl: _instanceUrl, sf_sessionId: _sessionId });
  },

  clear(): void {
    _instanceUrl = null;
    if (_sessionId) _sessionId = _sessionId.replace(/./g, '0');
    _sessionId = null;
    void chrome.storage.session.remove(['sf_instanceUrl', 'sf_sessionId']);
  },

  /** Restore session from storage after a service worker restart. */
  async restore(): Promise<boolean> {
    if (_instanceUrl && _sessionId) return true; // already loaded
    const data = await chrome.storage.session.get(['sf_instanceUrl', 'sf_sessionId']);
    if (data['sf_instanceUrl'] && data['sf_sessionId']) {
      _instanceUrl = data['sf_instanceUrl'] as string;
      _sessionId   = data['sf_sessionId'] as string;
      return true;
    }
    return false;
  },

  get instanceUrl(): string | null { return _instanceUrl; },
  get isConnected(): boolean { return !!_instanceUrl && !!_sessionId; },

  async get<T>(path: string): Promise<T> {
    // Try to restore from storage if the service worker was recycled
    if (!_instanceUrl || !_sessionId) await SalesforceClient.restore();
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
