import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AIModePanel } from './components/AIModePanel';
import { MetricCard } from './components/MetricCard';
import { MiniBarChart } from './components/MiniBarChart';
import { api, BackupInfo, ConnectionPayload, DbTarget, MonitoringTableStats, SecurityData, SnapshotHistoryItem } from './services/api';

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
type LooseRecord = Record<string, unknown>;

type BarDatum = {
 label: string;
 value: number;
 suffix?: string;
};

type PleHistoryPoint = {
 ts: string;
 value: number;
};

type KillAuditOutcomeFilter = 'all' | 'attempted' | 'succeeded' | 'failed';
type TopicKey =
 | 'health'
 | 'cpuMemory'
 | 'performance'
 | 'storage'
 | 'sessions'
 | 'queries'
 | 'alerts'
 | 'backups'
 | 'ple'
 | 'suggestions'
 | 'history'
 | 'security';

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

const isLooseRecord = (value: unknown): value is LooseRecord =>
 typeof value === 'object' && value !== null;

const asLooseArray = (value: unknown): LooseRecord[] => {
 if (!Array.isArray(value)) {
 return [];
 }
 return value.filter(isLooseRecord);
};

const toNumber = (value: unknown): number => {
 const parsed = typeof value === 'number' ? value : Number(value);
 return Number.isFinite(parsed) ? parsed : 0;
};

const formatNumber = (value: unknown): string => {
 const parsed = toNumber(value);
 return parsed.toLocaleString();
};

const formatBytes = (value: unknown): string => {
 const bytes = toNumber(value);
 if (bytes <= 0) return '0 B';
 const units = ['B', 'KB', 'MB', 'GB', 'TB'];
 let size = bytes;
 let unitIndex = 0;
 while (size >= 1024 && unitIndex < units.length - 1) {
 size /= 1024;
 unitIndex += 1;
 }
 return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
};

const formatElapsedDuration = (milliseconds: unknown): string => {
 const totalMs = Math.max(0, toNumber(milliseconds));
 const totalSeconds = Math.floor(totalMs / 1000);
 const hours = Math.floor(totalSeconds / 3600);
 const minutes = Math.floor((totalSeconds % 3600) / 60);
 const seconds = totalSeconds % 60;

 if (hours > 0) {
 return `${hours}h ${minutes}m ${seconds}s`;
 }
 if (minutes > 0) {
 return `${minutes}m ${seconds}s`;
 }
 return `${seconds}s`;
};

const shortText = (value: unknown, maxLength = 100): string => {
 const text = String(value ?? '');
 return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};



