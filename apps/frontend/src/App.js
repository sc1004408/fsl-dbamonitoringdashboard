import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AIModePanel } from './components/AIModePanel';
import { MetricCard } from './components/MetricCard';
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
export const App = () => {
    const [data, setData] = useState(initialState);
    const [targets, setTargets] = useState([]);
    const [selectedTargetId, setSelectedTargetId] = useState('');
    const [formMode, setFormMode] = useState(null);
    const [formTargetName, setFormTargetName] = useState('');
    const [formConnection, setFormConnection] = useState(defaultConnectionFields);
    const [editBaselineConnection, setEditBaselineConnection] = useState(defaultConnectionFields);
    const [targetMessage, setTargetMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [aiEnabled, setAiEnabled] = useState(false);
    const [aiText, setAiText] = useState('Enable AI mode to receive diagnostics and recommendations.');
    const [snapshotHistory, setSnapshotHistory] = useState([]);
    const [historyFrom, setHistoryFrom] = useState('');
    const [historyTo, setHistoryTo] = useState('');
    const [historyLimit, setHistoryLimit] = useState(25);
    const [historyOffset, setHistoryOffset] = useState(0);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [expandedSnapshotId, setExpandedSnapshotId] = useState(null);
    const firstFieldRef = useRef(null);
    const selectedTarget = useMemo(() => targets.find((target) => target.id === selectedTargetId) ?? null, [targets, selectedTargetId]);
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
    useEffect(() => {
        let active = true;
        const loadTargets = async () => {
            try {
                const response = await api.listTargets();
                if (!active)
                    return;
                setTargets(response.targets);
                setSelectedTargetId(response.activeTargetId);
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
        if (!aiEnabled)
            return;
        let active = true;
        const loadAi = async () => {
            try {
                const insights = await api.aiInsights(selectedTargetId);
                if (active)
                    setAiText(insights.summary);
            }
            catch {
                if (active)
                    setAiText('AI insights are unavailable. Check backend AI provider settings.');
            }
        };
        void loadAi();
        return () => {
            active = false;
        };
    }, [aiEnabled, selectedTargetId]);
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
        catch {
            setTargetMessage('Unable to save snapshot to DBA_Monitoring.');
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
        catch {
            setTargetMessage('Unable to load snapshot history.');
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
    const exportFilenamePrefix = useMemo(() => {
        const targetName = selectedTarget?.name?.replace(/\s+/g, '_') || 'all_targets';
        return `snapshot-history-${targetName}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    }, [selectedTarget]);
    const downloadFile = (content, mimeType, filename) => {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };
    const exportSnapshotsJson = () => {
        downloadFile(JSON.stringify(snapshotHistory, null, 2), 'application/json;charset=utf-8', `${exportFilenamePrefix}.json`);
    };
    const toCsvCell = (value) => {
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        const escaped = String(raw ?? '').replace(/"/g, '""');
        return `"${escaped}"`;
    };
    const exportSnapshotsCsv = () => {
        const headers = ['id', 'capturedAt', 'targetId', 'health', 'performance', 'storage', 'sessions', 'queries', 'alerts', 'backups'];
        const lines = snapshotHistory.map((row) => [
            toCsvCell(row.id),
            toCsvCell(row.capturedAt),
            toCsvCell(row.targetId),
            toCsvCell(row.health),
            toCsvCell(row.performance),
            toCsvCell(row.storage),
            toCsvCell(row.sessions),
            toCsvCell(row.queries),
            toCsvCell(row.alerts),
            toCsvCell(row.backups)
        ].join(','));
        const csv = [headers.map((h) => `"${h}"`).join(','), ...lines].join('\n');
        downloadFile(csv, 'text/csv;charset=utf-8', `${exportFilenamePrefix}.csv`);
    };
    const statusLabel = useMemo(() => {
        if (loading)
            return 'Refreshing...';
        if (selectedTarget)
            return `Live on ${selectedTarget.name}`;
        return 'Waiting for target';
    }, [loading, selectedTarget]);
    return (_jsxs("main", { className: "shell", children: [_jsxs("header", { className: "hero", children: [_jsx("p", { className: "tag", children: "A to Z SQL Server Monitoring" }), _jsx("h1", { children: "DB Command Bridge" }), _jsxs("div", { className: "hero-row", children: [_jsxs("span", { className: "status", children: ["Status: ", statusLabel] }), _jsx("button", { onClick: () => void refreshAll(selectedTargetId), disabled: !selectedTargetId, children: "Refresh Snapshot" }), _jsx("button", { onClick: () => void handleSaveSnapshot(), disabled: !selectedTargetId, title: "Save current dashboard data to DBA_Monitoring database", children: "Save Snapshot" })] }), _jsxs("section", { className: "target-panel", children: [_jsxs("div", { className: "target-row", children: [_jsx("label", { htmlFor: "target-select", children: "DB Server" }), _jsx("select", { id: "target-select", value: selectedTargetId, onChange: (event) => void handleSelectTarget(event.target.value), children: targets.map((target) => (_jsx("option", { value: target.id, children: target.name }, target.id))) }), _jsx("button", { type: "button", onClick: openAddForm, children: "Add Server" }), _jsx("button", { type: "button", onClick: openEditForm, disabled: !selectedTargetId, children: "Edit Selected" })] }), formMode && (_jsxs("form", { className: "target-add-row", onSubmit: (event) => void handleSubmitConnectionForm(event), children: [_jsx("input", { ref: firstFieldRef, type: "text", placeholder: "Server label", value: formTargetName, onChange: (event) => setFormTargetName(event.target.value) }), _jsx("input", { type: "text", placeholder: "Server host", value: formConnection.server, onChange: (event) => setFormConnection((current) => ({ ...current, server: event.target.value })) }), _jsx("input", { type: "text", placeholder: "Port", value: formConnection.port, onChange: (event) => setFormConnection((current) => ({ ...current, port: event.target.value })) }), _jsx("input", { type: "text", placeholder: "Database", value: formConnection.database, onChange: (event) => setFormConnection((current) => ({ ...current, database: event.target.value })) }), _jsx("input", { type: "text", placeholder: "User ID", value: formConnection.userId, onChange: (event) => setFormConnection((current) => ({ ...current, userId: event.target.value })) }), _jsx("input", { type: "password", placeholder: formMode === 'edit' ? 'Password (required if connection changed)' : 'Password', value: formConnection.password, onChange: (event) => setFormConnection((current) => ({ ...current, password: event.target.value })) }), _jsxs("label", { className: "target-checkbox", children: [_jsx("input", { type: "checkbox", checked: formConnection.encrypt, onChange: (event) => setFormConnection((current) => ({ ...current, encrypt: event.target.checked })) }), "Encrypt"] }), _jsxs("label", { className: "target-checkbox", children: [_jsx("input", { type: "checkbox", checked: formConnection.trustServerCertificate, onChange: (event) => setFormConnection((current) => ({ ...current, trustServerCertificate: event.target.checked })) }), "Trust Server Certificate"] }), _jsx("button", { type: "submit", children: formMode === 'add' ? 'Save New Server' : 'Save Changes' }), _jsx("button", { type: "button", onClick: closeForm, children: "Cancel" })] })), selectedTarget && _jsxs("p", { className: "target-meta", children: ["Active: ", selectedTarget.connectionStringMasked] }), targetMessage && _jsx("p", { className: "target-message", children: targetMessage })] })] }), _jsxs("section", { className: "grid", children: [_jsx(MetricCard, { title: "Server Health", titleProps: { title: 'SQL Server uptime, version, and start time.' }, children: _jsx("pre", { children: JSON.stringify(data.health, null, 2) }) }), _jsx(MetricCard, { title: "Performance & Waits", titleProps: { title: 'Top waits and active requests.' }, children: _jsx("pre", { children: JSON.stringify(data.performance, null, 2) }) }), _jsx(MetricCard, { title: "Storage Footprint", titleProps: { title: 'Database file size and tempdb utilization.' }, children: _jsx("pre", { children: JSON.stringify(data.storage, null, 2) }) }), _jsx(MetricCard, { title: "Active Sessions", titleProps: { title: 'Session count by host and application.' }, children: _jsx("pre", { children: JSON.stringify(data.sessions, null, 2) }) }), _jsx(MetricCard, { title: "Top Expensive Queries", titleProps: { title: 'Top queries by elapsed time.' }, children: _jsx("pre", { children: JSON.stringify(data.queries, null, 2) }) }), _jsx(MetricCard, { title: "Alert Feed", titleProps: { title: 'Blocking chains and failed SQL Agent jobs.' }, children: _jsx("pre", { children: JSON.stringify(data.alerts, null, 2) }) }), _jsxs(MetricCard, { title: "Backup Freshness", children: [_jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database" }), _jsx("th", { children: "Last Full" }), _jsx("th", { children: "Last Diff" }), _jsx("th", { children: "Last Log" })] }) }), _jsx("tbody", { children: data.backups.length > 0 ? data.backups.map((b) => (_jsxs("tr", { children: [_jsx("td", { children: b.database_name }), _jsx("td", { className: getBackupStatusClass(b.last_full_backup, 'full'), title: getBackupStalenessTooltip(b.last_full_backup), children: b.last_full_backup ? new Date(b.last_full_backup).toLocaleString() : '—' }), _jsx("td", { className: getBackupStatusClass(b.last_diff_backup, 'diff'), title: getBackupStalenessTooltip(b.last_diff_backup), children: b.last_diff_backup ? new Date(b.last_diff_backup).toLocaleString() : '—' }), _jsx("td", { className: getBackupStatusClass(b.last_log_backup, 'log'), title: getBackupStalenessTooltip(b.last_log_backup), children: b.last_log_backup ? new Date(b.last_log_backup).toLocaleString() : '—' })] }, b.database_name))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No backup data" }) })) })] }), _jsxs("div", { className: "backup-legend", children: [_jsx("span", { className: "backup-ok", children: "\u25CF" }), " Healthy", _jsx("span", { className: "backup-warning", children: "\u25CF" }), " Warning", _jsx("span", { className: "backup-stale", children: "\u25CF" }), " Stale", _jsx("span", { className: "backup-missing", children: "\u25CF" }), " Missing"] })] })] }), _jsx(AIModePanel, { enabled: aiEnabled, onToggle: () => setAiEnabled((v) => !v), content: aiText, loading: false }), _jsxs("section", { className: "ai-panel", style: { marginTop: 16 }, children: [_jsxs("div", { className: "ai-title-row", children: [_jsx("h2", { children: "Snapshot History" }), _jsxs("div", { className: "snapshot-actions", children: [_jsx("button", { onClick: startHistorySearch, disabled: historyLoading, children: historyLoading ? 'Loading...' : 'Load History' }), _jsx("button", { onClick: exportSnapshotsCsv, disabled: snapshotHistory.length === 0, children: "Export CSV" }), _jsx("button", { onClick: exportSnapshotsJson, disabled: snapshotHistory.length === 0, children: "Export JSON" })] })] }), _jsxs("div", { className: "hero-row", style: { marginTop: 8 }, children: [_jsx("input", { type: "datetime-local", value: historyFrom, onChange: (e) => setHistoryFrom(e.target.value) }), _jsx("input", { type: "datetime-local", value: historyTo, onChange: (e) => setHistoryTo(e.target.value) }), _jsx("input", { type: "number", min: 5, max: 500, value: historyLimit, onChange: (e) => setHistoryLimit(Math.min(500, Math.max(5, Number.parseInt(e.target.value, 10) || 25))), title: "Rows per page" })] }), _jsxs("table", { className: "backup-table", style: { marginTop: 12 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "ID" }), _jsx("th", { children: "Captured At" }), _jsx("th", { children: "Target" }), _jsx("th", { children: "Health" }), _jsx("th", { children: "Alerts" }), _jsx("th", { children: "Details" })] }) }), _jsx("tbody", { children: snapshotHistory.length > 0 ? (snapshotHistory.map((row) => (_jsxs(Fragment, { children: [_jsxs("tr", { children: [_jsx("td", { children: row.id }), _jsx("td", { children: new Date(row.capturedAt).toLocaleString() }), _jsx("td", { children: row.targetId }), _jsxs("td", { title: JSON.stringify(row.health), children: [JSON.stringify(row.health).slice(0, 80), JSON.stringify(row.health).length > 80 ? '…' : ''] }), _jsxs("td", { title: JSON.stringify(row.alerts), children: [JSON.stringify(row.alerts).slice(0, 80), JSON.stringify(row.alerts).length > 80 ? '…' : ''] }), _jsx("td", { children: _jsx("button", { type: "button", onClick: () => setExpandedSnapshotId((current) => current === row.id ? null : row.id), children: expandedSnapshotId === row.id ? 'Hide' : 'View' }) })] }), expandedSnapshotId === row.id && (_jsx("tr", { children: _jsx("td", { colSpan: 6, children: _jsx("pre", { className: "snapshot-json", children: JSON.stringify(row, null, 2) }) }) }))] }, row.id)))) : (_jsx("tr", { children: _jsx("td", { colSpan: 6, children: "No snapshots found" }) })) })] }), _jsxs("div", { className: "history-pagination", children: [_jsx("button", { type: "button", disabled: !canGoPrev || historyLoading, onClick: () => void loadSnapshotHistory(Math.max(0, historyOffset - historyLimit)), children: "Previous" }), _jsxs("span", { children: ["Showing ", snapshotHistory.length === 0 ? 0 : historyOffset + 1, "-", historyOffset + snapshotHistory.length, " of ", historyTotal] }), _jsx("button", { type: "button", disabled: !canGoNext || historyLoading, onClick: () => void loadSnapshotHistory(historyOffset + historyLimit), children: "Next" })] })] })] }));
};
