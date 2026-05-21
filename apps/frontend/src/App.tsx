import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AIModePanel } from './components/AIModePanel';
import { MetricCard } from './components/MetricCard';
import { api, BackupInfo, ConnectionPayload, DbTarget, SnapshotHistoryItem } from './services/api';

type ConnectionFormFields = {
  server: string;
  port: string;
  database: string;
  userId: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
};

type DataState = {
  health: unknown;
  performance: unknown;
  storage: unknown;
  sessions: unknown;
  queries: unknown;
  alerts: unknown;
  backups: BackupInfo[];
};

type FormMode = 'add' | 'edit' | null;

const defaultConnectionFields: ConnectionFormFields = {
  server: '',
  port: '1433',
  database: 'master',
  userId: '',
  password: '',
  encrypt: false,
  trustServerCertificate: true
};

const initialState: DataState = {
  health: {},
  performance: {},
  storage: [],
  sessions: [],
  queries: [],
  alerts: {},
  backups: []
};

const toFormConnection = (target: DbTarget | null): ConnectionFormFields => {
  if (!target) {
    return { ...defaultConnectionFields };
  }

  return {
    server: target.connection.server,
    port: String(target.connection.port),
    database: target.connection.database,
    userId: target.connection.userId,
    password: '',
    encrypt: target.connection.encrypt,
    trustServerCertificate: target.connection.trustServerCertificate
  };
};

const toConnectionPayload = (fields: ConnectionFormFields): ConnectionPayload => ({
  server: fields.server.trim(),
  port: Number.parseInt(fields.port, 10) || 1433,
  database: fields.database.trim(),
  userId: fields.userId.trim(),
  password: fields.password,
  encrypt: fields.encrypt,
  trustServerCertificate: fields.trustServerCertificate
});

const sameConnectionWithoutPassword = (
  left: ConnectionFormFields,
  right: ConnectionFormFields
): boolean => {
  return (
    left.server.trim() === right.server.trim() &&
    left.port.trim() === right.port.trim() &&
    left.database.trim() === right.database.trim() &&
    left.userId.trim() === right.userId.trim() &&
    left.encrypt === right.encrypt &&
    left.trustServerCertificate === right.trustServerCertificate
  );
};

const getBackupStatusClass = (dateStr: string | null, type: 'full' | 'diff' | 'log'): string => {
  if (!dateStr) return 'backup-missing';
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return 'backup-missing';
  const now = new Date();
  const diffHours = (now.getTime() - dt.getTime()) / (1000 * 60 * 60);
  if (type === 'full') {
    if (diffHours > 168) return 'backup-stale';
    if (diffHours > 48) return 'backup-warning';
    return 'backup-ok';
  }
  if (type === 'diff') {
    if (diffHours > 48) return 'backup-stale';
    if (diffHours > 24) return 'backup-warning';
    return 'backup-ok';
  }
  if (diffHours > 24) return 'backup-stale';
  if (diffHours > 4) return 'backup-warning';
  return 'backup-ok';
};