export const App = () => {
 const [data, setData] = useState<DataState>(initialState);
 const [targets, setTargets] = useState<DbTarget[]>([]);
 const [selectedTargetId, setSelectedTargetId] = useState('');
 const [showTopicPane, setShowTopicPane] = useState(false);
 const [homeHealthByTargetId, setHomeHealthByTargetId] = useState<Record<string, LooseRecord | null>>({});
 const [homeHealthLoading, setHomeHealthLoading] = useState(false);
 const [monitoringStats, setMonitoringStats] = useState<MonitoringTableStats | null>(null);
 const [formMode, setFormMode] = useState<FormMode>(null);
 const [formTargetName, setFormTargetName] = useState('');
 const [formConnection, setFormConnection] = useState<ConnectionFormFields>(defaultConnectionFields);
 const [editBaselineConnection, setEditBaselineConnection] = useState<ConnectionFormFields>(defaultConnectionFields);
 const [targetMessage, setTargetMessage] = useState('');
 const [loading, setLoading] = useState(false);
 // Removed AI mode state
 const [snapshotHistory, setSnapshotHistory] = useState<SnapshotHistoryItem[]>([]);
 const [historyFrom, setHistoryFrom] = useState('');
 const [historyTo, setHistoryTo] = useState('');
 const [historyLimit, setHistoryLimit] = useState(25);
 const [historyOffset, setHistoryOffset] = useState(0);
 const [historyTotal, setHistoryTotal] = useState(0);
 const [historyLoading, setHistoryLoading] = useState(false);
 const [historyAuditOnly, setHistoryAuditOnly] = useState(false);
 const [historyAuditOutcome, setHistoryAuditOutcome] = useState<KillAuditOutcomeFilter>('all');
 const [expandedSnapshotId, setExpandedSnapshotId] = useState<number | null>(null);
 const [killingSessionId, setKillingSessionId] = useState<number | null>(null);
 const [showProcessUtilization, setShowProcessUtilization] = useState(false);
 const [showLongRunningQueryWindow, setShowLongRunningQueryWindow] = useState(false);
 const [longRunningSortKey, setLongRunningSortKey] = useState<'running' | 'start' | 'session'>('running');
 const [longRunningSortOrder, setLongRunningSortOrder] = useState<'desc' | 'asc'>('desc');
 const [selectedTopic, setSelectedTopic] = useState<TopicKey | null>('health');
 const [showHistoryView, setShowHistoryView] = useState<{ topic: TopicKey | null }>({ topic: null });
 const [topicHistory, setTopicHistory] = useState<Array<{ id: number; capturedAt: string; value: unknown }>>([]);
 const [pleData, setPleData] = useState<{ node_id: number; page_life_expectancy: number }[]>([]);
 const [pleHourlyBars, setPleHourlyBars] = useState<BarDatum[]>([]);
 const [suggestionsData, setSuggestionsData] = useState<{ missingIndexes: any[]; fragmentedIndexes: any[] }>({ missingIndexes: [], fragmentedIndexes: [] });
 const [copiedKey, setCopiedKey] = useState<string | null>(null);
 const [showSuccessBackups, setShowSuccessBackups] = useState(false);
 const [securityData, setSecurityData] = useState<SecurityData | null>(null);
 const [securityLoading, setSecurityLoading] = useState(false);
 const firstFieldRef = useRef<HTMLInputElement | null>(null);

 const selectedTarget = useMemo(
 () => targets.find((target) => target.id === selectedTargetId) ?? null,
 [targets, selectedTargetId]
 );

 const loadHomeHealth = async (targetList: DbTarget[]) => {
 if (targetList.length === 0) {
 setHomeHealthByTargetId({});
 return;
 }

 setHomeHealthLoading(true);
 try {
 const results = await Promise.all(
 targetList.map(async (target) => {
 try {
 const health = await api.health(target.id);
 return [target.id, isLooseRecord(health) ? health : null] as const;
 } catch {
 return [target.id, null] as const;
 }
 })
 );

 setHomeHealthByTargetId(Object.fromEntries(results));
 } finally {
 setHomeHealthLoading(false);
 }
 };

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

 const loadPleForTarget = async (targetId: string) => {
 try {
 const rows = await api.ple(targetId);
 setPleData(rows);

 const totalRow = rows.find((row) => String((row as { node_name?: string }).node_name ?? '').toLowerCase() === '_total') ?? rows[0];
 const pleValue = totalRow ? toNumber(totalRow.page_life_expectancy) : 0;
 const historyKey = `ple-hourly-history-${targetId}`;

 let history: PleHistoryPoint[] = [];
 try {
 const raw = localStorage.getItem(historyKey);
 if (raw) {
 const parsed = JSON.parse(raw) as PleHistoryPoint[];
 history = Array.isArray(parsed) ? parsed : [];
 }
 } catch {
 history = [];
 }

 const now = new Date();
 history.push({ ts: now.toISOString(), value: pleValue });

 const cutoff = now.getTime() - (24 * 60 * 60 * 1000);
 history = history.filter((item) => {
 const t = new Date(item.ts).getTime();
 return Number.isFinite(t) && t >= cutoff;
 });

 localStorage.setItem(historyKey, JSON.stringify(history));

 const bars: BarDatum[] = [];
 for (let i = 23; i >= 0; i -= 1) {
 const bucket = new Date(now);
 bucket.setMinutes(0, 0, 0);
 bucket.setHours(bucket.getHours() - i);
 const next = new Date(bucket);
 next.setHours(next.getHours() + 1);

 const points = history.filter((item) => {
 const t = new Date(item.ts).getTime();
 return t >= bucket.getTime() && t < next.getTime();
 });

 const avg = points.length > 0
 ? points.reduce((sum, p) => sum + toNumber(p.value), 0) / points.length
 : 0;

 bars.push({
 label: `${String(bucket.getHours()).padStart(2, '0')}:00`,
 value: Number(avg.toFixed(0)),
 suffix: ' sec'
 });
 }

 setPleHourlyBars(bars);
 } catch {
 setPleData([]);
 setPleHourlyBars([]);
 }
 };

 const loadSuggestionsForTarget = async (targetId: string) => {
 try {
 const suggestions = await api.suggestions(targetId);
 setSuggestionsData(suggestions);
 } catch {
 setSuggestionsData({ missingIndexes: [], fragmentedIndexes: [] });
 }
 };

 const loadSecurityForTarget = async (targetId: string) => {
 setSecurityLoading(true);
 try {
 const nextData = await api.security(targetId);
 setSecurityData(nextData);
 } catch {
 setSecurityData(null);
 } finally {
 setSecurityLoading(false);
 }
 };

 const loadMonitoringStats = async () => {
 try {
 const stats = await api.monitoringStats();
 setMonitoringStats(stats);
 } catch {
 setMonitoringStats(null);
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
 void loadHomeHealth(response.targets);
 void loadMonitoringStats();
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
 if (targets.length === 0) {
 setHomeHealthByTargetId({});
 return;
 }

 void loadHomeHealth(targets);
 void loadMonitoringStats();
 }, [targets]);

 // Removed AI mode effect

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
 setShowTopicPane(Boolean(nextTargetId));
 if (nextTargetId) {
 setSelectedTopic((current) => current ?? 'health');
 }
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
 setShowTopicPane(true);
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

 const handleRemoveTarget = async () => {
 if (!selectedTargetId || selectedTargetId === 'default') return;
 if (!window.confirm('Are you sure you want to remove this server?')) return;
 setLoading(true);
 try {
 await api.deleteTarget(selectedTargetId);
 const refreshedTargets = await api.listTargets();
 setTargets(refreshedTargets.targets);
 setSelectedTargetId(refreshedTargets.activeTargetId);
 void loadHomeHealth(refreshedTargets.targets);
 setTargetMessage('Server removed successfully.');
 if (!refreshedTargets.activeTargetId) {
 setSelectedTargetId('');
 setShowTopicPane(false);
 setData(initialState);
 }
 } catch {
 setTargetMessage('Unable to remove server.');
 } finally {
 setLoading(false);
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
 } catch (err: any) {
 setTargetMessage('Unable to save snapshot to DBA_Monitoring. ' + (err?.message || err));
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
 } catch (err: any) {
 setTargetMessage('Unable to load snapshot history. ' + (err?.message || err));
 } finally {
 setHistoryLoading(false);
 }
 };

 const loadTopicHistory = async (topic: TopicKey, nextOffset?: number) => {
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
 setTopicHistory(
 response.items.map((row) => ({
 id: row.id,
 capturedAt: row.capturedAt,
 value: (row as unknown as Record<string, unknown>)[topic as string]
 }))
 );
 setHistoryTotal(response.total);
 setHistoryOffset(response.offset);
 } catch (err: any) {
 setTargetMessage('Unable to load topic history. ' + (err?.message || err));
 } finally {
 setHistoryLoading(false);
 }
 };

 const startHistorySearch = () => {
 setExpandedSnapshotId(null);
 if (showHistoryView.topic) {
 void loadTopicHistory(showHistoryView.topic, 0);
 return;
 }
 void loadSnapshotHistory(0);
 };

 const openHistoryView = (topic: TopicKey) => {
 setShowHistoryView({ topic });
 setTopicHistory([]);
 setExpandedSnapshotId(null);
 setHistoryFrom('');
 setHistoryTo('');
 setHistoryOffset(0);
 setHistoryTotal(0);
 };

 const closeHistoryView = () => {
 setShowHistoryView({ topic: null });
 setTopicHistory([]);
 setHistoryOffset(0);
 setHistoryTotal(0);
 };

 const handleSelectTopic = (topic: TopicKey) => {
 setSelectedTopic(topic);
 if (topic !== 'queries') {
 setShowLongRunningQueryWindow(false);
 }
 if (showHistoryView.topic) {
 closeHistoryView();
 }
 };

 const canGoPrev = historyOffset > 0;
 const historyRowCount = showHistoryView.topic ? topicHistory.length : snapshotHistory.length;
 const canGoNext = historyOffset + historyRowCount < historyTotal;

 const isSessionKillAuditSnapshot = (snapshot: SnapshotHistoryItem): boolean => {
 if (!isLooseRecord(snapshot.health)) {
 return false;
 }

 return snapshot.health.eventType === 'kill-session';
 };

 const getSessionKillAuditOutcome = (snapshot: SnapshotHistoryItem): string | null => {
 if (!isSessionKillAuditSnapshot(snapshot) || !isLooseRecord(snapshot.health)) {
 return null;
 }

 return String(snapshot.health.outcome ?? '').toLowerCase();
 };

 const auditHistoryRows = historyAuditOnly
 ? snapshotHistory.filter(isSessionKillAuditSnapshot)
 : snapshotHistory;

 const historyRows = historyAuditOnly && historyAuditOutcome !== 'all'
 ? auditHistoryRows.filter((snapshot) => getSessionKillAuditOutcome(snapshot) === historyAuditOutcome)
 : auditHistoryRows;

 const formatHistoryEvent = (snapshot: SnapshotHistoryItem): string => {
 if (!isSessionKillAuditSnapshot(snapshot) || !isLooseRecord(snapshot.health)) {
 return 'Snapshot';
 }

 const outcome = String(snapshot.health.outcome ?? 'unknown');
 const sessionId = snapshot.health.sessionId ?? '?';
 return `Session Kill ${outcome.toUpperCase()} (SPID ${sessionId})`;
 };

 const getHistoryEventClassName = (snapshot: SnapshotHistoryItem): string => {
 const outcome = getSessionKillAuditOutcome(snapshot);
 if (outcome === 'succeeded') return 'event-pill event-succeeded';
 if (outcome === 'failed') return 'event-pill event-failed';
 if (outcome === 'attempted') return 'event-pill event-attempted';
 return 'event-pill event-default';
 };

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

 const health = isLooseRecord(data.health) ? data.health : {};
 const performance = isLooseRecord(data.performance) ? data.performance : {};
 const storage = isLooseRecord(data.storage) ? data.storage : {};
 const alerts = isLooseRecord(data.alerts) ? data.alerts : {};

 const waits = asLooseArray(performance.topWaits);
 const activeRequests = asLooseArray(performance.activeRequests);
 const processUtilization = asLooseArray(performance.processUtilization);
 const osProcessUtilization = asLooseArray(performance.osProcessUtilization);
 const files = asLooseArray(storage.files);
 const drives = asLooseArray(storage.drives);
 const tempdb = isLooseRecord(storage.tempdb) ? storage.tempdb : null;
 const sessions = asLooseArray(data.sessions);
 const queries = asLooseArray(data.queries);
 const blocking = asLooseArray(alerts.blocking);
 const failedJobs = asLooseArray(alerts.failedJobs);
 const failedBackups = data.backups.filter((row) => !row.last_full_backup);
 const successfulBackups = data.backups.filter((row) => row.last_full_backup);

 const waitBars: BarDatum[] = waits.slice(0, 8).map((row) => ({
 label: shortText(row.wait_type, 22),
 value: toNumber(row.wait_time_ms),
 suffix: ' ms'
 }));

 const sessionCountByHost = sessions.reduce<Record<string, number>>((acc, row) => {
 const host = String(row.host_name ?? '(unknown)');
 acc[host] = (acc[host] ?? 0) + 1;
 return acc;
 }, {});

 const sessionBars: BarDatum[] = Object.entries(sessionCountByHost)
 .map(([label, value]) => ({ label: shortText(label, 20), value }))
 .sort((a, b) => b.value - a.value)
 .slice(0, 8);

 const queryBars: BarDatum[] = queries.slice(0, 8).map((row) => ({
 label: shortText(row.query_text, 24),
 value: toNumber(row.avg_elapsed_ms),
 suffix: ' ms'
 }));

 const sessionMetaById = sessions.reduce<Record<string, LooseRecord>>((acc, row) => {
 const key = String(row.session_id ?? '');
 if (key) {
 acc[key] = row;
 }
 return acc;
 }, {});

 const longRunningQueryRows = activeRequests
 .filter((row) => toNumber(row.total_elapsed_time) >= 5000)
 .map((row) => {
 const sessionId = String(row.session_id ?? '-');
 const meta = sessionMetaById[sessionId];
 const elapsedMs = toNumber(row.total_elapsed_time);
 const startedAtMs = elapsedMs > 0 ? Date.now() - elapsedMs : 0;
 const startTime = startedAtMs > 0 ? new Date(startedAtMs).toLocaleString() : '-';

 return {
 sessionId,
 programName: String(meta?.program_name ?? row.program_name ?? '-'),
 loginName: String(meta?.login_name ?? row.login_name ?? '-'),
 hostName: String(meta?.host_name ?? row.host_name ?? '-'),
 startTime,
 startedAtMs,
 runningFor: formatElapsedDuration(elapsedMs),
 elapsedMs,
 queryText: String(row.sql_text ?? row.query_text ?? '-')
 };
 });

 const longRunningQueries = [...longRunningQueryRows].sort((left, right) => {
 let comparison = 0;

 if (longRunningSortKey === 'running') {
 comparison = left.elapsedMs - right.elapsedMs;
 } else if (longRunningSortKey === 'start') {
 comparison = left.startedAtMs - right.startedAtMs;
 } else {
 const leftSession = Number.parseInt(left.sessionId, 10);
 const rightSession = Number.parseInt(right.sessionId, 10);
 if (Number.isFinite(leftSession) && Number.isFinite(rightSession)) {
 comparison = leftSession - rightSession;
 } else {
 comparison = left.sessionId.localeCompare(right.sessionId);
 }
 }

 return longRunningSortOrder === 'asc' ? comparison : -comparison;
 });

 const processCpuBars: BarDatum[] = processUtilization
 .slice(0, 8)
 .map((row) => ({
 label: shortText(row.program_name, 22),
 value: toNumber(row.cpu_time_ms),
 suffix: ' ms'
 }));

 const processMemoryBars: BarDatum[] = processUtilization
 .slice(0, 8)
 .map((row) => ({
 label: shortText(row.program_name, 22),
 value: toNumber(row.memory_mb),
 suffix: ' MB'
 }));

 const osProcessCpuBars: BarDatum[] = osProcessUtilization
 .slice(0, 8)
 .map((row) => ({
 label: shortText(row.name, 22),
 value: toNumber(row.cpu_percent),
 suffix: ' %'
 }));

 const osProcessMemoryBars: BarDatum[] = osProcessUtilization
 .slice(0, 8)
 .map((row) => ({
 label: shortText(row.name, 22),
 value: toNumber(row.memory_mb),
 suffix: ' MB'
 }));

 const fileSizeByDb = files.reduce<Record<string, number>>((acc, row) => {
 const dbName = String(row.database_name ?? '(unknown)');
 acc[dbName] = (acc[dbName] ?? 0) + toNumber(row.file_size_mb);
 return acc;
 }, {});

 const storageBars: BarDatum[] = Object.entries(fileSizeByDb)
 .map(([label, value]) => ({ label, value, suffix: ' MB' }))
 .sort((a, b) => b.value - a.value)
 .slice(0, 8);

 const storageTotals = files.reduce<{ allocatedMb: number; usedMb: number; freeMb: number }>(
 (acc, row) => {
 acc.allocatedMb += toNumber(row.file_size_mb);
 acc.usedMb += toNumber(row.used_mb);
 acc.freeMb += toNumber(row.free_mb);
 return acc;
 },
 { allocatedMb: 0, usedMb: 0, freeMb: 0 }
 );

 const driveBars: BarDatum[] = drives
 .map((row) => {
 const used = toNumber(row.used);
 const size = toNumber(row.size);
 const usedPercent = size > 0 ? Number(((used / size) * 100).toFixed(2)) : 0;
 return {
 label: shortText(row.name, 20),
 value: usedPercent,
 suffix: ' %'
 };
 })
 .sort((a, b) => b.value - a.value);

 const memory = isLooseRecord(health.memory) ? health.memory : null;
 const memoryUsedPercent = memory && toNumber(memory.total) > 0
 ? Number(((toNumber(memory.used) / toNumber(memory.total)) * 100).toFixed(2))
 : 0;

 const healthRows: Array<{ label: string; value: string }> = [
 { label: 'Status', value: String(health.status ?? 'unknown') },
 { label: 'Server', value: String(health.serverName ?? '-') },
 { label: 'Uptime (minutes)', value: formatNumber(health.uptimeMinutes) },
 { label: 'CPU Usage', value: `${formatNumber(health.cpuUsagePercent)} %` },
 {
 label: 'Memory Usage',
 value: memory ? `${formatBytes(memory.used)} / ${formatBytes(memory.total)} (${memoryUsedPercent}%)` : '-'
 },
 {
 label: 'SQL Start Time',
 value: health.sqlServerStartTime ? new Date(String(health.sqlServerStartTime)).toLocaleString() : '-'
 },
 {
 label: 'Checked At',
 value: health.checkedAt ? new Date(String(health.checkedAt)).toLocaleString() : '-'
 }
 ];

 const handleKillSession = async (sessionId: number) => {
 if (!selectedTargetId) {
 setTargetMessage('Select a server before killing a session.');
 return;
 }

 if (!window.confirm(`Kill session ${sessionId}?`)) {
 return;
 }

 setKillingSessionId(sessionId);
 try {
 await api.killSession(sessionId, selectedTargetId);
 setTargetMessage(`Session ${sessionId} killed successfully.`);
 await refreshAll(selectedTargetId);
 } catch {
 setTargetMessage(`Unable to kill session ${sessionId}.`);
 } finally {
 setKillingSessionId(null);
 }
 };

 const handleCopyText = async (key: string, text: string) => {
 if (!text) return;
 try {
 await navigator.clipboard.writeText(text);
 setCopiedKey(key);
 window.setTimeout(() => {
 setCopiedKey((prev) => (prev === key ? null : prev));
 }, 1400);
 } catch {
 setTargetMessage('Unable to copy text to clipboard.');
 }
 };

 // Hide AI Mode topic by not including it in the topicItems array
 const topicItems: Array<{ id: TopicKey; label: string }> = [
 { id: 'health', label: 'Instance Health Overview' },
 { id: 'cpuMemory', label: 'Host Resource Utilization' },
 { id: 'performance', label: 'Wait Statistics & Requests' },
 { id: 'storage', label: 'Database Storage Capacity' },
 { id: 'sessions', label: 'Session Activity & Control' },
 { id: 'queries', label: 'Query Performance Analysis' },
 { id: 'alerts', label: 'Operational Alerts & Incidents' },
 { id: 'backups', label: 'Backup Compliance Status' },
 { id: 'ple', label: 'Buffer Cache PLE Analysis' },
 { id: 'suggestions', label: 'Recommendations' },
 { id: 'security', label: 'Security & Access Control' },
 { id: 'history', label: 'Monitoring Snapshot Audit' }
 ];
 // Fetch topic-specific data when selected topic changes.
 useEffect(() => {
 if (selectedTopic === 'ple' && selectedTargetId) {
 void loadPleForTarget(selectedTargetId);
 }
 if (selectedTopic === 'suggestions' && selectedTargetId) {
 void loadSuggestionsForTarget(selectedTargetId);
 }
 if (selectedTopic === 'security' && selectedTargetId) {
 void loadSecurityForTarget(selectedTargetId);
 }
 }, [selectedTopic, selectedTargetId]);

 const refreshCurrentTopic = async () => {
 if (!selectedTargetId) {
 return;
 }

 await refreshAll(selectedTargetId);

 if (selectedTopic === 'ple') {
 await loadPleForTarget(selectedTargetId);
 }
 if (selectedTopic === 'suggestions') {
 await loadSuggestionsForTarget(selectedTargetId);
 }
 if (selectedTopic === 'security') {
 await loadSecurityForTarget(selectedTargetId);
 }
 if (selectedTopic === 'history') {
 await loadSnapshotHistory(0);
 }
 if (showHistoryView.topic) {
 await loadTopicHistory(showHistoryView.topic, 0);
 }
 };

 return (
 <main className="shell">
 <header className="hero">
 <p className="tag">Enterprise SQL Server Monitoring for DBAs</p>
 <h1>Professional SQL Server DBA Operations Console</h1>
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
 <button type="button" onClick={() => setShowTopicPane(false)} style={{ marginRight: 8 }}>Home</button>
 <button type="button" onClick={openAddForm}>Add Target</button>
 <button type="button" onClick={openEditForm} disabled={!selectedTargetId}>Edit Target</button>
 <button type="button" onClick={() => void handleRemoveTarget()} disabled={!selectedTargetId || selectedTargetId === 'default'} style={{ marginLeft: 8, color: 'red' }}>Remove Target</button>
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
 <button type="submit">{formMode === 'add' ? 'Save Target' : 'Save Changes'}</button>
 <button type="button" onClick={closeForm}>Cancel</button>
 </form>
 )}

 {selectedTarget && <p className="target-meta">Active: {selectedTarget.connectionStringMasked}</p>}
 {targetMessage && <p className="target-message">{targetMessage}</p>}
 </section>
 </header>

 {!showTopicPane && (
 <section className="ai-panel" style={{ marginTop: 0 }}>
 <h2>Home: SQL Server Instance Health Overview</h2>
 <p>Select a DB server to open the full topic pane and detailed monitoring reports.</p>
 <div className="metric-scroll" style={{ marginTop: 8, marginBottom: 8 }}>
 <table className="backup-table compact-table">
 <thead>
 <tr>
 <th>Server List Rows</th>
 <th>Snapshot Header Rows</th>
 <th>Snapshot Detail Rows</th>
 <th>Legacy Snapshot Rows</th>
 <th>Oldest Snapshot</th>
 <th>Newest Snapshot</th>
 <th>Retention (days)</th>
 </tr>
 </thead>
 <tbody>
 {monitoringStats ? (
 <tr>
 <td>{formatNumber(monitoringStats.serverListCount)}</td>
 <td>{formatNumber(monitoringStats.snapshotHeaderCount)}</td>
 <td>{formatNumber(monitoringStats.snapshotDetailCount)}</td>
 <td>{formatNumber(monitoringStats.dashboardSnapshotCount)}</td>
 <td>{monitoringStats.oldestSnapshotAt ? new Date(monitoringStats.oldestSnapshotAt).toLocaleString() : '-'}</td>
 <td>{monitoringStats.newestSnapshotAt ? new Date(monitoringStats.newestSnapshotAt).toLocaleString() : '-'}</td>
 <td>{formatNumber(monitoringStats.retentionDays)}{monitoringStats.error && <span className="status-warn" title={monitoringStats.error}> ΓÜá DB unavailable</span>}</td>
 </tr>
 ) : (
 <tr>
 <td colSpan={7}>Loading monitoring table statsΓÇª</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 {homeHealthLoading && <p>Loading server health overview...</p>}
 <div className="metric-scroll" style={{ marginTop: 8 }}>
 <table className="backup-table">
 <thead>
 <tr>
 <th>DB Server</th>
 <th>Status</th>
 <th>Instance Name</th>
 <th>Uptime (minutes)</th>
 <th>CPU (%)</th>
 <th>Memory Usage</th>
 <th>Checked At</th>
 <th>Open Reports</th>
 </tr>
 </thead>
 <tbody>
 {targets.length > 0 ? targets.map((target) => {
 const homeHealth = homeHealthByTargetId[target.id];
 const homeMemory = homeHealth && isLooseRecord(homeHealth.memory) ? homeHealth.memory : null;
 return (
 <tr key={target.id}>
 <td>{target.name}</td>
 <td>{String(homeHealth?.status ?? 'unknown')}</td>
 <td>{String(homeHealth?.serverName ?? '-')}</td>
 <td>{formatNumber(homeHealth?.uptimeMinutes ?? 0)}</td>
 <td>{formatNumber(homeHealth?.cpuUsagePercent ?? 0)}</td>
 <td>{homeMemory ? `${formatBytes(homeMemory.used)} / ${formatBytes(homeMemory.total)}` : '-'}</td>
 <td>{homeHealth?.checkedAt ? new Date(String(homeHealth.checkedAt)).toLocaleString() : '-'}</td>
 <td>
 <button type="button" onClick={() => void handleSelectTarget(target.id)}>
 Open Report
 </button>
 </td>
 </tr>
 );
 }) : (
 <tr>
 <td colSpan={8}>No database targets are configured</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </section>
 )}

 {showTopicPane && (
 <section className="topic-layout">
 <aside className="topic-sidebar">
 <h3>Monitoring Topics</h3>
 <div className="topic-list">
 {topicItems.map((topic) => (
 <button
 key={topic.id}
 type="button"
 className={`topic-button${selectedTopic === topic.id ? ' active' : ''}`}
 onClick={() => handleSelectTopic(topic.id)}
 >
 {topic.label}
 </button>
 ))}
 </div>
 </aside>

 <div className="topic-content">
 {selectedTopic && !showHistoryView.topic && (
 <div className="snapshot-actions" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
 <button type="button" onClick={() => void refreshCurrentTopic()} disabled={!selectedTargetId || loading || historyLoading || securityLoading}>
 {loading || securityLoading ? 'Refreshing Data...' : 'Refresh Topic Data'}
 </button>
 </div>
 )}

 {!selectedTopic && (
 <section className="ai-panel topic-placeholder">
 <h2>Select a monitoring domain</h2>
 <p>Click any topic on the left side to load that report on the right.</p>
 </section>
 )}

 {showHistoryView.topic && (
 <section className="ai-panel" style={{ marginTop: 0, position: 'relative' }}>
 <button className="history-btn history-back-btn" onClick={closeHistoryView}>Back to Live Data</button>
 <div className="ai-title-row">
 <h2>History View: {showHistoryView.topic.charAt(0).toUpperCase() + showHistoryView.topic.slice(1)}</h2>
 <div className="snapshot-actions">
 <input type="datetime-local" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} />
 <input type="datetime-local" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} />
 <button onClick={startHistorySearch} disabled={historyLoading}>
 {historyLoading ? 'Loading...' : 'Load History'}
 </button>
 </div>
 </div>
 <table className="backup-table" style={{ marginTop: 12 }}>
 <thead>
 <tr>
 <th>Snapshot ID</th>
 <th>Captured Timestamp</th>
 <th>{showHistoryView.topic.charAt(0).toUpperCase() + showHistoryView.topic.slice(1)} Metrics</th>
 </tr>
 </thead>
 <tbody>
 {topicHistory.length > 0 ? (
 topicHistory.map((row) => (
 <tr key={row.id}>
 <td>{row.id}</td>
 <td>{new Date(row.capturedAt).toLocaleString()}</td>
 <td>
 <pre style={{ maxWidth: 700, maxHeight: 220, overflow: 'auto', margin: 0 }}>{JSON.stringify(row.value, null, 2)}</pre>
 </td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan={3}>No history data found for selected range.</td>
 </tr>
 )}
 </tbody>
 </table>
 <div className="history-pagination">
 <button
 type="button"
 disabled={!canGoPrev || historyLoading}
 onClick={() => showHistoryView.topic && void loadTopicHistory(showHistoryView.topic, Math.max(0, historyOffset - historyLimit))}
 >
 Previous
 </button>
 <span>
 Showing {topicHistory.length === 0 ? 0 : historyOffset + 1}-{historyOffset + topicHistory.length} of {historyTotal}
 </span>
 <button
 type="button"
 disabled={!canGoNext || historyLoading}
 onClick={() => showHistoryView.topic && void loadTopicHistory(showHistoryView.topic, historyOffset + historyLimit)}
 >
 Next
 </button>
 </div>
 </section>
 )}

 {selectedTopic === 'health' && !showHistoryView.topic && (
 <MetricCard title="Instance Health Overview" titleProps={{ title: 'SQL Server uptime, version, and start time.' }}>
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('health')}>History View</button>
 <table className="backup-table compact-table">
 <tbody>
 {healthRows.map((row) => (
 <tr key={row.label}>
 <th>{row.label}</th>
 <td>{row.value}</td>
 </tr>
 ))}
 </tbody>
 </table>
 <div className="metric-bars" aria-label="Health Signals">
 <h4>Operational Health Indicators</h4>
 <MiniBarChart
 data={[
 { label: 'Uptime', value: toNumber(health.uptimeMinutes), suffix: ' min' },
 { label: 'CPU', value: toNumber(health.cpuUsagePercent), suffix: ' %' },
 { label: 'Memory', value: memoryUsedPercent, suffix: ' %' },
 { label: 'Active Sessions', value: sessions.length },
 { label: 'Blocking Requests', value: blocking.length }
 ]}
 height={160}
 color={["#1c7c54", "#d95d39", "#f2c14e", "#38618c"]}
 />
 </div>
 </MetricCard>
 )}

 {selectedTopic === 'cpuMemory' && !showHistoryView.topic && (
 <MetricCard title="Host Resource Utilization" titleProps={{ title: 'Current host utilization metrics.' }}>
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('cpuMemory')}>History View</button>
 <div className="metric-bars" aria-label="CPU and Memory Utilization">
 <h4>Host Resource Summary</h4>
 <MiniBarChart
 data={[
 { label: 'CPU Utilization', value: toNumber(health.cpuUsagePercent), suffix: ' %' },
 { label: 'Memory Utilization', value: memoryUsedPercent, suffix: ' %' },
 { label: 'Memory Free', value: toNumber(memory?.free), suffix: ' B' }
 ]}
 height={160}
 color={["#d95d39", "#1c7c54", "#38618c"]}
 />
 </div>
 <table className="backup-table compact-table">
 <thead>
 <tr>
 <th>Metric</th>
 <th>Value</th>
 </tr>
 </thead>
 <tbody>
 <tr>
 <td>CPU Utilization</td>
 <td>{formatNumber(health.cpuUsagePercent)}%</td>
 </tr>
 <tr>
 <td>Total Memory</td>
 <td>{memory ? formatBytes(memory.total) : '-'}</td>
 </tr>
 <tr>
 <td>Used Memory</td>
 <td>{memory ? formatBytes(memory.used) : '-'}</td>
 </tr>
 <tr>
 <td>Free Memory</td>
 <td>{memory ? formatBytes(memory.free) : '-'}</td>
 </tr>
 <tr>
 <td>Memory Utilization</td>
 <td>{memoryUsedPercent}%</td>
 </tr>
 </tbody>
 </table>

 <div className="snapshot-actions" style={{ marginTop: 10 }}>
 <button type="button" onClick={() => setShowProcessUtilization((current) => !current)}>
 {showProcessUtilization ? 'Hide Process-Level Resource Details' : 'Show Process-Level Resource Details'}
 </button>
 </div>

 {showProcessUtilization && (
 <Fragment>
 <div className="metric-bars" aria-label="Top Process CPU" style={{ marginTop: 10 }}>
 <h4>Top SQL Session CPU Consumers</h4>
 <MiniBarChart data={processCpuBars} height={160} color={["#d95d39", "#38618c"]} />
 </div>
 <div className="metric-bars" aria-label="Top Process Memory">
 <h4>Top SQL Session Memory Consumers</h4>
 <MiniBarChart data={processMemoryBars} height={160} color={["#1c7c54", "#f2c14e"]} />
 </div>
 <div className="metric-bars" aria-label="Top OS Process CPU">
 <h4>Top OS Process CPU Consumers</h4>
 <MiniBarChart data={osProcessCpuBars} height={160} color={["#38618c", "#f2c14e"]} />
 </div>
 <div className="metric-bars" aria-label="Top OS Process Memory">
 <h4>Top OS Process Memory Consumers</h4>
 <MiniBarChart data={osProcessMemoryBars} height={160} color={["#1c7c54", "#d95d39"]} />
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Session ID</th>
 <th>Application Name</th>
 <th>Host Name</th>
 <th>Login Name</th>
 <th>CPU Time (ms)</th>
 <th>Memory Usage (MB)</th>
 <th>Elapsed Time (ms)</th>
 <th>Database Name</th>
 </tr>
 </thead>
 <tbody>
 {processUtilization.length > 0 ? processUtilization.map((row) => (
 <tr key={`${row.session_id}-${row.program_name}-${row.host_name}`}>
 <td>{formatNumber(row.session_id)}</td>
 <td title={String(row.program_name ?? '')}>{shortText(row.program_name, 28)}</td>
 <td title={String(row.host_name ?? '')}>{shortText(row.host_name, 18)}</td>
 <td title={String(row.login_name ?? '')}>{shortText(row.login_name, 18)}</td>
 <td>{formatNumber(row.cpu_time_ms)}</td>
 <td>{formatNumber(row.memory_mb)}</td>
 <td>{formatNumber(row.elapsed_ms)}</td>
 <td>{String(row.database_name ?? '-')}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={8}>No process-level utilization metrics returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 <div className="metric-scroll" style={{ marginTop: 8 }}>
 <table className="backup-table">
 <thead>
 <tr>
 <th>PID</th>
 <th>Process Name</th>
 <th>CPU (%)</th>
 <th>Memory (MB)</th>
 <th>Memory (%)</th>
 <th>State</th>
 <th>Command</th>
 </tr>
 </thead>
 <tbody>
 {osProcessUtilization.length > 0 ? osProcessUtilization.map((row) => (
 <tr key={`${row.pid}-${String(row.name ?? '')}`}>
 <td>{formatNumber(row.pid)}</td>
 <td title={String(row.name ?? '')}>{shortText(row.name, 30)}</td>
 <td>{toNumber(row.cpu_percent).toFixed(2)}</td>
 <td>{formatNumber(row.memory_mb)}</td>
 <td>{toNumber(row.memory_percent).toFixed(2)}</td>
 <td>{String(row.state ?? '-')}</td>
 <td title={String(row.command ?? '')}>{shortText(row.command, 70)}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={7}>No OS process utilization metrics returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </Fragment>
 )}
 </MetricCard>
 )}

 {selectedTopic === 'performance' && !showHistoryView.topic && (
 <MetricCard title="Wait Statistics & Request Performance" titleProps={{ title: 'Top waits and active requests.' }}>
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('performance')}>History View</button>
 <div className="metric-bars" aria-label="Top Wait Time">
 <h4>Top Wait Categories by Duration</h4>
 <MiniBarChart data={waitBars} height={180} color={["#38618c", "#f2c14e"]} />
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Wait Category</th>
 <th>Total Wait Time (ms)</th>
 <th>Waiting Tasks</th>
 <th>Average Wait (ms)</th>
 </tr>
 </thead>
 <tbody>
 {waits.length > 0 ? waits.slice(0, 12).map((row) => (
 <tr key={`${row.wait_type}-${row.wait_time_ms}`}>
 <td title={String(row.wait_type ?? '')}>{shortText(row.wait_type, 30)}</td>
 <td>{formatNumber(row.wait_time_ms)}</td>
 <td>{formatNumber(row.waiting_tasks_count)}</td>
 <td>{formatNumber(row.avg_wait_ms)}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={4}>No wait statistics returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 <div className="metric-scroll" style={{ marginTop: 8 }}>
 <table className="backup-table">
 <thead>
 <tr>
 <th>Session ID</th>
 <th>Database Name</th>
 <th>CPU Time (ms)</th>
 <th>Elapsed Time (ms)</th>
 <th>SQL Text</th>
 </tr>
 </thead>
 <tbody>
 {activeRequests.length > 0 ? activeRequests.slice(0, 10).map((row) => (
 <tr key={`${row.session_id}-${row.total_elapsed_time}`}>
 <td>{formatNumber(row.session_id)}</td>
 <td>{String(row.database_name ?? '-')}</td>
 <td>{formatNumber(row.cpu_time)}</td>
 <td>{formatNumber(row.total_elapsed_time)}</td>
 <td title={String(row.sql_text ?? '')}>
 {shortText(row.sql_text, 60)}
 {String(row.sql_text ?? '') && (
 <button
 style={{ marginLeft: 8 }}
 onClick={() => void handleCopyText(`${row.session_id}-${row.total_elapsed_time}-sql`, String(row.sql_text ?? ''))}
 >
 {copiedKey === `${row.session_id}-${row.total_elapsed_time}-sql` ? 'Copied' : 'Copy'}
 </button>
 )}
 </td>
 </tr>
 )) : (
 <tr>
 <td colSpan={5}>No currently active requests</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </MetricCard>
 )}

 {selectedTopic === 'storage' && !showHistoryView.topic && (
 <MetricCard title="Database Storage Capacity" titleProps={{ title: 'Database file size and tempdb utilization.' }}>
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('storage')}>History View</button>
 <div className="metric-bars" aria-label="Drive Space Usage">
 <h4>Drive Capacity Utilization</h4>
 <MiniBarChart data={driveBars} height={180} color={["#d95d39", "#f2c14e", "#1c7c54"]} />
 </div>
 <div className="metric-scroll" style={{ marginBottom: 8 }}>
 <table className="backup-table">
 <thead>
 <tr>
 <th>Drive Letter</th>
 <th>Drive Type</th>
 <th>Total Size</th>
 <th>Used Space</th>
 <th>Free Space</th>
 <th>Percent Used</th>
 </tr>
 </thead>
 <tbody>
 {drives.length > 0 ? drives.map((row) => {
 const size = toNumber(row.size);
 const used = toNumber(row.used);
 const free = toNumber(row.available);
 const usedPercent = size > 0 ? ((used / size) * 100) : 0;
 return (
 <tr key={`${row.name}-${row.type}-${size}`}>
 <td>{String(row.name ?? '-')}</td>
 <td>{String(row.type ?? '-')}</td>
 <td>{formatBytes(size)}</td>
 <td>{formatBytes(used)}</td>
 <td>{formatBytes(free)}</td>
 <td>{usedPercent.toFixed(2)}%</td>
 </tr>
 );
 }) : (
 <tr>
 <td colSpan={6}>No drive capacity metrics returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 <div className="metric-bars" aria-label="Top Databases by Size">
 <h4>Largest Databases by Allocated Size</h4>
 <MiniBarChart data={storageBars} height={180} color={["#1c7c54", "#f2c14e", "#38618c"]} />
 </div>
 <div className="metric-scroll" style={{ marginTop: 8, marginBottom: 8 }}>
 <table className="backup-table">
 <thead>
 <tr>
 <th>Database Name</th>
 <th>Total Allocated Size (MB)</th>
 </tr>
 </thead>
 <tbody>
 {Object.entries(fileSizeByDb).length > 0 ? Object.entries(fileSizeByDb)
 .sort((left, right) => right[1] - left[1])
 .map(([dbName, totalSizeMb]) => (
 <tr key={dbName}>
 <td>{dbName}</td>
 <td>{formatNumber(totalSizeMb)}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={2}>No per-database size metrics returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 <table className="backup-table compact-table" style={{ marginTop: 8 }}>
 <thead>
 <tr>
 <th>Database Count</th>
 <th>Total Allocated Size (MB)</th>
 <th>Total Used Space (MB)</th>
 <th>Total Free Space (MB)</th>
 </tr>
 </thead>
 <tbody>
 <tr>
 <td>{formatNumber(Object.keys(fileSizeByDb).length)}</td>
 <td>{formatNumber(storageTotals.allocatedMb)}</td>
 <td>{formatNumber(storageTotals.usedMb)}</td>
 <td>{formatNumber(storageTotals.freeMb)}</td>
 </tr>
 </tbody>
 </table>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Database Name</th>
 <th>Database Total Size (MB)</th>
 <th>File Type</th>
 <th>Logical File Name</th>
 <th>File Size (MB)</th>
 <th>Used Space (MB)</th>
 <th>Free Space (MB)</th>
 </tr>
 </thead>
 <tbody>
 {files.length > 0 ? files.slice(0, 20).map((row) => (
 <tr key={`${row.database_name}-${row.logical_name}-${row.type_desc}`}>
 <td>{String(row.database_name ?? '-')}</td>
 <td>{formatNumber(fileSizeByDb[String(row.database_name ?? '(unknown)')] ?? 0)}</td>
 <td>{String(row.type_desc ?? '-')}</td>
 <td title={String(row.logical_name ?? '')}>{shortText(row.logical_name, 24)}</td>
 <td>{formatNumber(row.file_size_mb)}</td>
 <td>{formatNumber(row.used_mb)}</td>
 <td>{formatNumber(row.free_mb)}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={7}>No database file metrics returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 {tempdb && (
 <table className="backup-table compact-table" style={{ marginTop: 8 }}>
 <thead>
 <tr>
 <th>TempDB User MB</th>
 <th>TempDB Internal MB</th>
 <th>Version Store MB</th>
 <th>Free MB</th>
 </tr>
 </thead>
 <tbody>
 <tr>
 <td>{formatNumber(tempdb.user_object_mb)}</td>
 <td>{formatNumber(tempdb.internal_object_mb)}</td>
 <td>{formatNumber(tempdb.version_store_mb)}</td>
 <td>{formatNumber(tempdb.free_space_mb)}</td>
 </tr>
 </tbody>
 </table>
 )}
 </MetricCard>
 )}

 {selectedTopic === 'sessions' && !showHistoryView.topic && (
 <MetricCard title="Session Activity & Control" titleProps={{ title: 'Session count by host and application.' }}>
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('sessions')}>History View</button>
 <div className="metric-bars" aria-label="Session Distribution">
 <h4>Session Distribution by Workload Source</h4>
 <MiniBarChart data={sessionBars} height={180} color={["#38618c", "#1c7c54"]} />
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Session ID</th>
 <th>Host Name</th>
 <th>Application Name</th>
 <th>Session Status</th>
 <th>Database Name</th>
 <th>Action</th>
 </tr>
 </thead>
 <tbody>
 {sessions.length > 0 ? sessions.map((row) => (
 <tr key={`${row.session_id}-${row.host_name}-${row.program_name}`}>
 {(() => {
 const sessionId = toNumber(row.session_id);
 const isProtectedSession = sessionId <= 50;
 const isKilling = killingSessionId === sessionId;
 return (
 <Fragment>
 <td>{formatNumber(row.session_id)}</td>
 <td title={String(row.host_name ?? '')}>{shortText(row.host_name, 22)}</td>
 <td title={String(row.program_name ?? '')}>{shortText(row.program_name, 34)}</td>
 <td>{String(row.status ?? '-')}</td>
 <td>{String(row.database_name ?? '-')}</td>
 <td>
 <button
 type="button"
 onClick={() => void handleKillSession(sessionId)}
 disabled={isKilling || !selectedTargetId || isProtectedSession}
 style={{ color: '#b42318' }}
 title={isProtectedSession ? 'Protected system session' : `Kill session ${sessionId}`}
 >
 {isProtectedSession ? 'Protected' : isKilling ? 'Killing...' : 'KILL'}
 </button>
 </td>
 </Fragment>
 );
 })()}
 </tr>
 )) : (
 <tr>
 <td colSpan={6}>No active session metadata returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </MetricCard>
 )}

 {selectedTopic === 'queries' && !showHistoryView.topic && (
 <MetricCard title="Query Performance Analysis" titleProps={{ title: 'Top queries by elapsed time.' }}>
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('queries')}>History View</button>
 <div className="metric-bars" aria-label="Average Elapsed Time">
 <h4>Average Elapsed Time by Query Pattern</h4>
 <MiniBarChart data={queryBars} height={180} color={["#d95d39", "#38618c"]} />
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Execution Count</th>
 <th>Average Elapsed (ms)</th>
 <th>Total Logical Reads</th>
 <th>Query Text</th>
 </tr>
 </thead>
 <tbody>
 {queries.length > 0 ? queries.map((row, index) => (
 <tr key={`${row.query_text}-${index}`}>
 <td>{formatNumber(row.execution_count)}</td>
 <td>{formatNumber(row.avg_elapsed_ms)}</td>
 <td>{formatNumber(row.total_logical_reads)}</td>
 <td title={String(row.query_text ?? '')}>
 {shortText(row.query_text, 80)}
 {String(row.query_text ?? '') && (
 <button
 style={{ marginLeft: 8 }}
 onClick={() => void handleCopyText(`query-${index}`, String(row.query_text ?? ''))}
 >
 {copiedKey === `query-${index}` ? 'Copied' : 'Copy'}
 </button>
 )}
 </td>
 </tr>
 )) : (
 <tr>
 <td colSpan={4}>No query performance statistics returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>

 {showLongRunningQueryWindow && (
 <section className="backup-window backup-window-secondary" style={{ marginTop: 10 }}>
 <div className="backup-window-header">
 <div>
 <h4>Long Running Queries (Detailed Window)</h4>
 <p>
 Showing queries with average elapsed time greater than or equal to 5,000 ms.
 </p>
 </div>
 <div className="snapshot-actions" style={{ justifyContent: 'flex-end' }}>
 <button
 type="button"
 onClick={() => setLongRunningSortKey('running')}
 className={longRunningSortKey === 'running' ? 'btn-on' : 'btn-off'}
 >
 Sort: Running Time
 </button>
 <button
 type="button"
 onClick={() => setLongRunningSortKey('start')}
 className={longRunningSortKey === 'start' ? 'btn-on' : 'btn-off'}
 >
 Sort: Start Time
 </button>
 <button
 type="button"
 onClick={() => setLongRunningSortKey('session')}
 className={longRunningSortKey === 'session' ? 'btn-on' : 'btn-off'}
 >
 Sort: Session ID
 </button>
 <button
 type="button"
 className={longRunningSortOrder === 'asc' ? 'btn-on' : 'btn-off'}
 onClick={() => setLongRunningSortOrder((current) => current === 'asc' ? 'desc' : 'asc')}
 >
 Order: {longRunningSortOrder.toUpperCase()}
 </button>
 <button type="button" onClick={() => setShowLongRunningQueryWindow(false)}>
 Close Window
 </button>
 </div>
 </div>
 <div className="metric-scroll" style={{ maxHeight: 300 }}>
 <table className="backup-table">
 <thead>
 <tr>
 <th>Session ID</th>
 <th>Program Name</th>
 <th>User / Login</th>
 <th>Host Name</th>
 <th>Start Time</th>
 <th>Running Duration</th>
 <th>Query Text (Full)</th>
 </tr>
 </thead>
 <tbody>
 {longRunningQueries.length > 0 ? longRunningQueries.map((row, index) => (
 <tr key={`long-running-${index}-${row.sessionId}`}>
 <td>{row.sessionId}</td>
 <td title={row.programName}>{shortText(row.programName, 28)}</td>
 <td title={row.loginName}>{shortText(row.loginName, 24)}</td>
 <td title={row.hostName}>{shortText(row.hostName, 24)}</td>
 <td>{row.startTime}</td>
 <td>{row.runningFor}</td>
 <td>
 <pre className="snapshot-json" style={{ marginTop: 0, maxHeight: 180 }}>
 {row.queryText}
 </pre>
 {row.queryText && row.queryText !== '-' && (
 <button
 style={{ marginTop: 6 }}
 onClick={() => void handleCopyText(`long-running-${index}`, row.queryText)}
 >
 {copiedKey === `long-running-${index}` ? 'Copied' : 'Copy Full Query'}
 </button>
 )}
 </td>
 </tr>
 )) : (
 <tr>
 <td colSpan={7}>No long running queries found for current dataset.</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </section>
 )}
 <div className="snapshot-actions" style={{ marginTop: 10 }}>
 <button
 type="button"
 onClick={() => setShowLongRunningQueryWindow((current) => !current)}
 >
 {showLongRunningQueryWindow ? 'Hide Long Running Window' : `Open Long Running Window (${longRunningQueries.length})`}
 </button>
 <span style={{ alignSelf: 'center', fontSize: 12, opacity: 0.85 }}>
 Threshold: Avg elapsed &gt;= 5,000 ms
 </span>
 </div>
 </MetricCard>
 )}

 {selectedTopic === 'alerts' && !showHistoryView.topic && (
 <MetricCard title="Operational Alerts & Incidents" titleProps={{ title: 'Blocking chains and failed SQL Agent jobs.' }}>
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('alerts')}>History View</button>
 <div className="alert-overview">
 <span className={String(alerts.severity) === 'high' ? 'backup-stale' : 'backup-ok'}>
 Severity: {String(alerts.severity ?? 'normal').toUpperCase()}
 </span>
 <span>Blocking: {blocking.length}</span>
 <span>Failed Jobs: {failedJobs.length}</span>
 </div>
 <div className="metric-bars" aria-label="Blocking Wait Time">
 <h4>Blocking Duration by Session</h4>
 <MiniBarChart
 data={blocking.slice(0, 8).map((row) => ({
 label: `SPID ${String(row.session_id ?? '-')}`,
 value: toNumber(row.wait_time),
 suffix: ' ms'
 }))}
 height={120}
 color={["#d95d39", "#38618c"]}
 />
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Session ID</th>
 <th>Blocked By (Session ID)</th>
 <th>Session Status</th>
 <th>Wait Category</th>
 <th>Wait Time (ms)</th>
 </tr>
 </thead>
 <tbody>
 {blocking.length > 0 ? blocking.map((row) => (
 <tr key={`${row.session_id}-${row.blocking_session_id}-${row.wait_time}`}>
 <td>{formatNumber(row.session_id)}</td>
 <td>{formatNumber(row.blocking_session_id)}</td>
 <td>{String(row.status ?? '-')}</td>
 <td>{String(row.wait_type ?? '-')}</td>
 <td>{formatNumber(row.wait_time)}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={5}>No active blocking chains detected</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 <div className="metric-scroll" style={{ marginTop: 8 }}>
 <table className="backup-table">
 <thead>
 <tr>
 <th>SQL Agent Job Name</th>
 <th>Run Date</th>
 <th>Run Time</th>
 <th>Error Message</th>
 </tr>
 </thead>
 <tbody>
 {failedJobs.length > 0 ? failedJobs.map((row) => (
 <tr key={`${row.job_name}-${row.run_date}-${row.run_time}`}>
 <td>{String(row.job_name ?? '-')}</td>
 <td>{String(row.run_date ?? '-')}</td>
 <td>{String(row.run_time ?? '-')}</td>
 <td title={String(row.error_message ?? '')}>{shortText(row.error_message, 110)}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={4}>No failed SQL Agent jobs detected</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </MetricCard>
 )}

 {selectedTopic === 'backups' && !showHistoryView.topic && (
 <MetricCard title="Backup Compliance Status">
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('backups')}>History View</button>
 <div className="backup-pane-layout">
 <section className="backup-window">
 <div className="backup-window-header">
 <div>
 <h4>Databases with Backup Policy Violations</h4>
 <p>{failedBackups.length} failed database backup{failedBackups.length === 1 ? '' : 's'} and {successfulBackups.length} successful database backup{successfulBackups.length === 1 ? '' : 's'}.</p>
 </div>
 <button type="button" onClick={() => setShowSuccessBackups(true)} disabled={showSuccessBackups || successfulBackups.length === 0}>
 Show Compliant Backup Details
 </button>
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Database Name</th>
 <th>Last Full Backup</th>
 <th>Last Differential Backup</th>
 <th>Last Log Backup</th>
 </tr>
 </thead>
 <tbody>
 {data.backups.length > 0 ? failedBackups.map((row) => (
 <tr key={row.database_name}>
 <td>{row.database_name}</td>
 <td className={getBackupStatusClass(row.last_full_backup, 'full')} title={getBackupStalenessTooltip(row.last_full_backup)}>{row.last_full_backup ? new Date(row.last_full_backup).toLocaleString() : '-'}</td>
 <td className={getBackupStatusClass(row.last_diff_backup, 'diff')} title={getBackupStalenessTooltip(row.last_diff_backup)}>{row.last_diff_backup ? new Date(row.last_diff_backup).toLocaleString() : '-'}</td>
 <td className={getBackupStatusClass(row.last_log_backup, 'log')} title={getBackupStalenessTooltip(row.last_log_backup)}>{row.last_log_backup ? new Date(row.last_log_backup).toLocaleString() : '-'}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={4}>No backup metadata returned</td>
 </tr>
 )}
 {data.backups.length > 0 && failedBackups.length === 0 && (
 <tr>
 <td colSpan={4}>No backup policy violations detected</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </section>

 {showSuccessBackups && (
 <section className="backup-window backup-window-secondary">
 <div className="backup-window-header">
 <div>
 <h4>Databases Meeting Backup Policy</h4>
 <p>{successfulBackups.length} databases with a recorded successful full backup.</p>
 </div>
 <button type="button" onClick={() => setShowSuccessBackups(false)}>
 Close Window
 </button>
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Database Name</th>
 <th>Last Full Backup</th>
 <th>Last Differential Backup</th>
 <th>Last Log Backup</th>
 </tr>
 </thead>
 <tbody>
 {successfulBackups.length > 0 ? successfulBackups.map((row) => (
 <tr key={row.database_name}>
 <td>{row.database_name}</td>
 <td className={getBackupStatusClass(row.last_full_backup, 'full')} title={getBackupStalenessTooltip(row.last_full_backup)}>{row.last_full_backup ? new Date(row.last_full_backup).toLocaleString() : '-'}</td>
 <td className={getBackupStatusClass(row.last_diff_backup, 'diff')} title={getBackupStalenessTooltip(row.last_diff_backup)}>{row.last_diff_backup ? new Date(row.last_diff_backup).toLocaleString() : '-'}</td>
 <td className={getBackupStatusClass(row.last_log_backup, 'log')} title={getBackupStalenessTooltip(row.last_log_backup)}>{row.last_log_backup ? new Date(row.last_log_backup).toLocaleString() : '-'}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={4}>No compliant backup entries found</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </section>
 )}
 </div>
 </MetricCard>
 )}
 {/* AI Mode topic removed */}

 {selectedTopic === 'ple' && !showHistoryView.topic && (
 <MetricCard title="Buffer Cache Page Life Expectancy" titleProps={{ title: 'PLE values by NUMA node and recent trend.' }}>
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('ple')}>History View</button>
 <div className="metric-bars" aria-label="PLE Trend">
 <h4>Recent PLE Trend (24h)</h4>
 <MiniBarChart data={pleHourlyBars} height={180} color={["#38618c", "#f2c14e"]} />
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>NUMA Node ID</th>
 <th>NUMA Node Name</th>
 <th>Page Life Expectancy (sec)</th>
 </tr>
 </thead>
 <tbody>
 {pleData.length > 0 ? pleData.map((row) => (
 <tr key={row.node_id}>
 <td>{row.node_id}</td>
 <td>{String((row as { node_name?: string }).node_name ?? '-')}</td>
 <td>{row.page_life_expectancy}</td>
 </tr>
 )) : (
 <tr>
 <td colSpan={3}>No PLE metrics returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </MetricCard>
 )}

 {selectedTopic === 'suggestions' && !showHistoryView.topic && (
 <>
 <MetricCard title="Missing Index Recommendations" titleProps={{ title: 'Indexes that should be created for better performance.' }}>
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('suggestions')}>History View</button>
 <div className="metric-bars" style={{ marginBottom: 16 }}>
 <MiniBarChart
 data={suggestionsData.missingIndexes.map((row, idx) => ({
 label: row.table_name || `Table ${idx + 1}`,
 value: Number(row.impact) || 0
 }))}
 height={180}
 color={["#d95d39", "#38618c"]}
 />
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Database Name</th>
 <th>Table Name</th>
 <th>Equality Columns</th>
 <th>Inequality Columns</th>
 <th>Included Columns</th>
 <th>Estimated Impact</th>
 <th>CREATE INDEX Statement</th>
 </tr>
 </thead>
 <tbody>
 {suggestionsData.missingIndexes.length > 0 ? suggestionsData.missingIndexes.map((row, idx) => (
 <tr key={idx}>
 <td>{row.database_name}</td>
 <td>{row.table_name}</td>
 <td>{row.equality_columns}</td>
 <td>{row.inequality_columns}</td>
 <td>{row.included_columns}</td>
 <td>{row.impact}</td>
 <td>
 <code style={{ fontSize: '0.85em' }}>{row.create_statement}</code>
 <button style={{ marginLeft: 8 }} onClick={() => void handleCopyText(`create-${idx}`, String(row.create_statement ?? ''))}>
 {copiedKey === `create-${idx}` ? 'Copied' : 'Copy'}
 </button>
 </td>
 </tr>
 )) : (
 <tr>
 <td colSpan={7}>No missing index recommendations returned</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </MetricCard>
 <MetricCard title="Fragmented Indexes (>20%)" titleProps={{ title: 'Indexes with high fragmentation that should be rebuilt.' }}>
 <div className="metric-bars" style={{ marginBottom: 16 }}>
 <MiniBarChart
 data={suggestionsData.fragmentedIndexes.map((row, idx) => ({
 label: row.index_name || `Index ${idx + 1}`,
 value: Number(row.avg_fragmentation_in_percent) || 0
 }))}
 height={180}
 color={["#f2c14e", "#d95d39"]}
 />
 </div>
 <div className="metric-scroll">
 <table className="backup-table">
 <thead>
 <tr>
 <th>Database Name</th>
 <th>Table Name</th>
 <th>Index Name</th>
 <th>Fragmentation (%)</th>
 <th>ALTER INDEX Statement</th>
 </tr>
 </thead>
 <tbody>
 {suggestionsData.fragmentedIndexes.length > 0 ? suggestionsData.fragmentedIndexes.map((row, idx) => (
 <tr key={idx}>
 <td>{row.database_name}</td>
 <td>{row.table_name}</td>
 <td>{row.index_name}</td>
 <td>{row.avg_fragmentation_in_percent}</td>
 <td>
 <code style={{ fontSize: '0.85em' }}>{row.alter_statement}</code>
 <button style={{ marginLeft: 8 }} onClick={() => void handleCopyText(`alter-${idx}`, String(row.alter_statement ?? ''))}>
 {copiedKey === `alter-${idx}` ? 'Copied' : 'Copy'}
 </button>
 </td>
 </tr>
 )) : (
 <tr>
 <td colSpan={5}>No indexes above 20% fragmentation threshold</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </MetricCard>
 </>
 )}

 {/* AI Mode panel removed */}

 {selectedTopic === 'history' && !showHistoryView.topic && (
 <section className="ai-panel" style={{ marginTop: 0 }}>
 <div className="ai-title-row">
 <h2>Monitoring Snapshot Audit Trail</h2>
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
 <label className="target-checkbox" style={{ marginLeft: 8 }}>
 <input
 type="checkbox"
 checked={historyAuditOnly}
 onChange={(e) => {
 setHistoryAuditOnly(e.target.checked);
 if (!e.target.checked) {
 setHistoryAuditOutcome('all');
 }
 }}
 />
 Session Kill Audit Only
 </label>
 </div>
 <div className="snapshot-actions" style={{ marginTop: 8 }}>
 <button
 type="button"
 onClick={() => {
 setHistoryAuditOnly(true);
 setHistoryAuditOutcome('all');
 }}
 disabled={historyLoading}
 style={{ fontWeight: historyAuditOnly && historyAuditOutcome === 'all' ? 700 : 400 }}
 >
 All Outcomes
 </button>
 <button
 type="button"
 onClick={() => {
 setHistoryAuditOnly(true);
 setHistoryAuditOutcome('attempted');
 }}
 disabled={historyLoading}
 style={{ fontWeight: historyAuditOnly && historyAuditOutcome === 'attempted' ? 700 : 400 }}
 >
 Attempted Outcomes
 </button>
 <button
 type="button"
 onClick={() => {
 setHistoryAuditOnly(true);
 setHistoryAuditOutcome('succeeded');
 }}
 disabled={historyLoading}
 style={{ fontWeight: historyAuditOnly && historyAuditOutcome === 'succeeded' ? 700 : 400 }}
 >
 Successful Outcomes
 </button>
 <button
 type="button"
 onClick={() => {
 setHistoryAuditOnly(true);
 setHistoryAuditOutcome('failed');
 }}
 disabled={historyLoading}
 style={{ fontWeight: historyAuditOnly && historyAuditOutcome === 'failed' ? 700 : 400 }}
 >
 Failed Outcomes
 </button>
 </div>
 <table className="backup-table" style={{ marginTop: 12 }}>
 <thead>
 <tr>
 <th>Snapshot ID</th>
 <th>Captured Timestamp</th>
 <th>Target</th>
 <th>Event</th>
 <th>Health Summary</th>
 <th>Alert Summary</th>
 <th>Details</th>
 </tr>
 </thead>
 <tbody>
 {historyRows.length > 0 ? (
 historyRows.map((row) => (
 <Fragment key={row.id}>
 <tr>
 <td>{row.id}</td>
 <td>{new Date(row.capturedAt).toLocaleString()}</td>
 <td>{row.targetId}</td>
 <td><span className={getHistoryEventClassName(row)}>{formatHistoryEvent(row)}</span></td>
 <td title={JSON.stringify(row.health)}>{JSON.stringify(row.health).slice(0, 80)}{JSON.stringify(row.health).length > 80 ? 'ΓÇª' : ''}</td>
 <td title={JSON.stringify(row.alerts)}>{JSON.stringify(row.alerts).slice(0, 80)}{JSON.stringify(row.alerts).length > 80 ? 'ΓÇª' : ''}</td>
 <td>
 <button type="button" onClick={() => setExpandedSnapshotId((current) => current === row.id ? null : row.id)}>
 {expandedSnapshotId === row.id ? 'Hide' : 'View'}
 </button>
 </td>
 </tr>
 {expandedSnapshotId === row.id && (
 <tr>
 <td colSpan={7}>
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
 <td colSpan={7}>{historyAuditOnly ? 'No session-kill audit events found for the selected outcome' : 'No snapshots found'}</td>
 </tr>
 )}
 </tbody>
 </table>
 <div className="history-pagination">
 <button type="button" disabled={!canGoPrev || historyLoading} onClick={() => void loadSnapshotHistory(Math.max(0, historyOffset - historyLimit))}>Previous</button>
 <span>
 Showing {historyRows.length === 0 ? 0 : historyOffset + 1}-{historyOffset + historyRows.length} of {historyTotal}{historyAuditOnly ? ` (filtered: ${historyRows.length}${historyAuditOutcome !== 'all' ? `, outcome: ${historyAuditOutcome}` : ''})` : ''}
 </span>
 <button type="button" disabled={!canGoNext || historyLoading} onClick={() => void loadSnapshotHistory(historyOffset + historyLimit)}>Next</button>
 </div>
 </section>
 )}
 {selectedTopic === 'security' && !showHistoryView.topic && (
 <section className="ai-panel">
 <button className="history-btn" style={{ position: 'absolute', top: 16, right: 24, zIndex: 2 }} onClick={() => openHistoryView('security')}>History View</button>
 <div className="panel-title-row">
 <h2>Security &amp; Access Control</h2>
 <button onClick={() => {
 if (selectedTargetId) {
 void loadSecurityForTarget(selectedTargetId);
 }
 }} disabled={securityLoading}>
 {securityLoading ? 'LoadingΓÇª' : 'Refresh Security Data'}
 </button>
 </div>
 {securityLoading && <p>Loading security dataΓÇª</p>}
 {!securityLoading && !securityData && <p>Security data unavailable. Click Refresh to load.</p>}
 {securityData && (
 <>
 <h3 style={{ marginTop: 16 }}>SQL Server Logins</h3>
 <div className="metric-scroll">
 <table className="backup-table compact-table">
 <thead>
 <tr>
 <th>Login Name</th>
 <th>Login Type</th>
 <th>Status</th>
 <th>Password Policy</th>
 <th>Password Expiration</th>
 <th>Default Database</th>
 <th>Server Roles</th>
 <th>Created</th>
 <th>Last Modified</th>
 </tr>
 </thead>
 <tbody>
 {securityData.serverLogins.length > 0 ? securityData.serverLogins.map((row, idx) => (
 <tr key={idx}>
 <td>{row.login_name}</td>
 <td>{row.login_type.replace(/_/g, ' ')}</td>
 <td><span className={row.is_disabled ? 'status-warn' : 'status-ok'}>{row.is_disabled ? 'Disabled' : 'Enabled'}</span></td>
 <td>{row.is_policy_checked ? 'Enforced' : 'Not Enforced'}</td>
 <td>{row.is_expiration_checked ? 'Enforced' : 'Not Enforced'}</td>
 <td>{row.default_database}</td>
 <td>{row.server_roles || '(none)'}</td>
 <td>{row.create_date}</td>
 <td>{row.modify_date}</td>
 </tr>
 )) : (
 <tr><td colSpan={9}>No SQL Server logins found</td></tr>
 )}
 </tbody>
 </table>
 </div>

 <h3 style={{ marginTop: 20 }}>Server-Level Role Memberships</h3>
 <div className="metric-scroll">
 <table className="backup-table compact-table">
 <thead>
 <tr>
 <th>Server Role</th>
 <th>Member Login</th>
 <th>Member Type</th>
 <th>Member Status</th>
 </tr>
 </thead>
 <tbody>
 {securityData.serverRoles.length > 0 ? securityData.serverRoles.map((row, idx) => (
 <tr key={idx}>
 <td>{row.role_name}</td>
 <td>{row.member_name}</td>
 <td>{row.member_type.replace(/_/g, ' ')}</td>
 <td><span className={row.is_member_disabled ? 'status-warn' : 'status-ok'}>{row.is_member_disabled ? 'Disabled' : 'Active'}</span></td>
 </tr>
 )) : (
 <tr><td colSpan={4}>No server role memberships found</td></tr>
 )}
 </tbody>
 </table>
 </div>

 <h3 style={{ marginTop: 20 }}>Database Users</h3>
 <div className="metric-scroll">
 <table className="backup-table compact-table">
 <thead>
 <tr>
 <th>Database Name</th>
 <th>User Name</th>
 <th>User Type</th>
 <th>Mapped Login</th>
 <th>Default Schema</th>
 <th>Database Roles</th>
 <th>Created</th>
 </tr>
 </thead>
 <tbody>
 {securityData.dbUsers.length > 0 ? securityData.dbUsers.map((row, idx) => (
 <tr key={idx}>
 <td>{row.database_name}</td>
 <td>{row.user_name}</td>
 <td>{row.user_type.replace(/_/g, ' ')}</td>
 <td>{row.login_name || '(none)'}</td>
 <td>{row.default_schema}</td>
 <td>{row.db_roles || '(none)'}</td>
 <td>{row.create_date}</td>
 </tr>
 )) : (
 <tr><td colSpan={7}>No database users found</td></tr>
 )}
 </tbody>
 </table>
 </div>

 <h3 style={{ marginTop: 20 }}>Database-Level Role Memberships</h3>
 <div className="metric-scroll">
 <table className="backup-table compact-table">
 <thead>
 <tr>
 <th>Database Name</th>
 <th>Database Role</th>
 <th>Member Name</th>
 <th>Member Type</th>
 </tr>
 </thead>
 <tbody>
 {securityData.dbRoles.length > 0 ? securityData.dbRoles.map((row, idx) => (
 <tr key={idx}>
 <td>{row.database_name}</td>
 <td>{row.role_name}</td>
 <td>{row.member_name}</td>
 <td>{row.member_type.replace(/_/g, ' ')}</td>
 </tr>
 )) : (
 <tr><td colSpan={4}>No database role memberships found</td></tr>
 )}
 </tbody>
 </table>
 </div>

 <h3 style={{ marginTop: 20 }}>Explicit Object Permissions</h3>
 <div className="metric-scroll">
 <table className="backup-table compact-table">
 <thead>
 <tr>
 <th>Database Name</th>
 <th>Principal Name</th>
 <th>Principal Type</th>
 <th>Object Name</th>
 <th>Object Type</th>
 <th>Permission</th>
 <th>Grant State</th>
 </tr>
 </thead>
 <tbody>
 {securityData.objectPermissions.length > 0 ? securityData.objectPermissions.map((row, idx) => (
 <tr key={idx}>
 <td>{row.database_name}</td>
 <td>{row.principal_name}</td>
 <td>{row.principal_type.replace(/_/g, ' ')}</td>
 <td>{row.object_name || '(database)'}</td>
 <td>{row.object_type.replace(/_/g, ' ')}</td>
 <td>{row.permission_name}</td>
 <td><span className={row.permission_state === 'DENY' ? 'status-critical' : 'status-ok'}>{row.permission_state}</span></td>
 </tr>
 )) : (
 <tr><td colSpan={7}>No explicit object permissions found</td></tr>
 )}
 </tbody>
 </table>
 </div>
 </>
 )}
 </section>
 )}
 </div>
 </section>
 )}
 </main>
 );
};




