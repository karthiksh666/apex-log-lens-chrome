# Apex Log Lens

**A Chrome extension for analyzing Salesforce Apex debug logs — right in your browser.**

![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

Apex Log Lens opens as a Chrome side panel and automatically connects to any Salesforce org you're already logged into. No configuration, no re-authentication — just open the panel and start debugging.

---

## Screenshot

> _Screenshot placeholder — add a screenshot of the side panel here._

---

## Features

### Auto-Connection
- Detects any Salesforce org you navigate to (`*.salesforce.com`, `*.force.com`, `*.lightning.force.com`)
- Authenticates using your existing browser session cookie — no login required
- Displays the connected org name and domain in the panel header

### Log List
- Shows the last **30 Apex debug logs** for the current user
- Search and filter logs by name
- Status indicators: green (success), yellow (skipped), red (error)
- Displays duration and size for each log
- Auto-refreshes every **30 seconds**
- "View Org Limits" shortcut when no logs are present

### Log Viewer — 8 Tabs

| Tab | Description |
|---|---|
| **Execution** | Transaction execution tree with expandable steps, duration badges, phase pills, and search |
| **Issues** | Errors and warnings with full stack traces and selectable text |
| **Data** | All SOQL queries and DML statements |
| **Automation** | Triggers, Flows, Process Builder, and Validation Rules |
| **Limits** | Per-transaction governor limits with progress bars, plus live org-level limits fetched from the API |
| **Callouts** | HTTP callouts with status codes |
| **Debug** | `USER_DEBUG` statements |
| **Raw** | Full raw log text with highlighted Error, SOQL, and DML lines |

### Summary Header
Each log view shows a quick-glance summary: **Duration · SOQL count · DML count · Error count · Size · Event count**

### Navigation
- Open any log in a **new tab** using the expand button (⤢)
- Navigate back to the log list with the back button (←)

---

## Installation

### Prerequisites
- Google Chrome (or any Chromium-based browser supporting Manifest V3)
- Node.js and npm

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/your-username/apex-log-lens-chrome.git
cd apex-log-lens-chrome

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build
```

4. Open Chrome and navigate to `chrome://extensions`
5. Enable **Developer mode** (toggle in the top-right corner)
6. Click **Load unpacked** and select the project folder
7. Pin the extension from the Chrome toolbar
8. Navigate to any Salesforce org and click the Apex Log Lens icon to open the side panel

---

## How It Works

1. **Detection** — A content script watches for navigation events matching Salesforce domains. When a match is found, it extracts the org's session cookie from the browser.
2. **Session persistence** — The session token and org metadata are stored in `chrome.storage.session`, scoped to the browser session and automatically cleared on close.
3. **Log fetching** — The side panel calls the Salesforce REST API using the stored session to retrieve the most recent 30 debug logs for the authenticated user.
4. **Log parsing** — Raw log text is parsed client-side into structured events (execution steps, SOQL, DML, limits, callouts, etc.) and rendered across the 8 viewer tabs.
5. **Auto-refresh** — The log list polls for new logs every 30 seconds without requiring any user interaction.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| TypeScript | Extension source code |
| esbuild | Fast bundling and compilation |
| Manifest V3 | Chrome extension platform |
| Chrome Side Panel API | Side panel UI host |
| `chrome.storage.session` | Session-scoped credential persistence |
| Salesforce REST API | Log list retrieval and org limits |

---

## Project Structure

```
apex-log-lens-chrome/
├── src/              # TypeScript source files
├── styles/           # CSS stylesheets
├── icons/            # Extension icons
├── dist/             # Built output (generated)
├── panel.html        # Side panel HTML entry point
├── manifest.json     # Chrome extension manifest
├── esbuild.config.mjs
├── tsconfig.json
└── package.json
```

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

---

## License

MIT
