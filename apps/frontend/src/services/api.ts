export type DashboardSnapshot = {
  capturedAt?: string;
  targetId: string;
  health: unknown;
  performance: unknown;
  storage: unknown;
  sessions: unknown;
  queries: unknown;
  alerts: unknown;
  backups: unknown;
};

export type SnapshotHistoryItem = DashboardSnapshot & {
  id: number;
  capturedAt: string;
};

export type SnapshotHistoryResponse = {
  items: SnapshotHistoryItem[];
  total: number;
  limit: number;
  offset: number;
};

export type BackupInfo = {
  database_name: string;
  last_full_backup: string | null;
  last_diff_backup: string | null;
  last_log_backup: string | null;
};
const jsonGet = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API failed for ${url}`);
  }
  return response.json() as Promise<T>;
};

const jsonPost = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API failed for ${url}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
};

const jsonPut = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API failed for ${url}`);
  }

  return response.json() as Promise<T>;
};

const downloadGet = async (url: string): Promise<Blob> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API failed for ${url}`);
  }
  return response.blob();
};

const withTarget = (path: string, targetId?: string): string => {
  if (!targetId) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}targetId=${encodeURIComponent(targetId)}`;
};

export type DbTarget = {
  id: string;
  name: string;
  connectionStringMasked: string;
  connection: {
    server: string;
    port: number;
    database: string;
    userId: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
    hasPassword: boolean;
  };
  createdAt: string;
};

export type ConnectionPayload = {
  server: string;
  port: number;
  database: string;
  userId: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
};

export type DbTargetsResponse = {
  targets: DbTarget[];
  activeTargetId: string;
};

export const api = {
  ping: () => jsonGet<{ message: string }>('/api/ping'),
  listTargets: () => jsonGet<DbTargetsResponse>('/api/targets'),
  addTarget: (name: string, connection: ConnectionPayload) =>
    jsonPost<DbTarget>('/api/targets', { name, connection }),
  updateTarget: (targetId: string, payload: { name?: string; connection?: ConnectionPayload }) =>
    jsonPut<DbTarget>(`/api/targets/${encodeURIComponent(targetId)}`, payload),
  selectTarget: (targetId: string) => jsonPost<void>('/api/targets/select', { targetId }),
  health: (targetId?: string) => jsonGet(withTarget('/api/health', targetId)),
  performance: (targetId?: string) => jsonGet(withTarget('/api/performance', targetId)),
  storage: (targetId?: string) => jsonGet(withTarget('/api/storage', targetId)),
  sessions: (targetId?: string) => jsonGet(withTarget('/api/sessions', targetId)),
  queries: (targetId?: string) => jsonGet(withTarget('/api/queries', targetId)),
  alerts: (targetId?: string) => jsonGet(withTarget('/api/alerts', targetId)),
  aiInsights: (targetId?: string) =>
    jsonGet<{ summary: string; generatedAt: string }>(withTarget('/api/ai/insights', targetId)),
  backups: (targetId?: string) => jsonGet<BackupInfo[]>(withTarget('/api/backups', targetId)),
  saveSnapshot: (snapshot: DashboardSnapshot) =>
    jsonPost<{ ok: boolean }>('/api/snapshots', snapshot),
  listSnapshots: (params?: { targetId?: string; from?: string; to?: string; limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params?.targetId) search.set('targetId', params.targetId);
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    if (params?.limit) search.set('limit', String(params.limit));
    if (typeof params?.offset === 'number') search.set('offset', String(params.offset));
    const qs = search.toString();
    return jsonGet<SnapshotHistoryResponse>(`/api/snapshots${qs ? `?${qs}` : ''}`);
  },
  exportSnapshots: (params?: { targetId?: string; from?: string; to?: string; format?: 'json' | 'csv' }) => {
    const search = new URLSearchParams();
    if (params?.targetId) search.set('targetId', params.targetId);
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    search.set('format', params?.format ?? 'json');
    const qs = search.toString();
    return downloadGet(`/api/snapshots/export?${qs}`);
  },
};