const getBackupStalenessTooltip = (dateStr: string | null): string => {
  if (!dateStr) return 'No backup found';
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return 'Invalid date';
  const now = new Date();
  const diffMs = now.getTime() - dt.getTime();
  if (diffMs < 0) return 'Backup is in the future';
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago (${diffHours.toFixed(1)} hours)`;
  }
  return `${diffHours.toFixed(1)} hours ago`;
};

export const App = () => {
  const [data, setData] = useState<DataState>(initialState);
  const [targets, setTargets] = useState<DbTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [formTargetName, setFormTargetName] = useState('');
  const [formConnection, setFormConnection] = useState<ConnectionFormFields>(defaultConnectionFields);
  const [editBaselineConnection, setEditBaselineConnection] = useState<ConnectionFormFields>(defaultConnectionFields);
  const [targetMessage, setTargetMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiText, setAiText] = useState('Enable AI mode to receive diagnostics and recommendations.');
  const [snapshotHistory, setSnapshotHistory] = useState<SnapshotHistoryItem[]>([]);
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyLimit, setHistoryLimit] = useState(25);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<number | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === selectedTargetId) ?? null,
    [targets, selectedTargetId]
  );

  const refreshAll = async (targetId: string) => {
    if (!targetId) return;
    setLoading(true);
    try {
      const [health, performance, storage, sessions, queries, alerts, backups] = await Promise.all([
        api.health(targetId),
        api.performance(targetId),
        api.storage(targetId),
        api.sessions(targetId),
        api.queries(targetId),
        api.alerts(targetId),
        api.backups(targetId)
      ]);
      setData({ health, performance, storage, sessions, queries, alerts, backups });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadTargets = async () => {
      try {
        const response = await api.listTargets();
        if (!active) return;
        setTargets(response.targets);
        setSelectedTargetId(response.activeTargetId);
      } catch {
        if (active) setTargetMessage('Unable to load database target list.');
      }
    };
    void loadTargets();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTargetId) return;
    void refreshAll(selectedTargetId);
  }, [selectedTargetId]);

  useEffect(() => {
    if (!aiEnabled) return;
    let active = true;
    const loadAi = async () => {
      try {
        const insights = await api.aiInsights(selectedTargetId);
        if (active) setAiText(insights.summary);
      } catch {
        if (active) setAiText('AI insights are unavailable. Check backend AI provider settings.');
      }
    };
    void loadAi();
    return () => {
      active = false;
    };
  }, [aiEnabled, selectedTargetId]);

  useEffect(() => {
    if (!formMode) return;
    firstFieldRef.current?.focus();
  }, [formMode]);

  const openAddForm = () => {
    setFormMode('add');
    setFormTargetName('');
    setFormConnection({ ...defaultConnectionFields });
    setEditBaselineConnection({ ...defaultConnectionFields });
  };

  const openEditForm = () => {
    if (!selectedTarget) {
      setTargetMessage('Select a server before editing.');
      return;
    }
    const baseline = toFormConnection(selectedTarget);
    setFormMode('edit');
    setFormTargetName(selectedTarget.name);
    setFormConnection(baseline);
    setEditBaselineConnection(baseline);
  };

  const closeForm = () => {
    setFormMode(null);
    setFormTargetName('');
    setFormConnection({ ...defaultConnectionFields });
  };

  const handleSelectTarget = async (nextTargetId: string) => {
    setSelectedTargetId(nextTargetId);
    try {
      await api.selectTarget(nextTargetId);
      setTargetMessage('Database target updated.');
    } catch {
      setTargetMessage('Unable to switch database target.');
    }
  };

  const handleSubmitConnectionForm = async (event: FormEvent) => {
    event.preventDefault();

    if (!formTargetName.trim() || !formConnection.server.trim() || !formConnection.database.trim() || !formConnection.userId.trim()) {
      setTargetMessage('Enter target name, server, database, and user.');
      return;
    }

    const parsedPort = Number.parseInt(formConnection.port, 10);
    if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
      setTargetMessage('Port must be a valid positive number.');
      return;
    }

    if (formMode === 'add') {
      if (!formConnection.password) {
        setTargetMessage('Password is required to add a server.');
        return;
      }
      try {
        const created = await api.addTarget(formTargetName.trim(), toConnectionPayload(formConnection));
        setTargets((current) => [...current, created]);
        await api.selectTarget(created.id);
        setSelectedTargetId(created.id);
        setTargetMessage('Database target added successfully.');
        closeForm();
      } catch {
        setTargetMessage('Unable to add database target.');
      }
      return;
    }

    if (formMode === 'edit') {
      if (!selectedTargetId) {
        setTargetMessage('Select a server before editing.');
        return;
      }
      const isNameChanged = selectedTarget ? formTargetName.trim() !== selectedTarget.name : false;
      const isConnectionChanged = !sameConnectionWithoutPassword(formConnection, editBaselineConnection);
      const hasPassword = formConnection.password.length > 0;

      if (!isNameChanged && !isConnectionChanged && !hasPassword) {
        setTargetMessage('No changes detected for this server.');
        return;
      }

      if ((isConnectionChanged || hasPassword) && !formConnection.password) {
        setTargetMessage('Password is required when changing connection fields.');
        return;
      }

      const payload: { name?: string; connection?: ConnectionPayload } = {};
      if (isNameChanged) payload.name = formTargetName.trim();
      if (isConnectionChanged || hasPassword) payload.connection = toConnectionPayload(formConnection);

      try {
        const updated = await api.updateTarget(selectedTargetId, payload);
        setTargets((current) => current.map((target) => (target.id === selectedTargetId ? updated : target)));
        setTargetMessage('Database target saved successfully.');
        await refreshAll(selectedTargetId);
        closeForm();
      } catch {
        setTargetMessage('Unable to update database target.');
      }
    }
  };

  const handleSaveSnapshot = async () => {
    if (!selectedTargetId) return;
    try {
      await api.saveSnapshot({
        targetId: selectedTargetId,
        health: data.health,
        performance: data.performance,
        storage: data.storage,
        sessions: data.sessions,
        queries: data.queries,
        alerts: data.alerts,
        backups: data.backups
      });
      setTargetMessage('Snapshot saved to DBA_Monitoring.');
    } catch {
      setTargetMessage('Unable to save snapshot to DBA_Monitoring.');
    }
  };

  const loadSnapshotHistory = async (nextOffset?: number) => {
    setHistoryLoading(true);
    const effectiveOffset = typeof nextOffset === 'number' ? nextOffset : historyOffset;
    try {
      const response = await api.listSnapshots({
        targetId: selectedTargetId || undefined,
        from: historyFrom || undefined,
        to: historyTo || undefined,
        limit: historyLimit,
        offset: effectiveOffset
      });
      setSnapshotHistory(response.items);
      setHistoryTotal(response.total);
      setHistoryOffset(response.offset);
    } catch {
      setTargetMessage('Unable to load snapshot history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const startHistorySearch = () => {
    setExpandedSnapshotId(null);
    void loadSnapshotHistory(0);
  };

  const canGoPrev = historyOffset > 0;
  const canGoNext = historyOffset + snapshotHistory.length < historyTotal;

  const exportFilenamePrefix = useMemo(() => {
    const targetName = selectedTarget?.name?.replace(/\s+/g, '_') || 'all_targets';
    return `snapshot-history-${targetName}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }, [selectedTarget]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportSnapshotsJson = async () => {
    try {
      const blob = await api.exportSnapshots({
        targetId: selectedTargetId || undefined,
        from: historyFrom || undefined,
        to: historyTo || undefined,
        format: 'json'
      });
      downloadBlob(blob, `${exportFilenamePrefix}.json`);
    } catch {
      setTargetMessage('Unable to export snapshot history JSON.');
    }
  };

  const exportSnapshotsCsv = async () => {
    try {
      const blob = await api.exportSnapshots({
        targetId: selectedTargetId || undefined,
        from: historyFrom || undefined,
        to: historyTo || undefined,
        format: 'csv'
      });
      downloadBlob(blob, `${exportFilenamePrefix}.csv`);
    } catch {
      setTargetMessage('Unable to export snapshot history CSV.');
    }
  };

  const copySnapshotJson = async (snapshot: SnapshotHistoryItem) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setTargetMessage(`Snapshot ${snapshot.id} JSON copied.`);
    } catch {
      setTargetMessage('Unable to copy snapshot JSON.');
    }
  };

  const statusLabel = useMemo(() => {
    if (loading) return 'Refreshing...';
    if (selectedTarget) return `Live on ${selectedTarget.name}`;
    return 'Waiting for target';
  }, [loading, selectedTarget]);

  return (
    <main className="shell">
      <header className="hero">
        <p className="tag">A to Z SQL Server Monitoring</p>
        <h1>DB Command Bridge</h1>
        <div className="hero-row">
          <span className="status">Status: {statusLabel}</span>
          <button onClick={() => void refreshAll(selectedTargetId)} disabled={!selectedTargetId}>Refresh Snapshot</button>
          <button onClick={() => void handleSaveSnapshot()} disabled={!selectedTargetId} title="Save current dashboard data to DBA_Monitoring database">Save Snapshot</button>
        </div>

        <section className="target-panel">
          <div className="target-row">
            <label htmlFor="target-select">DB Server</label>
            <select id="target-select" value={selectedTargetId} onChange={(event) => void handleSelectTarget(event.target.value)}>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>{target.name}</option>
              ))}
            </select>
            <button type="button" onClick={openAddForm}>Add Server</button>
            <button type="button" onClick={openEditForm} disabled={!selectedTargetId}>Edit Selected</button>
          </div>

          {formMode && (
            <form className="target-add-row" onSubmit={(event) => void handleSubmitConnectionForm(event)}>
              <input ref={firstFieldRef} type="text" placeholder="Server label" value={formTargetName} onChange={(event) => setFormTargetName(event.target.value)} />
              <input type="text" placeholder="Server host" value={formConnection.server} onChange={(event) => setFormConnection((current) => ({ ...current, server: event.target.value }))} />
              <input type="text" placeholder="Port" value={formConnection.port} onChange={(event) => setFormConnection((current) => ({ ...current, port: event.target.value }))} />
              <input type="text" placeholder="Database" value={formConnection.database} onChange={(event) => setFormConnection((current) => ({ ...current, database: event.target.value }))} />
              <input type="text" placeholder="User ID" value={formConnection.userId} onChange={(event) => setFormConnection((current) => ({ ...current, userId: event.target.value }))} />
              <input type="password" placeholder={formMode === 'edit' ? 'Password (required if connection changed)' : 'Password'} value={formConnection.password} onChange={(event) => setFormConnection((current) => ({ ...current, password: event.target.value }))} />
              <label className="target-checkbox"><input type="checkbox" checked={formConnection.encrypt} onChange={(event) => setFormConnection((current) => ({ ...current, encrypt: event.target.checked }))} />Encrypt</label>
              <label className="target-checkbox"><input type="checkbox" checked={formConnection.trustServerCertificate} onChange={(event) => setFormConnection((current) => ({ ...current, trustServerCertificate: event.target.checked }))} />Trust Server Certificate</label>
              <button type="submit">{formMode === 'add' ? 'Save New Server' : 'Save Changes'}</button>
              <button type="button" onClick={closeForm}>Cancel</button>
            </form>
          )}

          {selectedTarget && <p className="target-meta">Active: {selectedTarget.connectionStringMasked}</p>}
          {targetMessage && <p className="target-message">{targetMessage}</p>}
        </section>
      </header>

      <section className="grid">
        <MetricCard title="Server Health" titleProps={{ title: 'SQL Server uptime, version, and start time.' }}>
          <pre>{JSON.stringify(data.health, null, 2)}</pre>
        </MetricCard>

        <MetricCard title="Performance & Waits" titleProps={{ title: 'Top waits and active requests.' }}>
          <pre>{JSON.stringify(data.performance, null, 2)}</pre>
        </MetricCard>

        <MetricCard title="Storage Footprint" titleProps={{ title: 'Database file size and tempdb utilization.' }}>
          <pre>{JSON.stringify(data.storage, null, 2)}</pre>
        </MetricCard>

        <MetricCard title="Active Sessions" titleProps={{ title: 'Session count by host and application.' }}>
          <pre>{JSON.stringify(data.sessions, null, 2)}</pre>
        </MetricCard>

        <MetricCard title="Top Expensive Queries" titleProps={{ title: 'Top queries by elapsed time.' }}>
          <pre>{JSON.stringify(data.queries, null, 2)}</pre>
        </MetricCard>

        <MetricCard title="Alert Feed" titleProps={{ title: 'Blocking chains and failed SQL Agent jobs.' }}>
          <pre>{JSON.stringify(data.alerts, null, 2)}</pre>
        </MetricCard>

        <MetricCard title="Backup Freshness">
          <table className="backup-table">
            <thead>
              <tr>
                <th>Database</th>
                <th>Last Full</th>
                <th>Last Diff</th>
                <th>Last Log</th>
              </tr>
            </thead>
            <tbody>
              {data.backups.length > 0 ? data.backups.map((b) => (
                <tr key={b.database_name}>
                  <td>{b.database_name}</td>
                  <td className={getBackupStatusClass(b.last_full_backup, 'full')} title={getBackupStalenessTooltip(b.last_full_backup)}>{b.last_full_backup ? new Date(b.last_full_backup).toLocaleString() : '—'}</td>
                  <td className={getBackupStatusClass(b.last_diff_backup, 'diff')} title={getBackupStalenessTooltip(b.last_diff_backup)}>{b.last_diff_backup ? new Date(b.last_diff_backup).toLocaleString() : '—'}</td>
                  <td className={getBackupStatusClass(b.last_log_backup, 'log')} title={getBackupStalenessTooltip(b.last_log_backup)}>{b.last_log_backup ? new Date(b.last_log_backup).toLocaleString() : '—'}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4}>No backup data</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="backup-legend">
            <span className="backup-ok">●</span> Healthy
            <span className="backup-warning">●</span> Warning
            <span className="backup-stale">●</span> Stale
            <span className="backup-missing">●</span> Missing
          </div>
        </MetricCard>
      </section>

      <AIModePanel enabled={aiEnabled} onToggle={() => setAiEnabled((v) => !v)} content={aiText} loading={false} />

      <section className="ai-panel" style={{ marginTop: 16 }}>
        <div className="ai-title-row">
          <h2>Snapshot History</h2>
          <div className="snapshot-actions">
            <button onClick={startHistorySearch} disabled={historyLoading}>
              {historyLoading ? 'Loading...' : 'Load History'}
            </button>
            <button onClick={() => void exportSnapshotsCsv()} disabled={historyLoading}>Export CSV (All Filtered)</button>
            <button onClick={() => void exportSnapshotsJson()} disabled={historyLoading}>Export JSON (All Filtered)</button>
          </div>
        </div>
        <div className="hero-row" style={{ marginTop: 8 }}>
          <input type="datetime-local" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} />
          <input type="datetime-local" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} />
          <input
            type="number"
            min={5}
            max={500}
            value={historyLimit}
            onChange={(e) => setHistoryLimit(Math.min(500, Math.max(5, Number.parseInt(e.target.value, 10) || 25)))}
            title="Rows per page"
          />
        </div>
        <table className="backup-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Captured At</th>
              <th>Target</th>
              <th>Health</th>
              <th>Alerts</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {snapshotHistory.length > 0 ? (
              snapshotHistory.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{row.id}</td>
                    <td>{new Date(row.capturedAt).toLocaleString()}</td>
                    <td>{row.targetId}</td>
                    <td title={JSON.stringify(row.health)}>{JSON.stringify(row.health).slice(0, 80)}{JSON.stringify(row.health).length > 80 ? '…' : ''}</td>
                    <td title={JSON.stringify(row.alerts)}>{JSON.stringify(row.alerts).slice(0, 80)}{JSON.stringify(row.alerts).length > 80 ? '…' : ''}</td>
                    <td>
                      <button type="button" onClick={() => setExpandedSnapshotId((current) => current === row.id ? null : row.id)}>
                        {expandedSnapshotId === row.id ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                  {expandedSnapshotId === row.id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="snapshot-actions" style={{ marginBottom: 8 }}>
                          <button type="button" onClick={() => void copySnapshotJson(row)}>Copy JSON</button>
                        </div>
                        <pre className="snapshot-json">{JSON.stringify(row, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            ) : (
              <tr>
                <td colSpan={6}>No snapshots found</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="history-pagination">
          <button type="button" disabled={!canGoPrev || historyLoading} onClick={() => void loadSnapshotHistory(Math.max(0, historyOffset - historyLimit))}>Previous</button>
          <span>
            Showing {snapshotHistory.length === 0 ? 0 : historyOffset + 1}-{historyOffset + snapshotHistory.length} of {historyTotal}
          </span>
          <button type="button" disabled={!canGoNext || historyLoading} onClick={() => void loadSnapshotHistory(historyOffset + historyLimit)}>Next</button>
        </div>
      </section>
    </main>
  );
};
