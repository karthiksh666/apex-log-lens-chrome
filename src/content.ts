/**
 * Content script — runs on every *.salesforce.com page.
 *
 * Detects that we're on a live Salesforce org and tells the service worker
 * the instance URL so it can pull the session cookie automatically.
 * No data is read from the page DOM — only window.location is used.
 */

const hostname = window.location.hostname;

// Skip login, developer docs, etc.
const isOrgPage =
  hostname.endsWith('.salesforce.com') ||
  hostname.endsWith('.force.com');

if (isOrgPage) {
  // Lightning pages run on *.lightning.force.com but the API/cookie domain
  // is *.my.salesforce.com — resolve it so the service worker can find the sid cookie.
  let instanceUrl = `${window.location.protocol}//${hostname}`;

  // e.g. myorg.lightning.force.com → https://myorg.my.salesforce.com
  const lightningMatch = hostname.match(/^([^.]+)\.lightning\.force\.com$/);
  if (lightningMatch) {
    instanceUrl = `https://${lightningMatch[1]}.my.salesforce.com`;
  }

  // e.g. myorg--partial.sandbox.lightning.force.com → keep host, swap suffix
  const sandboxLightningMatch = hostname.match(/^(.+)\.lightning\.force\.com$/);
  if (!lightningMatch && sandboxLightningMatch) {
    instanceUrl = `https://${sandboxLightningMatch[1]}.my.salesforce.com`;
  }

  chrome.runtime.sendMessage({
    type:        'sfPageDetected',
    instanceUrl: instanceUrl,
    pageUrl:     `${window.location.protocol}//${hostname}`,
  });
}
