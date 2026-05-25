export type DashboardSnapshot = {
  capturedAt?: string;
  targetId: string;
  health: unknown;
  performance: unknown;
  ple: unknown;
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

export type MonitoringTableStats = {
  serverListCount: number;
  snapshotHeaderCount: number;
  snapshotDetailCount: number;
  dashboardSnapshotCount: number;
  oldestSnapshotAt: string | null;
  newestSnapshotAt: string | null;
  retentionDays: number;
  error: string | null;
};

export type BackupInfo = {
  database_name: string;
  last_full_backup: string | null;
  last_diff_backup: string | null;
  last_log_backup: string | null;
};

export type ServerLogin = {
  login_name: string;
  login_type: string;
  is_disabled: number;
  is_policy_checked: number;
  is_expiration_checked: number;
  default_database: string;
  create_date: string;
  modify_date: string;
  server_roles: string;
};

export type ServerRoleMember = {
  role_name: string;
  member_name: string;
  member_type: string;
  is_member_disabled: number;
};

export type DbUser = {
  database_name: string;
  user_name: string;
  user_type: string;
  login_name: string;
  default_schema: string;
  create_date: string;
  db_roles: string;
};

export type DbRoleMember = {
  database_name: string;
  role_name: string;
  member_name: string;
  member_type: string;
};

export type ObjectPermission = {
  database_name: string;
  principal_name: string;
  principal_type: string;
  object_name: string;
  object_type: string;
  permission_name: string;
  permission_state: string;
};

export type SecurityData = {
  serverLogins: ServerLogin[];
  serverRoles: ServerRoleMember[];
  dbUsers: DbUser[];
  dbRoles: DbRoleMember[];
  objectPermissions: ObjectPermission[];
};

export type AdminUser = {
  id: number;
  username: string;
  role: 'admin' | 'reader';
  created_at?: string;
  is_active?: boolean;
  active_tab_count?: number;
  last_active_at?: string | null;
};

let clientTabId = '';

export const setClientTabId = (tabId: string) => {
  clientTabId = tabId;
};

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('token');
  if (!token) {
    return {};
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };

  if (clientTabId) {
    headers['X-Client-Tab-Id'] = clientTabId;
  }

  return headers;
};

const jsonGet = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    headers: {
      ...getAuthHeaders()
    }
  });
  if (!response.ok) {
    throw new Error(`API failed for ${url}`);
  }
  return response.json() as Promise<T>;
};

const jsonPost = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
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
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API failed for ${url}`);
  }

  return response.json() as Promise<T>;
};

const downloadGet = async (url: string): Promise<Blob> => {
  const response = await fetch(url, {
    headers: {
      ...getAuthHeaders()
    }
  });
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
  ple: (targetId?: string) => jsonGet<{ node_name: string; page_life_expectancy: number }[]>(withTarget('/api/ple', targetId)),
  suggestions: (targetId?: string) => jsonGet<{ missingIndexes: any[]; fragmentedIndexes: any[] }>(withTarget('/api/suggestions', targetId)),
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
  killSession: (sessionId: number, targetId?: string) =>
    jsonPost<void>(`/api/sessions/${encodeURIComponent(String(sessionId))}/kill`, { targetId }),
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
  exportSnapshots: (params?: { targetId?: string; from?: string; to?: string; format?: 'json' | 'csv' | 'excel' | 'pdf' }) => {
    const search = new URLSearchParams();
    if (params?.targetId) search.set('targetId', params.targetId);
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    search.set('format', params?.format ?? 'json');
    const qs = search.toString();
    return downloadGet(`/api/snapshots/export?${qs}`);
  },
  monitoringStats: () => jsonGet<MonitoringTableStats>('/api/admin/monitoring-stats'),
  security: (targetId?: string) => jsonGet<SecurityData>(withTarget('/api/security', targetId)),
  listUsers: () => jsonGet<AdminUser[]>('/api/users'),
  presenceHeartbeat: (tabId: string) =>
    fetch('/api/presence/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ tabId })
    }).then((res) => {
      if (!res.ok && res.status !== 204) throw new Error('Failed to update presence');
    }),
  presenceClose: (tabId: string, keepalive = false) =>
    fetch('/api/presence/close', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ tabId }),
      keepalive
    }).then((res) => {
      if (!res.ok && res.status !== 204) throw new Error('Failed to close presence');
    }),
  createUser: (username: string, password: string, role: 'admin' | 'reader') =>
    jsonPost<{ message: string }>('/api/users', { username, password, role }),
  deleteUser: (userId: number) =>
    fetch(`/api/users/${encodeURIComponent(String(userId))}`, {
      method: 'DELETE',
      headers: {
        ...getAuthHeaders()
      }
    }).then((res) => {
      if (!res.ok) throw new Error('Failed to delete user');
    }),
  deleteTarget: (targetId: string) =>
    fetch(`/api/targets/${encodeURIComponent(targetId)}`, {
      method: 'DELETE',
      headers: {
        ...getAuthHeaders()
      }
    }).then((res) => {
      if (!res.ok) throw new Error('Failed to delete target');
    }),
};
