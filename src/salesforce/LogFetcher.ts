import { SalesforceClient, SalesforceApiError } from './SalesforceClient';

const API_VERSION = 'v59.0';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SoqlResponse<T> {
  totalSize: number;
  done: boolean;
  records: T[];
}

interface ApexLogRecord {
  Id: string;
  LogUser: { Id: string; Name: string };
  LogLength: number;
  LastModifiedDate: string;
  Status: string;
  Operation: string;
  Application: string;
  DurationMilliseconds: number;
  Location: string;
}

export interface OrgLogEntry {
  id: string;
  userId: string;
  userName: string;
  sizeBytes: number;
  lastModified: Date;
  status: string;
  operation: string;
  application: string;
  durationMs: number;
  location: string;
}

export interface OrgIdentity {
  userId:      string;
  userName:    string;
  displayName: string;
  instanceUrl: string;
  orgId:       string;
}

// ── Identity validation ───────────────────────────────────────────────────────

/**
 * Resolves the current user's identity using the userinfo endpoint.
 * Must be called BEFORE SalesforceClient.init so we can validate the session.
 */
export async function validateAndIdentify(
  instanceUrl: string,
  sessionId:   string
): Promise<OrgIdentity> {
  const url = `${instanceUrl.replace(/\/$/, '')}/services/oauth2/userinfo`;
  const res  = await fetch(url, {
    headers: { Authorization: `Bearer ${sessionId}`, Accept: 'application/json' },
  });

  if (res.status === 401 || res.status === 403) {
    throw new SalesforceApiError('Invalid or expired session.', res.status, 'INVALID_SESSION_ID');
  }
  if (!res.ok) throw new SalesforceApiError(`HTTP ${res.status}`, res.status);

  const data = await res.json() as {
    user_id: string; username: string; display_name: string; organization_id: string;
  };

  return {
    userId:      data.user_id,
    userName:    data.username,
    displayName: data.display_name,
    instanceUrl: instanceUrl.replace(/\/$/, ''),
    orgId:       data.organization_id,
  };
}

// ── Log list ──────────────────────────────────────────────────────────────────

export async function fetchLogList(userId: string, limit = 30): Promise<OrgLogEntry[]> {
  const query = encodeURIComponent(
    `SELECT Id, LogUser.Id, LogUser.Name, LogLength, LastModifiedDate, ` +
    `Status, Operation, Application, DurationMilliseconds, Location ` +
    `FROM ApexLog WHERE LogUserId = '${userId}' ` +
    `ORDER BY LastModifiedDate DESC LIMIT ${limit}`
  );

  const res = await SalesforceClient.get<SoqlResponse<ApexLogRecord>>(
    `/services/data/${API_VERSION}/tooling/query?q=${query}`
  );

  return res.records.map(r => ({
    id:           r.Id,
    userId:       r.LogUser.Id,
    userName:     r.LogUser.Name,
    sizeBytes:    r.LogLength,
    lastModified: new Date(r.LastModifiedDate),
    status:       r.Status,
    operation:    r.Operation,
    application:  r.Application,
    durationMs:   r.DurationMilliseconds,
    location:     r.Location,
  }));
}

// ── Log body ──────────────────────────────────────────────────────────────────

export async function fetchLogBody(logId: string): Promise<string> {
  return SalesforceClient.get<string>(
    `/services/data/${API_VERSION}/tooling/sobjects/ApexLog/${logId}/Body`
  );
}

// ── Org limits ────────────────────────────────────────────────────────────────

export interface OrgLimitEntry {
  key: string;
  displayName: string;
  max: number;
  remaining: number;
  used: number;
  percentUsed: number;
  severity: 'ok' | 'warning' | 'critical';
}

export async function fetchOrgLimits(): Promise<OrgLimitEntry[]> {
  const raw = await SalesforceClient.get<Record<string, { Max: number; Remaining: number }>>(
    `/services/data/${API_VERSION}/limits`
  );

  return Object.entries(raw)
    .filter(([, v]) => v.Max > 0)
    .map(([key, v]) => {
      const used = v.Max - v.Remaining;
      const percentUsed = Math.round((used / v.Max) * 100);
      const severity: 'ok' | 'warning' | 'critical' =
        percentUsed >= 80 ? 'critical' : percentUsed >= 50 ? 'warning' : 'ok';
      return { key, displayName: camelToLabel(key), max: v.Max, remaining: v.Remaining, used, percentUsed, severity };
    })
    .sort((a, b) => b.percentUsed - a.percentUsed);
}

function camelToLabel(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}
