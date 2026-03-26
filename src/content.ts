/**
 * Content script — runs on every *.salesforce.com page.
 *
 * Detects that we're on a live Salesforce org and tells the service worker
 * the instance URL so it can pull the session cookie automatically.
 * No data is read from the page DOM — only window.location is used.
 */

const instanceUrl = `${window.location.protocol}//${window.location.hostname}`;

// Only act on actual org pages (not login.salesforce.com, developer-edition, etc.)
if (
  window.location.hostname.endsWith('.salesforce.com') ||
  window.location.hostname.endsWith('.force.com')
) {
  chrome.runtime.sendMessage({
    type:        'sfPageDetected',
    instanceUrl: instanceUrl,
  });
}
