import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MetricCard } from './components/MetricCard';
import { MiniBarChart } from './components/MiniBarChart';
import { api } from './services/api';
const defaultConnectionFields = {
    server: '',
    port: '1433',
    database: 'master',
    userId: '',
    password: '',
    encrypt: false,
    trustServerCertificate: true
};
const initialState = {
    health: {},
    performance: {},
    storage: [],
    sessions: [],
    queries: [],
    alerts: {},
    backups: []
};
const toFormConnection = (target) => {
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
const toConnectionPayload = (fields) => ({
    server: fields.server.trim(),
    port: Number.parseInt(fields.port, 10) || 1433,
    database: fields.database.trim(),
    userId: fields.userId.trim(),
    password: fields.password,
    encrypt: fields.encrypt,
    trustServerCertificate: fields.trustServerCertificate
});
const sameConnectionWithoutPassword = (left, right) => {
    return (left.server.trim() === right.server.trim() &&
        left.port.trim() === right.port.trim() &&
        left.database.trim() === right.database.trim() &&
        left.userId.trim() === right.userId.trim() &&
        left.encrypt === right.encrypt &&
        left.trustServerCertificate === right.trustServerCertificate);
};
const getBackupStatusClass = (dateStr, type) => {
    if (!dateStr)
        return 'backup-missing';
    const dt = new Date(dateStr);
    if (isNaN(dt.getTime()))
        return 'backup-missing';
    const now = new Date();
    const diffHours = (now.getTime() - dt.getTime()) / (1000 * 60 * 60);
    if (type === 'full') {
        if (diffHours > 168)
            return 'backup-stale';
        if (diffHours > 48)
            return 'backup-warning';
        return 'backup-ok';
    }
    if (type === 'diff') {
        if (diffHours > 48)
            return 'backup-stale';
        if (diffHours > 24)
            return 'backup-warning';
        return 'backup-ok';
    }
    if (diffHours > 24)
        return 'backup-stale';
    if (diffHours > 4)
        return 'backup-warning';
    return 'backup-ok';
};
const getBackupStalenessTooltip = (dateStr) => {
    if (!dateStr)
        return 'No backup found';
    const dt = new Date(dateStr);
    if (isNaN(dt.getTime()))
        return 'Invalid date';
    const now = new Date();
    const diffMs = now.getTime() - dt.getTime();
    if (diffMs < 0)
        return 'Backup is in the future';
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) {
        return `${diffDays} day${diffDays === 1 ? '' : 's'} ago (${diffHours.toFixed(1)} hours)`;
    }
    return `${diffHours.toFixed(1)} hours ago`;
};
const isLooseRecord = (value) => typeof value === 'object' && value !== null;
const asLooseArray = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isLooseRecord);
};
const toNumber = (value) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
const formatNumber = (value) => {
    const parsed = toNumber(value);
    return parsed.toLocaleString();
};
const formatBytes = (value) => {
    const bytes = toNumber(value);
    if (bytes <= 0)
        return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
};
const shortText = (value, maxLength = 100) => {
    const text = String(value ?? '');
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};
export const App = () => {
    const [data, setData] = useState(initialState);
    const [targets, setTargets] = useState([]);
    const [selectedTargetId, setSelectedTargetId] = useState('');
    const [showTopicPane, setShowTopicPane] = useState(false);
    const [homeHealthByTargetId, setHomeHealthByTargetId] = useState({});
    const [homeHealthLoading, setHomeHealthLoading] = useState(false);
    const [monitoringStats, setMonitoringStats] = useState(null);
    const [formMode, setFormMode] = useState(null);
    const [formTargetName, setFormTargetName] = useState('');
    const [formConnection, setFormConnection] = useState(defaultConnectionFields);
    const [editBaselineConnection, setEditBaselineConnection] = useState(defaultConnectionFields);
    const [targetMessage, setTargetMessage] = useState('');
    const [loading, setLoading] = useState(false);
    // Removed AI mode state
    const [snapshotHistory, setSnapshotHistory] = useState([]);
    const [historyFrom, setHistoryFrom] = useState('');
    const [historyTo, setHistoryTo] = useState('');
    const [historyLimit, setHistoryLimit] = useState(25);
    const [historyOffset, setHistoryOffset] = useState(0);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyAuditOnly, setHistoryAuditOnly] = useState(false);
    const [historyAuditOutcome, setHistoryAuditOutcome] = useState('all');
    const [expandedSnapshotId, setExpandedSnapshotId] = useState(null);
    const [killingSessionId, setKillingSessionId] = useState(null);
    const [showProcessUtilization, setShowProcessUtilization] = useState(false);
    const [selectedTopic, setSelectedTopic] = useState('health');
    const [pleData, setPleData] = useState([]);
    const [pleHourlyBars, setPleHourlyBars] = useState([]);
    const [suggestionsData, setSuggestionsData] = useState({ missingIndexes: [], fragmentedIndexes: [] });
    const [copiedKey, setCopiedKey] = useState(null);
    const [showSuccessBackups, setShowSuccessBackups] = useState(false);
    const [securityData, setSecurityData] = useState(null);
    const [securityLoading, setSecurityLoading] = useState(false);
    const firstFieldRef = useRef(null);
    const selectedTarget = useMemo(() => targets.find((target) => target.id === selectedTargetId) ?? null, [targets, selectedTargetId]);
    const loadHomeHealth = async (targetList) => {
        if (targetList.length === 0) {
            setHomeHealthByTargetId({});
            return;
        }
        setHomeHealthLoading(true);
        try {
            const results = await Promise.all(targetList.map(async (target) => {
                try {
                    const health = await api.health(target.id);
                    return [target.id, isLooseRecord(health) ? health : null];
                }
                catch {
                    return [target.id, null];
                }
            }));
            setHomeHealthByTargetId(Object.fromEntries(results));
        }
        finally {
            setHomeHealthLoading(false);
        }
    };
    const refreshAll = async (targetId) => {
        if (!targetId)
            return;
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
        }
        finally {
            setLoading(false);
        }
    };
    const loadMonitoringStats = async () => {
        try {
            const stats = await api.monitoringStats();
            setMonitoringStats(stats);
        }
        catch {
            setMonitoringStats(null);
        }
    };
    useEffect(() => {
        let active = true;
        const loadTargets = async () => {
            try {
                const response = await api.listTargets();
                if (!active)
                    return;
                setTargets(response.targets);
                setSelectedTargetId(response.activeTargetId);
                void loadHomeHealth(response.targets);
                void loadMonitoringStats();
            }
            catch {
                if (active)
                    setTargetMessage('Unable to load database target list.');
            }
        };
        void loadTargets();
        return () => {
            active = false;
        };
    }, []);
    useEffect(() => {
        if (!selectedTargetId)
            return;
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
        if (!formMode)
            return;
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
    const handleSelectTarget = async (nextTargetId) => {
        setSelectedTargetId(nextTargetId);
        setShowTopicPane(Boolean(nextTargetId));
        if (nextTargetId) {
            setSelectedTopic((current) => current ?? 'health');
        }
        try {
            await api.selectTarget(nextTargetId);
            setTargetMessage('Database target updated.');
        }
        catch {
            setTargetMessage('Unable to switch database target.');
        }
    };
    const handleSubmitConnectionForm = async (event) => {
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
            }
            catch {
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
            const payload = {};
            if (isNameChanged)
                payload.name = formTargetName.trim();
            if (isConnectionChanged || hasPassword)
                payload.connection = toConnectionPayload(formConnection);
            try {
                const updated = await api.updateTarget(selectedTargetId, payload);
                setTargets((current) => current.map((target) => (target.id === selectedTargetId ? updated : target)));
                setTargetMessage('Database target saved successfully.');
                await refreshAll(selectedTargetId);
                closeForm();
            }
            catch {
                setTargetMessage('Unable to update database target.');
            }
        }
    };
    const handleRemoveTarget = async () => {
        if (!selectedTargetId || selectedTargetId === 'default')
            return;
        if (!window.confirm('Are you sure you want to remove this server?'))
            return;
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
        }
        catch {
            setTargetMessage('Unable to remove server.');
        }
        finally {
            setLoading(false);
        }
    };
    const handleSaveSnapshot = async () => {
        if (!selectedTargetId)
            return;
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
        }
        catch (err) {
            setTargetMessage('Unable to save snapshot to DBA_Monitoring. ' + (err?.message || err));
        }
    };
    const loadSnapshotHistory = async (nextOffset) => {
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
        }
        catch (err) {
            setTargetMessage('Unable to load snapshot history. ' + (err?.message || err));
        }
        finally {
            setHistoryLoading(false);
        }
    };
    const startHistorySearch = () => {
        setExpandedSnapshotId(null);
        void loadSnapshotHistory(0);
    };
    const canGoPrev = historyOffset > 0;
    const canGoNext = historyOffset + snapshotHistory.length < historyTotal;
    const isSessionKillAuditSnapshot = (snapshot) => {
        if (!isLooseRecord(snapshot.health)) {
            return false;
        }
        return snapshot.health.eventType === 'kill-session';
    };
    const getSessionKillAuditOutcome = (snapshot) => {
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
    const formatHistoryEvent = (snapshot) => {
        if (!isSessionKillAuditSnapshot(snapshot) || !isLooseRecord(snapshot.health)) {
            return 'Snapshot';
        }
        const outcome = String(snapshot.health.outcome ?? 'unknown');
        const sessionId = snapshot.health.sessionId ?? '?';
        return `Session Kill ${outcome.toUpperCase()} (SPID ${sessionId})`;
    };
    const getHistoryEventClassName = (snapshot) => {
        const outcome = getSessionKillAuditOutcome(snapshot);
        if (outcome === 'succeeded')
            return 'event-pill event-succeeded';
        if (outcome === 'failed')
            return 'event-pill event-failed';
        if (outcome === 'attempted')
            return 'event-pill event-attempted';
        return 'event-pill event-default';
    };
    const exportFilenamePrefix = useMemo(() => {
        const targetName = selectedTarget?.name?.replace(/\s+/g, '_') || 'all_targets';
        return `snapshot-history-${targetName}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    }, [selectedTarget]);
    const downloadBlob = (blob, filename) => {
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
        }
        catch {
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
        }
        catch {
            setTargetMessage('Unable to export snapshot history CSV.');
        }
    };
    const copySnapshotJson = async (snapshot) => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
            setTargetMessage(`Snapshot ${snapshot.id} JSON copied.`);
        }
        catch {
            setTargetMessage('Unable to copy snapshot JSON.');
        }
    };
    const statusLabel = useMemo(() => {
        if (loading)
            return 'Refreshing...';
        if (selectedTarget)
            return `Live on ${selectedTarget.name}`;
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
    const waitBars = waits.slice(0, 8).map((row) => ({
        label: shortText(row.wait_type, 22),
        value: toNumber(row.wait_time_ms),
        suffix: ' ms'
    }));
    const sessionCountByHost = sessions.reduce((acc, row) => {
        const host = String(row.host_name ?? '(unknown)');
        acc[host] = (acc[host] ?? 0) + 1;
        return acc;
    }, {});
    const sessionBars = Object.entries(sessionCountByHost)
        .map(([label, value]) => ({ label: shortText(label, 20), value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
    const queryBars = queries.slice(0, 8).map((row) => ({
        label: shortText(row.query_text, 24),
        value: toNumber(row.avg_elapsed_ms),
        suffix: ' ms'
    }));
    const processCpuBars = processUtilization
        .slice(0, 8)
        .map((row) => ({
        label: shortText(row.program_name, 22),
        value: toNumber(row.cpu_time_ms),
        suffix: ' ms'
    }));
    const processMemoryBars = processUtilization
        .slice(0, 8)
        .map((row) => ({
        label: shortText(row.program_name, 22),
        value: toNumber(row.memory_mb),
        suffix: ' MB'
    }));
    const osProcessCpuBars = osProcessUtilization
        .slice(0, 8)
        .map((row) => ({
        label: shortText(row.name, 22),
        value: toNumber(row.cpu_percent),
        suffix: ' %'
    }));
    const osProcessMemoryBars = osProcessUtilization
        .slice(0, 8)
        .map((row) => ({
        label: shortText(row.name, 22),
        value: toNumber(row.memory_mb),
        suffix: ' MB'
    }));
    const fileSizeByDb = files.reduce((acc, row) => {
        const dbName = String(row.database_name ?? '(unknown)');
        acc[dbName] = (acc[dbName] ?? 0) + toNumber(row.file_size_mb);
        return acc;
    }, {});
    const storageBars = Object.entries(fileSizeByDb)
        .map(([label, value]) => ({ label, value, suffix: ' MB' }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
    const storageTotals = files.reduce((acc, row) => {
        acc.allocatedMb += toNumber(row.file_size_mb);
        acc.usedMb += toNumber(row.used_mb);
        acc.freeMb += toNumber(row.free_mb);
        return acc;
    }, { allocatedMb: 0, usedMb: 0, freeMb: 0 });
    const driveBars = drives
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
    const healthRows = [
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
    const handleKillSession = async (sessionId) => {
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
        }
        catch {
            setTargetMessage(`Unable to kill session ${sessionId}.`);
        }
        finally {
            setKillingSessionId(null);
        }
    };
    const handleCopyText = async (key, text) => {
        if (!text)
            return;
        try {
            await navigator.clipboard.writeText(text);
            setCopiedKey(key);
            window.setTimeout(() => {
                setCopiedKey((prev) => (prev === key ? null : prev));
            }, 1400);
        }
        catch {
            setTargetMessage('Unable to copy text to clipboard.');
        }
    };
    // Hide AI Mode topic by not including it in the topicItems array
    const topicItems = [
        { id: 'health', label: 'Instance Health Overview' },
        { id: 'cpuMemory', label: 'Host Resource Utilization' },
        { id: 'performance', label: 'Wait Statistics & Requests' },
        { id: 'storage', label: 'Database Storage Capacity' },
        { id: 'sessions', label: 'Session Activity & Control' },
        { id: 'queries', label: 'Query Performance Analysis' },
        { id: 'alerts', label: 'Operational Alerts & Incidents' },
        { id: 'backups', label: 'Backup Compliance Status' },
        { id: 'ple', label: 'Buffer Cache PLE Analysis' },
        { id: 'suggestions', label: 'DBA Recommendations' },
        { id: 'security', label: 'Security & Access Control' },
        { id: 'history', label: 'Monitoring Snapshot Audit' }
    ];
    // Fetch PLE and Suggestions when topic selected
    useEffect(() => {
        if (selectedTopic === 'ple' && selectedTargetId) {
            api.ple(selectedTargetId).then((rows) => {
                setPleData(rows);
                const totalRow = rows.find((row) => String(row.node_name ?? '').toLowerCase() === '_total') ?? rows[0];
                const pleValue = totalRow ? toNumber(totalRow.page_life_expectancy) : 0;
                const historyKey = `ple-hourly-history-${selectedTargetId}`;
                let history = [];
                try {
                    const raw = localStorage.getItem(historyKey);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        history = Array.isArray(parsed) ? parsed : [];
                    }
                }
                catch {
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
                const bars = [];
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
            }).catch(() => {
                setPleData([]);
                setPleHourlyBars([]);
            });
        }
        if (selectedTopic === 'suggestions' && selectedTargetId) {
            api.suggestions(selectedTargetId).then(setSuggestionsData).catch(() => setSuggestionsData({ missingIndexes: [], fragmentedIndexes: [] }));
        }
        if (selectedTopic === 'security' && selectedTargetId) {
            setSecurityLoading(true);
            api.security(selectedTargetId)
                .then((data) => { setSecurityData(data); })
                .catch(() => { setSecurityData(null); })
                .finally(() => { setSecurityLoading(false); });
        }
    }, [selectedTopic, selectedTargetId]);
    return (_jsxs("main", { className: "shell", children: [_jsxs("header", { className: "hero", children: [_jsx("p", { className: "tag", children: "Enterprise SQL Server Monitoring for DBAs" }), _jsx("h1", { children: "SQL Server DBA Operations Console" }), _jsxs("div", { className: "hero-row", children: [_jsxs("span", { className: "status", children: ["Status: ", statusLabel] }), _jsx("button", { onClick: () => void refreshAll(selectedTargetId), disabled: !selectedTargetId, children: "Refresh Snapshot" }), _jsx("button", { onClick: () => void handleSaveSnapshot(), disabled: !selectedTargetId, title: "Save current dashboard data to DBA_Monitoring database", children: "Save Snapshot" })] }), _jsxs("section", { className: "target-panel", children: [_jsxs("div", { className: "target-row", children: [_jsx("label", { htmlFor: "target-select", children: "DB Server" }), _jsx("select", { id: "target-select", value: selectedTargetId, onChange: (event) => void handleSelectTarget(event.target.value), children: targets.map((target) => (_jsx("option", { value: target.id, children: target.name }, target.id))) }), _jsx("button", { type: "button", onClick: () => setShowTopicPane(false), style: { marginRight: 8 }, children: "Home" }), _jsx("button", { type: "button", onClick: openAddForm, children: "Add Server" }), _jsx("button", { type: "button", onClick: openEditForm, disabled: !selectedTargetId, children: "Edit Selected" }), _jsx("button", { type: "button", onClick: () => void handleRemoveTarget(), disabled: !selectedTargetId || selectedTargetId === 'default', style: { marginLeft: 8, color: 'red' }, children: "Remove Server" })] }), formMode && (_jsxs("form", { className: "target-add-row", onSubmit: (event) => void handleSubmitConnectionForm(event), children: [_jsx("input", { ref: firstFieldRef, type: "text", placeholder: "Server label", value: formTargetName, onChange: (event) => setFormTargetName(event.target.value) }), _jsx("input", { type: "text", placeholder: "Server host", value: formConnection.server, onChange: (event) => setFormConnection((current) => ({ ...current, server: event.target.value })) }), _jsx("input", { type: "text", placeholder: "Port", value: formConnection.port, onChange: (event) => setFormConnection((current) => ({ ...current, port: event.target.value })) }), _jsx("input", { type: "text", placeholder: "Database", value: formConnection.database, onChange: (event) => setFormConnection((current) => ({ ...current, database: event.target.value })) }), _jsx("input", { type: "text", placeholder: "User ID", value: formConnection.userId, onChange: (event) => setFormConnection((current) => ({ ...current, userId: event.target.value })) }), _jsx("input", { type: "password", placeholder: formMode === 'edit' ? 'Password (required if connection changed)' : 'Password', value: formConnection.password, onChange: (event) => setFormConnection((current) => ({ ...current, password: event.target.value })) }), _jsxs("label", { className: "target-checkbox", children: [_jsx("input", { type: "checkbox", checked: formConnection.encrypt, onChange: (event) => setFormConnection((current) => ({ ...current, encrypt: event.target.checked })) }), "Encrypt"] }), _jsxs("label", { className: "target-checkbox", children: [_jsx("input", { type: "checkbox", checked: formConnection.trustServerCertificate, onChange: (event) => setFormConnection((current) => ({ ...current, trustServerCertificate: event.target.checked })) }), "Trust Server Certificate"] }), _jsx("button", { type: "submit", children: formMode === 'add' ? 'Save New Server' : 'Save Changes' }), _jsx("button", { type: "button", onClick: closeForm, children: "Cancel" })] })), selectedTarget && _jsxs("p", { className: "target-meta", children: ["Active: ", selectedTarget.connectionStringMasked] }), targetMessage && _jsx("p", { className: "target-message", children: targetMessage })] })] }), !showTopicPane && (_jsxs("section", { className: "ai-panel", style: { marginTop: 0 }, children: [_jsx("h2", { children: "Home: All DB Server Instance Health Overview" }), _jsx("p", { children: "Select a DB server to open the full topic pane and detailed monitoring reports." }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8, marginBottom: 8 }, children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Server List Rows" }), _jsx("th", { children: "Snapshot Header Rows" }), _jsx("th", { children: "Snapshot Detail Rows" }), _jsx("th", { children: "Legacy Snapshot Rows" }), _jsx("th", { children: "Oldest Snapshot" }), _jsx("th", { children: "Newest Snapshot" }), _jsx("th", { children: "Retention (days)" })] }) }), _jsx("tbody", { children: monitoringStats ? (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(monitoringStats.serverListCount) }), _jsx("td", { children: formatNumber(monitoringStats.snapshotHeaderCount) }), _jsx("td", { children: formatNumber(monitoringStats.snapshotDetailCount) }), _jsx("td", { children: formatNumber(monitoringStats.dashboardSnapshotCount) }), _jsx("td", { children: monitoringStats.oldestSnapshotAt ? new Date(monitoringStats.oldestSnapshotAt).toLocaleString() : '-' }), _jsx("td", { children: monitoringStats.newestSnapshotAt ? new Date(monitoringStats.newestSnapshotAt).toLocaleString() : '-' }), _jsxs("td", { children: [formatNumber(monitoringStats.retentionDays), monitoringStats.error && _jsx("span", { className: "status-warn", title: monitoringStats.error, children: " \u26A0 DB unavailable" })] })] })) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "Loading monitoring table stats\u2026" }) })) })] }) }), homeHealthLoading && _jsx("p", { children: "Loading server health overview..." }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "DB Server" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Instance Name" }), _jsx("th", { children: "Uptime (minutes)" }), _jsx("th", { children: "CPU (%)" }), _jsx("th", { children: "Memory Usage" }), _jsx("th", { children: "Checked At" }), _jsx("th", { children: "Open Reports" })] }) }), _jsx("tbody", { children: targets.length > 0 ? targets.map((target) => {
                                        const homeHealth = homeHealthByTargetId[target.id];
                                        const homeMemory = homeHealth && isLooseRecord(homeHealth.memory) ? homeHealth.memory : null;
                                        return (_jsxs("tr", { children: [_jsx("td", { children: target.name }), _jsx("td", { children: String(homeHealth?.status ?? 'unknown') }), _jsx("td", { children: String(homeHealth?.serverName ?? '-') }), _jsx("td", { children: formatNumber(homeHealth?.uptimeMinutes ?? 0) }), _jsx("td", { children: formatNumber(homeHealth?.cpuUsagePercent ?? 0) }), _jsx("td", { children: homeMemory ? `${formatBytes(homeMemory.used)} / ${formatBytes(homeMemory.total)}` : '-' }), _jsx("td", { children: homeHealth?.checkedAt ? new Date(String(homeHealth.checkedAt)).toLocaleString() : '-' }), _jsx("td", { children: _jsx("button", { type: "button", onClick: () => void handleSelectTarget(target.id), children: "Select Server" }) })] }, target.id));
                                    }) : (_jsx("tr", { children: _jsx("td", { colSpan: 8, children: "No database targets are configured" }) })) })] }) })] })), showTopicPane && (_jsxs("section", { className: "topic-layout", children: [_jsxs("aside", { className: "topic-sidebar", children: [_jsx("h3", { children: "Topics" }), _jsx("div", { className: "topic-list", children: topicItems.map((topic) => (_jsx("button", { type: "button", className: `topic-button${selectedTopic === topic.id ? ' active' : ''}`, onClick: () => setSelectedTopic(topic.id), children: topic.label }, topic.id))) })] }), _jsxs("div", { className: "topic-content", children: [!selectedTopic && (_jsxs("section", { className: "ai-panel topic-placeholder", children: [_jsx("h2", { children: "Select a DBA monitoring domain" }), _jsx("p", { children: "Click any topic on the left side to load that report on the right." })] })), selectedTopic === 'health' && (_jsxs(MetricCard, { title: "Instance Health Overview", titleProps: { title: 'SQL Server uptime, version, and start time.' }, children: [_jsx("table", { className: "backup-table compact-table", children: _jsx("tbody", { children: healthRows.map((row) => (_jsxs("tr", { children: [_jsx("th", { children: row.label }), _jsx("td", { children: row.value })] }, row.label))) }) }), _jsxs("div", { className: "metric-bars", "aria-label": "Health Signals", children: [_jsx("h4", { children: "Operational Health Indicators" }), _jsx(MiniBarChart, { data: [
                                                    { label: 'Uptime', value: toNumber(health.uptimeMinutes), suffix: ' min' },
                                                    { label: 'CPU', value: toNumber(health.cpuUsagePercent), suffix: ' %' },
                                                    { label: 'Memory', value: memoryUsedPercent, suffix: ' %' },
                                                    { label: 'Active Sessions', value: sessions.length },
                                                    { label: 'Blocking Requests', value: blocking.length }
                                                ], height: 160, color: ["#1c7c54", "#d95d39", "#f2c14e", "#38618c"] })] })] })), selectedTopic === 'cpuMemory' && (_jsxs(MetricCard, { title: "Host Resource Utilization", titleProps: { title: 'Current host utilization metrics.' }, children: [_jsxs("div", { className: "metric-bars", "aria-label": "CPU and Memory Utilization", children: [_jsx("h4", { children: "Host Resource Summary" }), _jsx(MiniBarChart, { data: [
                                                    { label: 'CPU Utilization', value: toNumber(health.cpuUsagePercent), suffix: ' %' },
                                                    { label: 'Memory Utilization', value: memoryUsedPercent, suffix: ' %' },
                                                    { label: 'Memory Free', value: toNumber(memory?.free), suffix: ' B' }
                                                ], height: 160, color: ["#d95d39", "#1c7c54", "#38618c"] })] }), _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Metric" }), _jsx("th", { children: "Value" })] }) }), _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("td", { children: "CPU Utilization" }), _jsxs("td", { children: [formatNumber(health.cpuUsagePercent), "%"] })] }), _jsxs("tr", { children: [_jsx("td", { children: "Total Memory" }), _jsx("td", { children: memory ? formatBytes(memory.total) : '-' })] }), _jsxs("tr", { children: [_jsx("td", { children: "Used Memory" }), _jsx("td", { children: memory ? formatBytes(memory.used) : '-' })] }), _jsxs("tr", { children: [_jsx("td", { children: "Free Memory" }), _jsx("td", { children: memory ? formatBytes(memory.free) : '-' })] }), _jsxs("tr", { children: [_jsx("td", { children: "Memory Utilization" }), _jsxs("td", { children: [memoryUsedPercent, "%"] })] })] })] }), _jsx("div", { className: "snapshot-actions", style: { marginTop: 10 }, children: _jsx("button", { type: "button", onClick: () => setShowProcessUtilization((current) => !current), children: showProcessUtilization ? 'Hide Process-Level Resource Details' : 'Show Process-Level Resource Details' }) }), showProcessUtilization && (_jsxs(Fragment, { children: [_jsxs("div", { className: "metric-bars", "aria-label": "Top Process CPU", style: { marginTop: 10 }, children: [_jsx("h4", { children: "Top SQL Session CPU Consumers" }), _jsx(MiniBarChart, { data: processCpuBars, height: 160, color: ["#d95d39", "#38618c"] })] }), _jsxs("div", { className: "metric-bars", "aria-label": "Top Process Memory", children: [_jsx("h4", { children: "Top SQL Session Memory Consumers" }), _jsx(MiniBarChart, { data: processMemoryBars, height: 160, color: ["#1c7c54", "#f2c14e"] })] }), _jsxs("div", { className: "metric-bars", "aria-label": "Top OS Process CPU", children: [_jsx("h4", { children: "Top OS Process CPU Consumers" }), _jsx(MiniBarChart, { data: osProcessCpuBars, height: 160, color: ["#38618c", "#f2c14e"] })] }), _jsxs("div", { className: "metric-bars", "aria-label": "Top OS Process Memory", children: [_jsx("h4", { children: "Top OS Process Memory Consumers" }), _jsx(MiniBarChart, { data: osProcessMemoryBars, height: 160, color: ["#1c7c54", "#d95d39"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Session ID" }), _jsx("th", { children: "Application Name" }), _jsx("th", { children: "Host Name" }), _jsx("th", { children: "Login Name" }), _jsx("th", { children: "CPU Time (ms)" }), _jsx("th", { children: "Memory Usage (MB)" }), _jsx("th", { children: "Elapsed Time (ms)" }), _jsx("th", { children: "Database Name" })] }) }), _jsx("tbody", { children: processUtilization.length > 0 ? processUtilization.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.session_id) }), _jsx("td", { title: String(row.program_name ?? ''), children: shortText(row.program_name, 28) }), _jsx("td", { title: String(row.host_name ?? ''), children: shortText(row.host_name, 18) }), _jsx("td", { title: String(row.login_name ?? ''), children: shortText(row.login_name, 18) }), _jsx("td", { children: formatNumber(row.cpu_time_ms) }), _jsx("td", { children: formatNumber(row.memory_mb) }), _jsx("td", { children: formatNumber(row.elapsed_ms) }), _jsx("td", { children: String(row.database_name ?? '-') })] }, `${row.session_id}-${row.program_name}-${row.host_name}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 8, children: "No process-level utilization metrics returned" }) })) })] }) }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "PID" }), _jsx("th", { children: "Process Name" }), _jsx("th", { children: "CPU (%)" }), _jsx("th", { children: "Memory (MB)" }), _jsx("th", { children: "Memory (%)" }), _jsx("th", { children: "State" }), _jsx("th", { children: "Command" })] }) }), _jsx("tbody", { children: osProcessUtilization.length > 0 ? osProcessUtilization.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.pid) }), _jsx("td", { title: String(row.name ?? ''), children: shortText(row.name, 30) }), _jsx("td", { children: toNumber(row.cpu_percent).toFixed(2) }), _jsx("td", { children: formatNumber(row.memory_mb) }), _jsx("td", { children: toNumber(row.memory_percent).toFixed(2) }), _jsx("td", { children: String(row.state ?? '-') }), _jsx("td", { title: String(row.command ?? ''), children: shortText(row.command, 70) })] }, `${row.pid}-${String(row.name ?? '')}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No OS process utilization metrics returned" }) })) })] }) })] }))] })), selectedTopic === 'performance' && (_jsxs(MetricCard, { title: "Wait Statistics & Request Performance", titleProps: { title: 'Top waits and active requests.' }, children: [_jsxs("div", { className: "metric-bars", "aria-label": "Top Wait Time", children: [_jsx("h4", { children: "Top Wait Categories by Duration" }), _jsx(MiniBarChart, { data: waitBars, height: 180, color: ["#38618c", "#f2c14e"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Wait Category" }), _jsx("th", { children: "Total Wait Time (ms)" }), _jsx("th", { children: "Waiting Tasks" }), _jsx("th", { children: "Average Wait (ms)" })] }) }), _jsx("tbody", { children: waits.length > 0 ? waits.slice(0, 12).map((row) => (_jsxs("tr", { children: [_jsx("td", { title: String(row.wait_type ?? ''), children: shortText(row.wait_type, 30) }), _jsx("td", { children: formatNumber(row.wait_time_ms) }), _jsx("td", { children: formatNumber(row.waiting_tasks_count) }), _jsx("td", { children: formatNumber(row.avg_wait_ms) })] }, `${row.wait_type}-${row.wait_time_ms}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No wait statistics returned" }) })) })] }) }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Session ID" }), _jsx("th", { children: "Database Name" }), _jsx("th", { children: "CPU Time (ms)" }), _jsx("th", { children: "Elapsed Time (ms)" }), _jsx("th", { children: "SQL Text" })] }) }), _jsx("tbody", { children: activeRequests.length > 0 ? activeRequests.slice(0, 10).map((row) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.session_id) }), _jsx("td", { children: String(row.database_name ?? '-') }), _jsx("td", { children: formatNumber(row.cpu_time) }), _jsx("td", { children: formatNumber(row.total_elapsed_time) }), _jsxs("td", { title: String(row.sql_text ?? ''), children: [shortText(row.sql_text, 60), String(row.sql_text ?? '') && (_jsx("button", { style: { marginLeft: 8 }, onClick: () => void handleCopyText(`${row.session_id}-${row.total_elapsed_time}-sql`, String(row.sql_text ?? '')), children: copiedKey === `${row.session_id}-${row.total_elapsed_time}-sql` ? 'Copied' : 'Copy' }))] })] }, `${row.session_id}-${row.total_elapsed_time}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "No currently active requests" }) })) })] }) })] })), selectedTopic === 'storage' && (_jsxs(MetricCard, { title: "Database Storage Capacity", titleProps: { title: 'Database file size and tempdb utilization.' }, children: [_jsxs("div", { className: "metric-bars", "aria-label": "Drive Space Usage", children: [_jsx("h4", { children: "Drive Capacity Utilization" }), _jsx(MiniBarChart, { data: driveBars, height: 180, color: ["#d95d39", "#f2c14e", "#1c7c54"] })] }), _jsx("div", { className: "metric-scroll", style: { marginBottom: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Drive Letter" }), _jsx("th", { children: "Drive Type" }), _jsx("th", { children: "Total Size" }), _jsx("th", { children: "Used Space" }), _jsx("th", { children: "Free Space" }), _jsx("th", { children: "Percent Used" })] }) }), _jsx("tbody", { children: drives.length > 0 ? drives.map((row) => {
                                                        const size = toNumber(row.size);
                                                        const used = toNumber(row.used);
                                                        const free = toNumber(row.available);
                                                        const usedPercent = size > 0 ? ((used / size) * 100) : 0;
                                                        return (_jsxs("tr", { children: [_jsx("td", { children: String(row.name ?? '-') }), _jsx("td", { children: String(row.type ?? '-') }), _jsx("td", { children: formatBytes(size) }), _jsx("td", { children: formatBytes(used) }), _jsx("td", { children: formatBytes(free) }), _jsxs("td", { children: [usedPercent.toFixed(2), "%"] })] }, `${row.name}-${row.type}-${size}`));
                                                    }) : (_jsx("tr", { children: _jsx("td", { colSpan: 6, children: "No drive capacity metrics returned" }) })) })] }) }), _jsxs("div", { className: "metric-bars", "aria-label": "Top Databases by Size", children: [_jsx("h4", { children: "Largest Databases by Allocated Size" }), _jsx(MiniBarChart, { data: storageBars, height: 180, color: ["#1c7c54", "#f2c14e", "#38618c"] })] }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8, marginBottom: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Total Allocated Size (MB)" })] }) }), _jsx("tbody", { children: Object.entries(fileSizeByDb).length > 0 ? Object.entries(fileSizeByDb)
                                                        .sort((left, right) => right[1] - left[1])
                                                        .map(([dbName, totalSizeMb]) => (_jsxs("tr", { children: [_jsx("td", { children: dbName }), _jsx("td", { children: formatNumber(totalSizeMb) })] }, dbName))) : (_jsx("tr", { children: _jsx("td", { colSpan: 2, children: "No per-database size metrics returned" }) })) })] }) }), _jsxs("table", { className: "backup-table compact-table", style: { marginTop: 8 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Count" }), _jsx("th", { children: "Total Allocated Size (MB)" }), _jsx("th", { children: "Total Used Space (MB)" }), _jsx("th", { children: "Total Free Space (MB)" })] }) }), _jsx("tbody", { children: _jsxs("tr", { children: [_jsx("td", { children: formatNumber(Object.keys(fileSizeByDb).length) }), _jsx("td", { children: formatNumber(storageTotals.allocatedMb) }), _jsx("td", { children: formatNumber(storageTotals.usedMb) }), _jsx("td", { children: formatNumber(storageTotals.freeMb) })] }) })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Database Total Size (MB)" }), _jsx("th", { children: "File Type" }), _jsx("th", { children: "Logical File Name" }), _jsx("th", { children: "File Size (MB)" }), _jsx("th", { children: "Used Space (MB)" }), _jsx("th", { children: "Free Space (MB)" })] }) }), _jsx("tbody", { children: files.length > 0 ? files.slice(0, 20).map((row) => (_jsxs("tr", { children: [_jsx("td", { children: String(row.database_name ?? '-') }), _jsx("td", { children: formatNumber(fileSizeByDb[String(row.database_name ?? '(unknown)')] ?? 0) }), _jsx("td", { children: String(row.type_desc ?? '-') }), _jsx("td", { title: String(row.logical_name ?? ''), children: shortText(row.logical_name, 24) }), _jsx("td", { children: formatNumber(row.file_size_mb) }), _jsx("td", { children: formatNumber(row.used_mb) }), _jsx("td", { children: formatNumber(row.free_mb) })] }, `${row.database_name}-${row.logical_name}-${row.type_desc}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No database file metrics returned" }) })) })] }) }), tempdb && (_jsxs("table", { className: "backup-table compact-table", style: { marginTop: 8 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "TempDB User MB" }), _jsx("th", { children: "TempDB Internal MB" }), _jsx("th", { children: "Version Store MB" }), _jsx("th", { children: "Free MB" })] }) }), _jsx("tbody", { children: _jsxs("tr", { children: [_jsx("td", { children: formatNumber(tempdb.user_object_mb) }), _jsx("td", { children: formatNumber(tempdb.internal_object_mb) }), _jsx("td", { children: formatNumber(tempdb.version_store_mb) }), _jsx("td", { children: formatNumber(tempdb.free_space_mb) })] }) })] }))] })), selectedTopic === 'sessions' && (_jsxs(MetricCard, { title: "Session Activity & Control", titleProps: { title: 'Session count by host and application.' }, children: [_jsxs("div", { className: "metric-bars", "aria-label": "Session Distribution", children: [_jsx("h4", { children: "Session Distribution by Workload Source" }), _jsx(MiniBarChart, { data: sessionBars, height: 180, color: ["#38618c", "#1c7c54"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Session ID" }), _jsx("th", { children: "Host Name" }), _jsx("th", { children: "Application Name" }), _jsx("th", { children: "Session Status" }), _jsx("th", { children: "Database Name" }), _jsx("th", { children: "Action" })] }) }), _jsx("tbody", { children: sessions.length > 0 ? sessions.map((row) => (_jsx("tr", { children: (() => {
                                                            const sessionId = toNumber(row.session_id);
                                                            const isProtectedSession = sessionId <= 50;
                                                            const isKilling = killingSessionId === sessionId;
                                                            return (_jsxs(Fragment, { children: [_jsx("td", { children: formatNumber(row.session_id) }), _jsx("td", { title: String(row.host_name ?? ''), children: shortText(row.host_name, 22) }), _jsx("td", { title: String(row.program_name ?? ''), children: shortText(row.program_name, 34) }), _jsx("td", { children: String(row.status ?? '-') }), _jsx("td", { children: String(row.database_name ?? '-') }), _jsx("td", { children: _jsx("button", { type: "button", onClick: () => void handleKillSession(sessionId), disabled: isKilling || !selectedTargetId || isProtectedSession, style: { color: '#b42318' }, title: isProtectedSession ? 'Protected system session' : `Kill session ${sessionId}`, children: isProtectedSession ? 'Protected' : isKilling ? 'Killing...' : 'KILL' }) })] }));
                                                        })() }, `${row.session_id}-${row.host_name}-${row.program_name}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 6, children: "No active session metadata returned" }) })) })] }) })] })), selectedTopic === 'queries' && (_jsxs(MetricCard, { title: "Query Performance Analysis", titleProps: { title: 'Top queries by elapsed time.' }, children: [_jsxs("div", { className: "metric-bars", "aria-label": "Average Elapsed Time", children: [_jsx("h4", { children: "Average Elapsed Time by Query Pattern" }), _jsx(MiniBarChart, { data: queryBars, height: 180, color: ["#d95d39", "#38618c"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Execution Count" }), _jsx("th", { children: "Average Elapsed (ms)" }), _jsx("th", { children: "Total Logical Reads" }), _jsx("th", { children: "Query Text" })] }) }), _jsx("tbody", { children: queries.length > 0 ? queries.map((row, index) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.execution_count) }), _jsx("td", { children: formatNumber(row.avg_elapsed_ms) }), _jsx("td", { children: formatNumber(row.total_logical_reads) }), _jsxs("td", { title: String(row.query_text ?? ''), children: [shortText(row.query_text, 80), String(row.query_text ?? '') && (_jsx("button", { style: { marginLeft: 8 }, onClick: () => void handleCopyText(`query-${index}`, String(row.query_text ?? '')), children: copiedKey === `query-${index}` ? 'Copied' : 'Copy' }))] })] }, `${row.query_text}-${index}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No query performance statistics returned" }) })) })] }) })] })), selectedTopic === 'alerts' && (_jsxs(MetricCard, { title: "Operational Alerts & Incidents", titleProps: { title: 'Blocking chains and failed SQL Agent jobs.' }, children: [_jsxs("div", { className: "alert-overview", children: [_jsxs("span", { className: String(alerts.severity) === 'high' ? 'backup-stale' : 'backup-ok', children: ["Severity: ", String(alerts.severity ?? 'normal').toUpperCase()] }), _jsxs("span", { children: ["Blocking: ", blocking.length] }), _jsxs("span", { children: ["Failed Jobs: ", failedJobs.length] })] }), _jsxs("div", { className: "metric-bars", "aria-label": "Blocking Wait Time", children: [_jsx("h4", { children: "Blocking Duration by Session" }), _jsx(MiniBarChart, { data: blocking.slice(0, 8).map((row) => ({
                                                    label: `SPID ${String(row.session_id ?? '-')}`,
                                                    value: toNumber(row.wait_time),
                                                    suffix: ' ms'
                                                })), height: 120, color: ["#d95d39", "#38618c"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Session ID" }), _jsx("th", { children: "Blocked By (Session ID)" }), _jsx("th", { children: "Session Status" }), _jsx("th", { children: "Wait Category" }), _jsx("th", { children: "Wait Time (ms)" })] }) }), _jsx("tbody", { children: blocking.length > 0 ? blocking.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.session_id) }), _jsx("td", { children: formatNumber(row.blocking_session_id) }), _jsx("td", { children: String(row.status ?? '-') }), _jsx("td", { children: String(row.wait_type ?? '-') }), _jsx("td", { children: formatNumber(row.wait_time) })] }, `${row.session_id}-${row.blocking_session_id}-${row.wait_time}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "No active blocking chains detected" }) })) })] }) }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "SQL Agent Job Name" }), _jsx("th", { children: "Run Date" }), _jsx("th", { children: "Run Time" }), _jsx("th", { children: "Error Message" })] }) }), _jsx("tbody", { children: failedJobs.length > 0 ? failedJobs.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: String(row.job_name ?? '-') }), _jsx("td", { children: String(row.run_date ?? '-') }), _jsx("td", { children: String(row.run_time ?? '-') }), _jsx("td", { title: String(row.error_message ?? ''), children: shortText(row.error_message, 110) })] }, `${row.job_name}-${row.run_date}-${row.run_time}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No failed SQL Agent jobs detected" }) })) })] }) })] })), selectedTopic === 'backups' && (_jsx(MetricCard, { title: "Backup Compliance Status", children: _jsxs("div", { className: "backup-pane-layout", children: [_jsxs("section", { className: "backup-window", children: [_jsxs("div", { className: "backup-window-header", children: [_jsxs("div", { children: [_jsx("h4", { children: "Databases with Backup Policy Violations" }), _jsxs("p", { children: [failedBackups.length, " failed database backup", failedBackups.length === 1 ? '' : 's', " and ", successfulBackups.length, " successful database backup", successfulBackups.length === 1 ? '' : 's', "."] })] }), _jsx("button", { type: "button", onClick: () => setShowSuccessBackups(true), disabled: showSuccessBackups || successfulBackups.length === 0, children: "Show Compliant Backup Details" })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Last Full Backup" }), _jsx("th", { children: "Last Differential Backup" }), _jsx("th", { children: "Last Log Backup" })] }) }), _jsxs("tbody", { children: [data.backups.length > 0 ? failedBackups.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { className: getBackupStatusClass(row.last_full_backup, 'full'), title: getBackupStalenessTooltip(row.last_full_backup), children: row.last_full_backup ? new Date(row.last_full_backup).toLocaleString() : '-' }), _jsx("td", { className: getBackupStatusClass(row.last_diff_backup, 'diff'), title: getBackupStalenessTooltip(row.last_diff_backup), children: row.last_diff_backup ? new Date(row.last_diff_backup).toLocaleString() : '-' }), _jsx("td", { className: getBackupStatusClass(row.last_log_backup, 'log'), title: getBackupStalenessTooltip(row.last_log_backup), children: row.last_log_backup ? new Date(row.last_log_backup).toLocaleString() : '-' })] }, row.database_name))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No backup metadata returned" }) })), data.backups.length > 0 && failedBackups.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No backup policy violations detected" }) }))] })] }) })] }), showSuccessBackups && (_jsxs("section", { className: "backup-window backup-window-secondary", children: [_jsxs("div", { className: "backup-window-header", children: [_jsxs("div", { children: [_jsx("h4", { children: "Databases Meeting Backup Policy" }), _jsxs("p", { children: [successfulBackups.length, " databases with a recorded successful full backup."] })] }), _jsx("button", { type: "button", onClick: () => setShowSuccessBackups(false), children: "Close Window" })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Last Full Backup" }), _jsx("th", { children: "Last Differential Backup" }), _jsx("th", { children: "Last Log Backup" })] }) }), _jsx("tbody", { children: successfulBackups.length > 0 ? successfulBackups.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { className: getBackupStatusClass(row.last_full_backup, 'full'), title: getBackupStalenessTooltip(row.last_full_backup), children: row.last_full_backup ? new Date(row.last_full_backup).toLocaleString() : '-' }), _jsx("td", { className: getBackupStatusClass(row.last_diff_backup, 'diff'), title: getBackupStalenessTooltip(row.last_diff_backup), children: row.last_diff_backup ? new Date(row.last_diff_backup).toLocaleString() : '-' }), _jsx("td", { className: getBackupStatusClass(row.last_log_backup, 'log'), title: getBackupStalenessTooltip(row.last_log_backup), children: row.last_log_backup ? new Date(row.last_log_backup).toLocaleString() : '-' })] }, row.database_name))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No compliant backup entries found" }) })) })] }) })] }))] }) })), selectedTopic === 'ple' && (_jsxs(MetricCard, { title: "Buffer Cache Page Life Expectancy", titleProps: { title: 'PLE values by NUMA node and recent trend.' }, children: [_jsxs("div", { className: "metric-bars", "aria-label": "PLE Trend", children: [_jsx("h4", { children: "Recent PLE Trend (24h)" }), _jsx(MiniBarChart, { data: pleHourlyBars, height: 180, color: ["#38618c", "#f2c14e"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "NUMA Node ID" }), _jsx("th", { children: "NUMA Node Name" }), _jsx("th", { children: "Page Life Expectancy (sec)" })] }) }), _jsx("tbody", { children: pleData.length > 0 ? pleData.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.node_id }), _jsx("td", { children: String(row.node_name ?? '-') }), _jsx("td", { children: row.page_life_expectancy })] }, row.node_id))) : (_jsx("tr", { children: _jsx("td", { colSpan: 3, children: "No PLE metrics returned" }) })) })] }) })] })), selectedTopic === 'suggestions' && (_jsxs(_Fragment, { children: [_jsxs(MetricCard, { title: "Missing Index Recommendations", titleProps: { title: 'Indexes that should be created for better performance.' }, children: [_jsx("div", { className: "metric-bars", style: { marginBottom: 16 }, children: _jsx(MiniBarChart, { data: suggestionsData.missingIndexes.map((row, idx) => ({
                                                        label: row.table_name || `Table ${idx + 1}`,
                                                        value: Number(row.impact) || 0
                                                    })), height: 180, color: ["#d95d39", "#38618c"] }) }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Table Name" }), _jsx("th", { children: "Equality Columns" }), _jsx("th", { children: "Inequality Columns" }), _jsx("th", { children: "Included Columns" }), _jsx("th", { children: "Estimated Impact" }), _jsx("th", { children: "CREATE INDEX Statement" })] }) }), _jsx("tbody", { children: suggestionsData.missingIndexes.length > 0 ? suggestionsData.missingIndexes.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.table_name }), _jsx("td", { children: row.equality_columns }), _jsx("td", { children: row.inequality_columns }), _jsx("td", { children: row.included_columns }), _jsx("td", { children: row.impact }), _jsxs("td", { children: [_jsx("code", { style: { fontSize: '0.85em' }, children: row.create_statement }), _jsx("button", { style: { marginLeft: 8 }, onClick: () => void handleCopyText(`create-${idx}`, String(row.create_statement ?? '')), children: copiedKey === `create-${idx}` ? 'Copied' : 'Copy' })] })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No missing index recommendations returned" }) })) })] }) })] }), _jsxs(MetricCard, { title: "Fragmented Indexes (>20%)", titleProps: { title: 'Indexes with high fragmentation that should be rebuilt.' }, children: [_jsx("div", { className: "metric-bars", style: { marginBottom: 16 }, children: _jsx(MiniBarChart, { data: suggestionsData.fragmentedIndexes.map((row, idx) => ({
                                                        label: row.index_name || `Index ${idx + 1}`,
                                                        value: Number(row.avg_fragmentation_in_percent) || 0
                                                    })), height: 180, color: ["#f2c14e", "#d95d39"] }) }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Table Name" }), _jsx("th", { children: "Index Name" }), _jsx("th", { children: "Fragmentation (%)" }), _jsx("th", { children: "ALTER INDEX Statement" })] }) }), _jsx("tbody", { children: suggestionsData.fragmentedIndexes.length > 0 ? suggestionsData.fragmentedIndexes.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.table_name }), _jsx("td", { children: row.index_name }), _jsx("td", { children: row.avg_fragmentation_in_percent }), _jsxs("td", { children: [_jsx("code", { style: { fontSize: '0.85em' }, children: row.alter_statement }), _jsx("button", { style: { marginLeft: 8 }, onClick: () => void handleCopyText(`alter-${idx}`, String(row.alter_statement ?? '')), children: copiedKey === `alter-${idx}` ? 'Copied' : 'Copy' })] })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "No indexes above 20% fragmentation threshold" }) })) })] }) })] })] })), selectedTopic === 'history' && (_jsxs("section", { className: "ai-panel", style: { marginTop: 0 }, children: [_jsxs("div", { className: "ai-title-row", children: [_jsx("h2", { children: "Monitoring Snapshot Audit Trail" }), _jsxs("div", { className: "snapshot-actions", children: [_jsx("button", { onClick: startHistorySearch, disabled: historyLoading, children: historyLoading ? 'Loading...' : 'Load History' }), _jsx("button", { onClick: () => void exportSnapshotsCsv(), disabled: historyLoading, children: "Export CSV (All Filtered)" }), _jsx("button", { onClick: () => void exportSnapshotsJson(), disabled: historyLoading, children: "Export JSON (All Filtered)" })] })] }), _jsxs("div", { className: "hero-row", style: { marginTop: 8 }, children: [_jsx("input", { type: "datetime-local", value: historyFrom, onChange: (e) => setHistoryFrom(e.target.value) }), _jsx("input", { type: "datetime-local", value: historyTo, onChange: (e) => setHistoryTo(e.target.value) }), _jsx("input", { type: "number", min: 5, max: 500, value: historyLimit, onChange: (e) => setHistoryLimit(Math.min(500, Math.max(5, Number.parseInt(e.target.value, 10) || 25))), title: "Rows per page" }), _jsxs("label", { className: "target-checkbox", style: { marginLeft: 8 }, children: [_jsx("input", { type: "checkbox", checked: historyAuditOnly, onChange: (e) => {
                                                            setHistoryAuditOnly(e.target.checked);
                                                            if (!e.target.checked) {
                                                                setHistoryAuditOutcome('all');
                                                            }
                                                        } }), "Session Kill Audit Only"] })] }), _jsxs("div", { className: "snapshot-actions", style: { marginTop: 8 }, children: [_jsx("button", { type: "button", onClick: () => {
                                                    setHistoryAuditOnly(true);
                                                    setHistoryAuditOutcome('all');
                                                }, disabled: historyLoading, style: { fontWeight: historyAuditOnly && historyAuditOutcome === 'all' ? 700 : 400 }, children: "All Outcomes" }), _jsx("button", { type: "button", onClick: () => {
                                                    setHistoryAuditOnly(true);
                                                    setHistoryAuditOutcome('attempted');
                                                }, disabled: historyLoading, style: { fontWeight: historyAuditOnly && historyAuditOutcome === 'attempted' ? 700 : 400 }, children: "Attempted Only" }), _jsx("button", { type: "button", onClick: () => {
                                                    setHistoryAuditOnly(true);
                                                    setHistoryAuditOutcome('succeeded');
                                                }, disabled: historyLoading, style: { fontWeight: historyAuditOnly && historyAuditOutcome === 'succeeded' ? 700 : 400 }, children: "Succeeded Only" }), _jsx("button", { type: "button", onClick: () => {
                                                    setHistoryAuditOnly(true);
                                                    setHistoryAuditOutcome('failed');
                                                }, disabled: historyLoading, style: { fontWeight: historyAuditOnly && historyAuditOutcome === 'failed' ? 700 : 400 }, children: "Failed Only" })] }), _jsxs("table", { className: "backup-table", style: { marginTop: 12 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "ID" }), _jsx("th", { children: "Captured At" }), _jsx("th", { children: "Target" }), _jsx("th", { children: "Event" }), _jsx("th", { children: "Health" }), _jsx("th", { children: "Alerts" }), _jsx("th", { children: "Details" })] }) }), _jsx("tbody", { children: historyRows.length > 0 ? (historyRows.map((row) => (_jsxs(Fragment, { children: [_jsxs("tr", { children: [_jsx("td", { children: row.id }), _jsx("td", { children: new Date(row.capturedAt).toLocaleString() }), _jsx("td", { children: row.targetId }), _jsx("td", { children: _jsx("span", { className: getHistoryEventClassName(row), children: formatHistoryEvent(row) }) }), _jsxs("td", { title: JSON.stringify(row.health), children: [JSON.stringify(row.health).slice(0, 80), JSON.stringify(row.health).length > 80 ? '…' : ''] }), _jsxs("td", { title: JSON.stringify(row.alerts), children: [JSON.stringify(row.alerts).slice(0, 80), JSON.stringify(row.alerts).length > 80 ? '…' : ''] }), _jsx("td", { children: _jsx("button", { type: "button", onClick: () => setExpandedSnapshotId((current) => current === row.id ? null : row.id), children: expandedSnapshotId === row.id ? 'Hide' : 'View' }) })] }), expandedSnapshotId === row.id && (_jsx("tr", { children: _jsxs("td", { colSpan: 7, children: [_jsx("div", { className: "snapshot-actions", style: { marginBottom: 8 }, children: _jsx("button", { type: "button", onClick: () => void copySnapshotJson(row), children: "Copy JSON" }) }), _jsx("pre", { className: "snapshot-json", children: JSON.stringify(row, null, 2) })] }) }))] }, row.id)))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: historyAuditOnly ? 'No session kill audit events found for selected outcome' : 'No snapshots found' }) })) })] }), _jsxs("div", { className: "history-pagination", children: [_jsx("button", { type: "button", disabled: !canGoPrev || historyLoading, onClick: () => void loadSnapshotHistory(Math.max(0, historyOffset - historyLimit)), children: "Previous" }), _jsxs("span", { children: ["Showing ", historyRows.length === 0 ? 0 : historyOffset + 1, "-", historyOffset + historyRows.length, " of ", historyTotal, historyAuditOnly ? ` (filtered: ${historyRows.length}${historyAuditOutcome !== 'all' ? `, outcome: ${historyAuditOutcome}` : ''})` : ''] }), _jsx("button", { type: "button", disabled: !canGoNext || historyLoading, onClick: () => void loadSnapshotHistory(historyOffset + historyLimit), children: "Next" })] })] })), selectedTopic === 'security' && (_jsxs("section", { className: "ai-panel", children: [_jsxs("div", { className: "panel-title-row", children: [_jsx("h2", { children: "Security & Access Control" }), _jsx("button", { onClick: () => {
                                                    if (selectedTargetId) {
                                                        setSecurityLoading(true);
                                                        api.security(selectedTargetId).then((d) => setSecurityData(d)).catch(() => setSecurityData(null)).finally(() => setSecurityLoading(false));
                                                    }
                                                }, disabled: securityLoading, children: securityLoading ? 'Loading…' : 'Refresh' })] }), securityLoading && _jsx("p", { children: "Loading security data\u2026" }), !securityLoading && !securityData && _jsx("p", { children: "Security data unavailable. Click Refresh to load." }), securityData && (_jsxs(_Fragment, { children: [_jsx("h3", { style: { marginTop: 16 }, children: "SQL Server Logins" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Login Name" }), _jsx("th", { children: "Login Type" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Password Policy" }), _jsx("th", { children: "Password Expiration" }), _jsx("th", { children: "Default Database" }), _jsx("th", { children: "Server Roles" }), _jsx("th", { children: "Created" }), _jsx("th", { children: "Last Modified" })] }) }), _jsx("tbody", { children: securityData.serverLogins.length > 0 ? securityData.serverLogins.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.login_name }), _jsx("td", { children: row.login_type.replace(/_/g, ' ') }), _jsx("td", { children: _jsx("span", { className: row.is_disabled ? 'status-warn' : 'status-ok', children: row.is_disabled ? 'Disabled' : 'Enabled' }) }), _jsx("td", { children: row.is_policy_checked ? 'Enforced' : 'Not Enforced' }), _jsx("td", { children: row.is_expiration_checked ? 'Enforced' : 'Not Enforced' }), _jsx("td", { children: row.default_database }), _jsx("td", { children: row.server_roles || '(none)' }), _jsx("td", { children: row.create_date }), _jsx("td", { children: row.modify_date })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 9, children: "No SQL Server logins found" }) })) })] }) }), _jsx("h3", { style: { marginTop: 20 }, children: "Server-Level Role Memberships" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Server Role" }), _jsx("th", { children: "Member Login" }), _jsx("th", { children: "Member Type" }), _jsx("th", { children: "Member Status" })] }) }), _jsx("tbody", { children: securityData.serverRoles.length > 0 ? securityData.serverRoles.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.role_name }), _jsx("td", { children: row.member_name }), _jsx("td", { children: row.member_type.replace(/_/g, ' ') }), _jsx("td", { children: _jsx("span", { className: row.is_member_disabled ? 'status-warn' : 'status-ok', children: row.is_member_disabled ? 'Disabled' : 'Active' }) })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No server role memberships found" }) })) })] }) }), _jsx("h3", { style: { marginTop: 20 }, children: "Database Users" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "User Name" }), _jsx("th", { children: "User Type" }), _jsx("th", { children: "Mapped Login" }), _jsx("th", { children: "Default Schema" }), _jsx("th", { children: "Database Roles" }), _jsx("th", { children: "Created" })] }) }), _jsx("tbody", { children: securityData.dbUsers.length > 0 ? securityData.dbUsers.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.user_name }), _jsx("td", { children: row.user_type.replace(/_/g, ' ') }), _jsx("td", { children: row.login_name || '(none)' }), _jsx("td", { children: row.default_schema }), _jsx("td", { children: row.db_roles || '(none)' }), _jsx("td", { children: row.create_date })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No database users found" }) })) })] }) }), _jsx("h3", { style: { marginTop: 20 }, children: "Database-Level Role Memberships" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Database Role" }), _jsx("th", { children: "Member Name" }), _jsx("th", { children: "Member Type" })] }) }), _jsx("tbody", { children: securityData.dbRoles.length > 0 ? securityData.dbRoles.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.role_name }), _jsx("td", { children: row.member_name }), _jsx("td", { children: row.member_type.replace(/_/g, ' ') })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No database role memberships found" }) })) })] }) }), _jsx("h3", { style: { marginTop: 20 }, children: "Explicit Object Permissions" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Principal Name" }), _jsx("th", { children: "Principal Type" }), _jsx("th", { children: "Object Name" }), _jsx("th", { children: "Object Type" }), _jsx("th", { children: "Permission" }), _jsx("th", { children: "Grant State" })] }) }), _jsx("tbody", { children: securityData.objectPermissions.length > 0 ? securityData.objectPermissions.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.principal_name }), _jsx("td", { children: row.principal_type.replace(/_/g, ' ') }), _jsx("td", { children: row.object_name || '(database)' }), _jsx("td", { children: row.object_type.replace(/_/g, ' ') }), _jsx("td", { children: row.permission_name }), _jsx("td", { children: _jsx("span", { className: row.permission_state === 'DENY' ? 'status-critical' : 'status-ok', children: row.permission_state }) })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No explicit object permissions found" }) })) })] }) })] }))] }))] })] }))] }));
};
