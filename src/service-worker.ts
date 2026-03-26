/**
 * Service Worker (MV3 background script).
 *
 * Responsibilities:
 *  1. Auto-detect session when content script reports a Salesforce page
 *  2. Open the side panel when the action icon is clicked
 *  3. Handle fetch requests from the panel (log list, log body, identity)
 *
 * SECURITY: session ID is kept only in the service-worker's module-level
 * variables. It is never persisted to chrome.storage, never logged,
 * and is cleared when the service worker is recycled.
 */

import { SalesforceClient, SalesforceApiError } from './salesforce/SalesforceClient';
import { validateAndIdentify, fetchLogList, fetchLogBody } from './salesforce/LogFetcher';
import { parseLog } from './parser/index';

// ── In-memory session ─────────────────────────────────────────────────────────

interface Identity {
  userId:      string;
  userName:    string;
  displayName: string;
  instanceUrl: string;
  orgId:       string;
}

let _identity: Identity | null = null;

// ── Open side panel on action click ──────────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
      // Side panel not supported in this context — ignore
    });
  }
});

// ── Auto-connect when content script detects Salesforce page ─────────────────

chrome.runtime.onMessage.addListener((msg: Record<string, unknown>, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  switch (msg.type) {
    case 'sfPageDetected':
      void handlePageDetected(msg.instanceUrl as string, sendResponse);
      return true; // keep channel open for async response

    case 'getStatus':
      sendResponse({
        connected:   SalesforceClient.isConnected,
        identity:    _identity,
      });
      return false;

    case 'fetchLogs':
      void handleFetchLogs(sendResponse);
      return true;

    case 'fetchLog':
      void handleFetchLog(msg.logId as string, msg.sizeBytes as number, sendResponse);
      return true;

    case 'disconnect':
      SalesforceClient.clear();
      _identity = null;
      sendResponse({ ok: true });
      return false;
  }

  return false;
});

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handlePageDetected(instanceUrl: string, sendResponse: (r: unknown) => void): Promise<void> {
  // Already connected to this org — nothing to do
  if (SalesforceClient.isConnected && SalesforceClient.instanceUrl === instanceUrl) {
    sendResponse({ connected: true, identity: _identity });
    return;
  }

  // Try to grab the sid cookie for this domain
  try {
    const cookie = await chrome.cookies.get({ url: instanceUrl, name: 'sid' });
    if (!cookie?.value) {
      sendResponse({ connected: false });
      return;
    }

    const identity = await validateAndIdentify(instanceUrl, cookie.value);
    SalesforceClient.init(instanceUrl, cookie.value);
    _identity = identity;
    sendResponse({ connected: true, identity });

    // Notify any open panels
    void chrome.runtime.sendMessage({ type: 'orgStatus', connected: true, identity }).catch(() => {});
  } catch {
    sendResponse({ connected: false });
  }
}

async function handleFetchLogs(sendResponse: (r: unknown) => void): Promise<void> {
  if (!_identity) {
    sendResponse({ error: 'Not connected' });
    return;
  }
  try {
    const logs = await fetchLogList(_identity.userId, 30);
    sendResponse({ logs: logs.map(l => ({ ...l, lastModified: l.lastModified.toISOString() })) });
  } catch (err) {
    sendResponse({ error: err instanceof SalesforceApiError ? err.message : 'Failed to fetch logs' });
  }
}

async function handleFetchLog(logId: string, sizeBytes: number, sendResponse: (r: unknown) => void): Promise<void> {
  try {
    const rawText  = await fetchLogBody(logId);
    const instanceUrl = _identity?.instanceUrl ?? 'org';
    const parsedLog   = parseLog(rawText, `org://${instanceUrl}/${logId}`, sizeBytes, {});
    sendResponse({ ok: true, parsedLog });
  } catch (err) {
    sendResponse({ error: err instanceof SalesforceApiError ? err.message : 'Failed to open log' });
  }
}
