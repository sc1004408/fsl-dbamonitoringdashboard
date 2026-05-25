import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MetricCard } from './components/MetricCard';
import { MiniBarChart } from './components/MiniBarChart';
import { api, setClientTabId } from './services/api';
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
const normalizePleHistoryValue = (value) => {
    if (Array.isArray(value)) {
        return value
            .filter(isLooseRecord)
            .map((row) => ({
            node_name: String(row.node_name ?? '-'),
            page_life_expectancy: Number.isFinite(Number(row.page_life_expectancy))
                ? Number(row.page_life_expectancy)
                : String(row.page_life_expectancy ?? '-')
        }));
    }
    if (isLooseRecord(value) && Array.isArray(value.value)) {
        return value.value
            .filter(isLooseRecord)
            .map((row) => ({
            node_name: String(row.node_name ?? '-'),
            page_life_expectancy: Number.isFinite(Number(row.page_life_expectancy))
                ? Number(row.page_life_expectancy)
                : String(row.page_life_expectancy ?? '-')
        }));
    }
    return [];
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
const formatElapsedDuration = (milliseconds) => {
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
const shortText = (value, maxLength = 100) => {
    const text = String(value ?? '');
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};
const readAuthContext = () => {
    const token = localStorage.getItem('token');
    if (!token) {
        return { id: 0, username: '', role: null };
    }
    try {
        const payloadPart = token.split('.')[1];
        if (!payloadPart) {
            return { id: 0, username: '', role: null };
        }
        const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(normalized));
        const role = decoded?.role === 'reader' ? 'reader' : decoded?.role === 'admin' ? 'admin' : null;
        return {
            id: Number(decoded?.sub ?? 0),
            username: typeof decoded?.username === 'string' ? decoded.username : '',
            role
        };
    }
    catch {
        return { id: 0, username: '', role: null };
    }
};
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const INACTIVITY_TIMEOUT_SECONDS = Math.floor(INACTIVITY_TIMEOUT_MS / 1000);
const formatCountdown = (seconds) => {
    const safe = Math.max(0, seconds);
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};
export const App = () => {
    const navigate = useNavigate();
    const inactivityTimerRef = useRef(null);
    const inactivityDeadlineRef = useRef(null);
    const countdownIntervalRef = useRef(null);
    const tabIdRef = useRef('');
    const userMenuRef = useRef(null);
    const authContext = useMemo(() => readAuthContext(), []);
    const [data, setData] = useState(initialState);
    const [adminUsers, setAdminUsers] = useState([]);
    const [adminLoading, setAdminLoading] = useState(false);
    const [showAdminConsole, setShowAdminConsole] = useState(false);
    const [showCreateUserForm, setShowCreateUserForm] = useState(false);
    const [showAdminUsers, setShowAdminUsers] = useState(false);
    const [adminUsersLoaded, setAdminUsersLoaded] = useState(false);
    const [adminMessage, setAdminMessage] = useState('');
    const [inactivityRemainingSeconds, setInactivityRemainingSeconds] = useState(INACTIVITY_TIMEOUT_SECONDS);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [newUsername, setNewUsername] = useState('');
    const [newUserPassword, setNewUserPassword] = useState('');
    const [newUserRole, setNewUserRole] = useState('reader');
    const getTabId = () => {
        if (tabIdRef.current) {
            return tabIdRef.current;
        }
        const storageKey = 'db-monitoring-tab-id';
        let tabId = sessionStorage.getItem(storageKey);
        if (!tabId) {
            tabId = typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            sessionStorage.setItem(storageKey, tabId);
        }
        tabIdRef.current = tabId;
        setClientTabId(tabId);
        return tabId;
    };
    const handleLogout = useCallback(() => {
        const tabId = tabIdRef.current || sessionStorage.getItem('db-monitoring-tab-id');
        if (tabId) {
            void api.presenceClose(tabId, true);
        }
        localStorage.removeItem('token');
        navigate('/login');
    }, [navigate]);
    const handleUserMenuToggle = () => {
        setIsUserMenuOpen((current) => !current);
    };
    const handleUserMenuLogout = () => {
        setIsUserMenuOpen(false);
        handleLogout();
    };
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
    const [showLongRunningQueryWindow, setShowLongRunningQueryWindow] = useState(false);
    const [longRunningSortKey, setLongRunningSortKey] = useState('running');
    const [longRunningSortOrder, setLongRunningSortOrder] = useState('desc');
    const [selectedTopic, setSelectedTopic] = useState('health');
    const [showHistoryView, setShowHistoryView] = useState({ topic: null });
    const [topicHistory, setTopicHistory] = useState([]);
    const [pleData, setPleData] = useState([]);
    const [pleHourlyBars, setPleHourlyBars] = useState([]);
    const [suggestionsData, setSuggestionsData] = useState({ missingIndexes: [], fragmentedIndexes: [] });
    const [copiedKey, setCopiedKey] = useState(null);
    const [showSuccessBackups, setShowSuccessBackups] = useState(false);
    const [securityData, setSecurityData] = useState(null);
    const [securityLoading, setSecurityLoading] = useState(false);
    const [exportMenuContext, setExportMenuContext] = useState('none');
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
    const loadPleForTarget = async (targetId) => {
        try {
            const rows = await api.ple(targetId);
            setPleData(rows);
            const totalRow = rows.find((row) => String(row.node_name ?? '').toLowerCase() === '_total') ?? rows[0];
            const pleValue = totalRow ? toNumber(totalRow.page_life_expectancy) : 0;
            const historyKey = `ple-hourly-history-${targetId}`;
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
        }
        catch {
            setPleData([]);
            setPleHourlyBars([]);
        }
    };
    const loadSuggestionsForTarget = async (targetId) => {
        try {
            const suggestions = await api.suggestions(targetId);
            setSuggestionsData(suggestions);
        }
        catch {
            setSuggestionsData({ missingIndexes: [], fragmentedIndexes: [] });
        }
    };
    const loadSecurityForTarget = async (targetId) => {
        setSecurityLoading(true);
        try {
            const nextData = await api.security(targetId);
            setSecurityData(nextData);
        }
        catch {
            setSecurityData(null);
        }
        finally {
            setSecurityLoading(false);
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
    const loadAdminUsers = async () => {
        if (authContext.role !== 'admin') {
            return;
        }
        setAdminLoading(true);
        try {
            const users = await api.listUsers();
            setAdminUsers(users);
            setAdminUsersLoaded(true);
        }
        catch {
            setAdminMessage('Unable to load users.');
            setAdminUsersLoaded(false);
        }
        finally {
            setAdminLoading(false);
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
        if (authContext.id <= 0) {
            return;
        }
        const tabId = getTabId();
        const sendHeartbeat = () => {
            void api.presenceHeartbeat(tabId);
        };
        sendHeartbeat();
        const intervalId = window.setInterval(sendHeartbeat, 30 * 1000);
        const handlePageHide = () => {
            void api.presenceClose(tabId, true);
        };
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('beforeunload', handlePageHide);
        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('beforeunload', handlePageHide);
            void api.presenceClose(tabId, true);
        };
    }, [authContext.id]);
    useEffect(() => {
        const handleDocumentClick = (event) => {
            const target = event.target;
            if (!userMenuRef.current || !target) {
                return;
            }
            if (!userMenuRef.current.contains(target)) {
                setIsUserMenuOpen(false);
            }
        };
        document.addEventListener('click', handleDocumentClick);
        return () => {
            document.removeEventListener('click', handleDocumentClick);
        };
    }, []);
    useEffect(() => {
        const updateCountdown = () => {
            const deadline = inactivityDeadlineRef.current;
            if (!deadline) {
                setInactivityRemainingSeconds(INACTIVITY_TIMEOUT_SECONDS);
                return;
            }
            const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            setInactivityRemainingSeconds(remaining);
        };
        const resetTimer = () => {
            if (inactivityTimerRef.current) {
                window.clearTimeout(inactivityTimerRef.current);
            }
            inactivityDeadlineRef.current = Date.now() + INACTIVITY_TIMEOUT_MS;
            updateCountdown();
            inactivityTimerRef.current = window.setTimeout(() => {
                handleLogout();
            }, INACTIVITY_TIMEOUT_MS);
        };
        const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];
        events.forEach((eventName) => {
            document.addEventListener(eventName, resetTimer, { passive: true });
        });
        resetTimer();
        countdownIntervalRef.current = window.setInterval(updateCountdown, 1000);
        return () => {
            if (inactivityTimerRef.current) {
                window.clearTimeout(inactivityTimerRef.current);
            }
            if (countdownIntervalRef.current) {
                window.clearInterval(countdownIntervalRef.current);
            }
            events.forEach((eventName) => {
                document.removeEventListener(eventName, resetTimer);
            });
        };
    }, [handleLogout]);
    useEffect(() => {
        const handleDocumentClick = (event) => {
            const target = event.target;
            if (!target) {
                return;
            }
            if (!target.closest('.export-menu-wrap')) {
                setExportMenuContext('none');
            }
        };
        document.addEventListener('click', handleDocumentClick);
        return () => {
            document.removeEventListener('click', handleDocumentClick);
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
            const pleSnapshotRows = await api.ple(selectedTargetId);
            setPleData(pleSnapshotRows);
            await api.saveSnapshot({
                targetId: selectedTargetId,
                health: data.health,
                performance: data.performance,
                ple: pleSnapshotRows,
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
    const loadTopicHistory = async (topic, nextOffset) => {
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
            setTopicHistory(response.items.map((row) => ({
                id: row.id,
                capturedAt: row.capturedAt,
                value: topic === 'ple'
                    ? normalizePleHistoryValue(row.ple)
                    : row[topic]
            })));
            setHistoryTotal(response.total);
            setHistoryOffset(response.offset);
        }
        catch (err) {
            setTargetMessage('Unable to load topic history. ' + (err?.message || err));
        }
        finally {
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
    const openHistoryView = (topic) => {
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
    const handleSelectTopic = (topic) => {
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
    const exportSnapshotsExcel = async () => {
        try {
            const blob = await api.exportSnapshots({
                targetId: selectedTargetId || undefined,
                from: historyFrom || undefined,
                to: historyTo || undefined,
                format: 'excel'
            });
            downloadBlob(blob, `${exportFilenamePrefix}.xlsx`);
        }
        catch {
            setTargetMessage('Unable to export snapshot history Excel.');
        }
    };
    const exportSnapshotsByFormat = async (format, includeHistoryRange) => {
        try {
            const blob = await api.exportSnapshots({
                targetId: selectedTargetId || undefined,
                from: includeHistoryRange ? (historyFrom || undefined) : undefined,
                to: includeHistoryRange ? (historyTo || undefined) : undefined,
                format
            });
            const extension = format === 'excel' ? 'xlsx' : format;
            downloadBlob(blob, `${exportFilenamePrefix}.${extension}`);
            setExportMenuContext('none');
        }
        catch {
            setTargetMessage(`Unable to export snapshot history ${format.toUpperCase()}.`);
        }
    };
    const renderExportMenu = (context, includeHistoryRange) => {
        const isOpen = exportMenuContext === context;
        return (_jsxs("div", { className: "export-menu-wrap", style: { position: 'relative', display: 'inline-block' }, children: [_jsx("button", { type: "button", onClick: (event) => {
                        event.stopPropagation();
                        setExportMenuContext((current) => current === context ? 'none' : context);
                    }, disabled: historyLoading, children: "Export" }), isOpen && (_jsxs("div", { style: {
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        right: 0,
                        minWidth: 140,
                        background: '#fff',
                        border: '1px solid #d0d5dd',
                        borderRadius: 8,
                        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.15)',
                        padding: 6,
                        zIndex: 15
                    }, children: [_jsx("button", { type: "button", style: { width: '100%', textAlign: 'left', marginBottom: 4 }, onClick: () => void exportSnapshotsByFormat('csv', includeHistoryRange), children: "CSV" }), _jsx("button", { type: "button", style: { width: '100%', textAlign: 'left', marginBottom: 4 }, onClick: () => void exportSnapshotsByFormat('pdf', includeHistoryRange), children: "PDF" }), _jsx("button", { type: "button", style: { width: '100%', textAlign: 'left' }, onClick: () => void exportSnapshotsByFormat('excel', includeHistoryRange), children: "EXCEL" })] }))] }));
    };
    const exportSnapshotsPdf = async () => {
        try {
            const blob = await api.exportSnapshots({
                targetId: selectedTargetId || undefined,
                from: historyFrom || undefined,
                to: historyTo || undefined,
                format: 'pdf'
            });
            downloadBlob(blob, `${exportFilenamePrefix}.pdf`);
        }
        catch {
            setTargetMessage('Unable to export snapshot history PDF.');
        }
    };
    const handleCreateUser = async (event) => {
        event.preventDefault();
        if (!newUsername.trim() || !newUserPassword) {
            setAdminMessage('Enter username and password to create user.');
            return;
        }
        setAdminLoading(true);
        setAdminMessage('');
        try {
            await api.createUser(newUsername.trim(), newUserPassword, newUserRole);
            setNewUsername('');
            setNewUserPassword('');
            setNewUserRole('reader');
            if (showAdminUsers) {
                await loadAdminUsers();
                setAdminMessage('User created successfully.');
            }
            else {
                setAdminUsersLoaded(false);
                setAdminMessage('User created. Click Load Principals to view the updated list.');
            }
        }
        catch {
            setAdminMessage('Unable to create user.');
        }
        finally {
            setAdminLoading(false);
        }
    };
    const resetCreateUserForm = () => {
        setNewUsername('');
        setNewUserPassword('');
        setNewUserRole('reader');
    };
    const handleToggleCreateUserForm = () => {
        const nextVisible = !showCreateUserForm;
        setShowCreateUserForm(nextVisible);
        if (!nextVisible) {
            resetCreateUserForm();
        }
    };
    const handleToggleAdminUsers = async () => {
        const nextVisible = !showAdminUsers;
        setShowAdminUsers(nextVisible);
        if (nextVisible && !adminUsersLoaded) {
            setAdminMessage('');
            await loadAdminUsers();
        }
    };
    const handleToggleAdminConsole = () => {
        const nextVisible = !showAdminConsole;
        setShowAdminConsole(nextVisible);
        if (!nextVisible) {
            setShowCreateUserForm(false);
            setShowAdminUsers(false);
            setAdminMessage('');
            resetCreateUserForm();
        }
    };
    const handleDeleteUser = async (userId, username) => {
        if (username === authContext.username) {
            setAdminMessage('You cannot delete your own account.');
            return;
        }
        if (!window.confirm(`Delete user ${username}?`)) {
            return;
        }
        setAdminLoading(true);
        setAdminMessage('');
        try {
            await api.deleteUser(userId);
            if (showAdminUsers) {
                await loadAdminUsers();
            }
            else {
                setAdminUsersLoaded(false);
            }
            setAdminMessage('User deleted successfully.');
        }
        catch {
            setAdminMessage('Unable to delete user.');
        }
        finally {
            setAdminLoading(false);
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
    const sessionMetaById = sessions.reduce((acc, row) => {
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
        }
        else if (longRunningSortKey === 'start') {
            comparison = left.startedAtMs - right.startedAtMs;
        }
        else {
            const leftSession = Number.parseInt(left.sessionId, 10);
            const rightSession = Number.parseInt(right.sessionId, 10);
            if (Number.isFinite(leftSession) && Number.isFinite(rightSession)) {
                comparison = leftSession - rightSession;
            }
            else {
                comparison = left.sessionId.localeCompare(right.sessionId);
            }
        }
        return longRunningSortOrder === 'asc' ? comparison : -comparison;
    });
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
        { id: 'health', label: 'Instance Health Check', code: 'HLT' },
        { id: 'cpuMemory', label: 'Host CPU & Memory', code: 'CPU' },
        { id: 'performance', label: 'Waits, Latches & Requests', code: 'WTR' },
        { id: 'storage', label: 'Data & Log Capacity', code: 'STG' },
        { id: 'sessions', label: 'SPID Activity & Kill Control', code: 'SES' },
        { id: 'queries', label: 'Top SQL & Execution Trends', code: 'SQL' },
        { id: 'alerts', label: 'Incidents & Alert Conditions', code: 'ALT' },
        { id: 'backups', label: 'Backup & Recovery SLA', code: 'BKP' },
        { id: 'ple', label: 'Buffer Cache Health (PLE)', code: 'PLE' },
        { id: 'suggestions', label: 'Index & Tuning Suggestions', code: 'TUN' },
        { id: 'security', label: 'Principals, Roles & Permissions', code: 'SEC' },
        { id: 'history', label: 'Snapshot Audit Trail', code: 'AUD' }
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
    return (_jsxs("main", { className: "shell", children: [_jsxs("header", { className: "hero", children: [_jsx("p", { className: "tag", children: "Enterprise SQL Server Monitoring for DBAs" }), _jsx("h1", { children: "SQL Server DBA Operations Console" }), _jsxs("div", { className: "hero-row", children: [_jsxs("span", { className: "status", children: ["Status: ", statusLabel] }), _jsxs("span", { className: "status idle-timer", children: ["Auto logout in ", formatCountdown(inactivityRemainingSeconds)] }), _jsx("button", { onClick: () => void refreshAll(selectedTargetId), disabled: !selectedTargetId, children: "Refresh Telemetry" }), _jsx("button", { onClick: () => void handleSaveSnapshot(), disabled: !selectedTargetId, title: "Persist current telemetry set to DBA_Monitoring", children: "Persist Snapshot" }), authContext.role === 'admin' && (_jsx("button", { type: "button", onClick: handleToggleAdminConsole, children: showAdminConsole ? 'Hide Principals Console' : 'Open Principals Console' })), _jsxs("div", { className: "user-menu", ref: userMenuRef, children: [_jsxs("button", { type: "button", className: "user-menu-trigger", onClick: handleUserMenuToggle, children: [_jsx("span", { className: "user-icon", "aria-hidden": "true", children: _jsx("svg", { viewBox: "0 0 24 24", className: "user-icon-svg", focusable: "false", "aria-hidden": "true", children: _jsx("path", { fill: "currentColor", d: "M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2.25c-3.38 0-6.75 1.69-6.75 5.06a.94.94 0 0 0 .94.94h11.62a.94.94 0 0 0 .94-.94c0-3.37-3.37-5.06-6.75-5.06Z" }) }) }), _jsx("span", { className: "user-name", children: authContext.username || 'DBA User' }), _jsx("span", { className: "user-caret", "aria-hidden": "true", children: "\u25BE" })] }), isUserMenuOpen && (_jsx("div", { className: "user-menu-dropdown", children: _jsx("button", { type: "button", className: "user-menu-item", onClick: handleUserMenuLogout, children: "Logout" }) }))] })] }), _jsxs("section", { className: "target-panel", children: [_jsxs("div", { className: "target-row", children: [_jsx("label", { htmlFor: "target-select", children: "SQL Instance" }), _jsx("select", { id: "target-select", value: selectedTargetId, onChange: (event) => void handleSelectTarget(event.target.value), children: targets.map((target) => (_jsx("option", { value: target.id, children: target.name }, target.id))) }), _jsx("button", { type: "button", onClick: () => setShowTopicPane(false), style: { marginRight: 8 }, children: "Executive View" }), _jsx("button", { type: "button", onClick: openAddForm, children: "Register Instance" }), _jsx("button", { type: "button", onClick: openEditForm, disabled: !selectedTargetId, children: "Edit Instance" }), _jsx("button", { type: "button", onClick: () => void handleRemoveTarget(), disabled: !selectedTargetId || selectedTargetId === 'default', style: { marginLeft: 8, color: 'red' }, children: "Decommission Instance" })] }), formMode && (_jsxs("form", { className: "target-add-row", onSubmit: (event) => void handleSubmitConnectionForm(event), children: [_jsx("input", { ref: firstFieldRef, type: "text", placeholder: "Server label", value: formTargetName, onChange: (event) => setFormTargetName(event.target.value) }), _jsx("input", { type: "text", placeholder: "Server host", value: formConnection.server, onChange: (event) => setFormConnection((current) => ({ ...current, server: event.target.value })) }), _jsx("input", { type: "text", placeholder: "Port", value: formConnection.port, onChange: (event) => setFormConnection((current) => ({ ...current, port: event.target.value })) }), _jsx("input", { type: "text", placeholder: "Database", value: formConnection.database, onChange: (event) => setFormConnection((current) => ({ ...current, database: event.target.value })) }), _jsx("input", { type: "text", placeholder: "User ID", value: formConnection.userId, onChange: (event) => setFormConnection((current) => ({ ...current, userId: event.target.value })) }), _jsx("input", { type: "password", placeholder: formMode === 'edit' ? 'Password (required if connection changed)' : 'Password', value: formConnection.password, onChange: (event) => setFormConnection((current) => ({ ...current, password: event.target.value })) }), _jsxs("label", { className: "target-checkbox", children: [_jsx("input", { type: "checkbox", checked: formConnection.encrypt, onChange: (event) => setFormConnection((current) => ({ ...current, encrypt: event.target.checked })) }), "Encrypt"] }), _jsxs("label", { className: "target-checkbox", children: [_jsx("input", { type: "checkbox", checked: formConnection.trustServerCertificate, onChange: (event) => setFormConnection((current) => ({ ...current, trustServerCertificate: event.target.checked })) }), "Trust Server Certificate"] }), _jsx("button", { type: "submit", children: formMode === 'add' ? 'Save Target' : 'Save Changes' }), _jsx("button", { type: "button", onClick: closeForm, children: "Cancel" })] })), selectedTarget && _jsxs("p", { className: "target-meta", children: ["Active: ", selectedTarget.connectionStringMasked] }), targetMessage && _jsx("p", { className: "target-message", children: targetMessage })] }), authContext.role === 'admin' && showAdminConsole && (_jsxs("section", { className: "target-panel admin-console", style: { marginTop: 10 }, children: [_jsx("h3", { style: { marginTop: 0 }, children: "DBA Administration Console: Principals" }), _jsxs("div", { className: "admin-actions-row", children: [_jsx("button", { type: "button", onClick: handleToggleCreateUserForm, disabled: adminLoading, children: showCreateUserForm ? 'Hide Create User' : 'Create User' }), _jsx("button", { type: "button", onClick: () => void handleToggleAdminUsers(), disabled: adminLoading, children: showAdminUsers ? 'Hide Principals' : 'Load Principals' }), showAdminUsers && (_jsx("button", { type: "button", onClick: () => void loadAdminUsers(), disabled: adminLoading, children: "Refresh Principals" }))] }), showCreateUserForm && (_jsxs("form", { className: "target-add-row admin-form", onSubmit: (event) => void handleCreateUser(event), children: [_jsx("input", { type: "text", placeholder: "Login name", value: newUsername, onChange: (event) => setNewUsername(event.target.value) }), _jsx("input", { type: "password", placeholder: "Password", value: newUserPassword, onChange: (event) => setNewUserPassword(event.target.value) }), _jsxs("select", { value: newUserRole, onChange: (event) => setNewUserRole(event.target.value), children: [_jsx("option", { value: "reader", children: "reader" }), _jsx("option", { value: "admin", children: "admin" })] }), _jsx("button", { type: "submit", disabled: adminLoading, children: adminLoading ? 'Saving...' : 'Create Principal' }), _jsx("button", { type: "button", onClick: resetCreateUserForm, disabled: adminLoading, children: "Reset Fields" })] })), adminMessage && _jsx("p", { className: "target-message", children: adminMessage }), !showAdminUsers && _jsx("p", { className: "target-message", children: "Principal list is hidden. Click Load Principals to populate it." }), showAdminUsers && (_jsx("div", { className: "metric-scroll admin-user-table", style: { marginTop: 8 }, children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Principal ID" }), _jsx("th", { children: "Login Name" }), _jsx("th", { children: "Access Role" }), _jsx("th", { children: "Session Status" }), _jsx("th", { children: "Open Tabs" }), _jsx("th", { children: "Last Active" }), _jsx("th", { children: "Created (UTC)" }), _jsx("th", { children: "Operation" })] }) }), _jsx("tbody", { children: adminUsers.length > 0 ? adminUsers.map((user) => (_jsxs("tr", { children: [_jsx("td", { children: user.id }), _jsx("td", { children: user.username }), _jsx("td", { children: user.role }), _jsx("td", { children: _jsx("span", { className: user.is_active ? 'status-ok' : 'status-warn', children: user.is_active ? 'Active' : 'Offline' }) }), _jsx("td", { children: user.active_tab_count ?? 0 }), _jsx("td", { children: user.last_active_at ? new Date(user.last_active_at).toLocaleString() : '-' }), _jsx("td", { children: user.created_at ? new Date(user.created_at).toLocaleString() : '-' }), _jsx("td", { children: _jsx("button", { type: "button", onClick: () => void handleDeleteUser(user.id, user.username), disabled: adminLoading || user.username === authContext.username, className: "btn-danger", children: "Drop" }) })] }, user.id))) : (_jsx("tr", { children: _jsx("td", { colSpan: 8, children: adminLoading ? 'Loading principals...' : 'No principals found' }) })) })] }) }))] }))] }), !showTopicPane && (_jsxs("section", { className: "ai-panel", style: { marginTop: 0 }, children: [_jsx("h2", { children: "Executive Overview: SQL Estate Health" }), _jsx("p", { children: "Select an instance to open topic-specific DBA analytics and operational controls." }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8, marginBottom: 8 }, children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Server List Rows" }), _jsx("th", { children: "Snapshot Header Rows" }), _jsx("th", { children: "Snapshot Detail Rows" }), _jsx("th", { children: "Legacy Snapshot Rows" }), _jsx("th", { children: "Oldest Snapshot" }), _jsx("th", { children: "Newest Snapshot" }), _jsx("th", { children: "Retention (days)" })] }) }), _jsx("tbody", { children: monitoringStats ? (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(monitoringStats.serverListCount) }), _jsx("td", { children: formatNumber(monitoringStats.snapshotHeaderCount) }), _jsx("td", { children: formatNumber(monitoringStats.snapshotDetailCount) }), _jsx("td", { children: formatNumber(monitoringStats.dashboardSnapshotCount) }), _jsx("td", { children: monitoringStats.oldestSnapshotAt ? new Date(monitoringStats.oldestSnapshotAt).toLocaleString() : '-' }), _jsx("td", { children: monitoringStats.newestSnapshotAt ? new Date(monitoringStats.newestSnapshotAt).toLocaleString() : '-' }), _jsxs("td", { children: [formatNumber(monitoringStats.retentionDays), monitoringStats.error && _jsx("span", { className: "status-warn", title: monitoringStats.error, children: " - repository unavailable" })] })] })) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "Loading monitoring table stats\u0393\u00C7\u00AA" }) })) })] }) }), homeHealthLoading && _jsx("p", { children: "Loading SQL instance telemetry..." }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "SQL Instance" }), _jsx("th", { children: "Availability" }), _jsx("th", { children: "Host Name" }), _jsx("th", { children: "Instance Uptime (min)" }), _jsx("th", { children: "Host CPU %" }), _jsx("th", { children: "Memory Footprint" }), _jsx("th", { children: "Last Sample" }), _jsx("th", { children: "Open Console" })] }) }), _jsx("tbody", { children: targets.length > 0 ? targets.map((target) => {
                                        const homeHealth = homeHealthByTargetId[target.id];
                                        const homeMemory = homeHealth && isLooseRecord(homeHealth.memory) ? homeHealth.memory : null;
                                        return (_jsxs("tr", { children: [_jsx("td", { children: target.name }), _jsx("td", { children: String(homeHealth?.status ?? 'unknown') }), _jsx("td", { children: String(homeHealth?.serverName ?? '-') }), _jsx("td", { children: formatNumber(homeHealth?.uptimeMinutes ?? 0) }), _jsx("td", { children: formatNumber(homeHealth?.cpuUsagePercent ?? 0) }), _jsx("td", { children: homeMemory ? `${formatBytes(homeMemory.used)} / ${formatBytes(homeMemory.total)}` : '-' }), _jsx("td", { children: homeHealth?.checkedAt ? new Date(String(homeHealth.checkedAt)).toLocaleString() : '-' }), _jsx("td", { children: _jsx("button", { type: "button", onClick: () => void handleSelectTarget(target.id), children: "Open Workbook" }) })] }, target.id));
                                    }) : (_jsx("tr", { children: _jsx("td", { colSpan: 8, children: "No database targets are configured" }) })) })] }) })] })), showTopicPane && (_jsxs("section", { className: "topic-layout", children: [_jsxs("aside", { className: "topic-sidebar", children: [_jsx("h3", { children: "DBA Workbooks" }), _jsx("div", { className: "topic-list", children: topicItems.map((topic) => (_jsxs("button", { type: "button", className: `topic-button${selectedTopic === topic.id ? ' active' : ''}`, onClick: () => handleSelectTopic(topic.id), children: [_jsx("span", { className: "topic-code", children: topic.code }), topic.label] }, topic.id))) })] }), _jsxs("div", { className: "topic-content", children: [selectedTopic && !showHistoryView.topic && (_jsxs("div", { className: "snapshot-actions", style: { justifyContent: 'flex-end', marginBottom: 8 }, children: [_jsx("button", { type: "button", onClick: () => void refreshCurrentTopic(), disabled: !selectedTargetId || loading || historyLoading || securityLoading, children: loading || securityLoading ? 'Refreshing Telemetry...' : 'Refresh Workbook' }), renderExportMenu('live', false)] })), !selectedTopic && (_jsxs("section", { className: "ai-panel topic-placeholder", children: [_jsx("h2", { children: "Select a monitoring domain" }), _jsx("p", { children: "Click any topic on the left side to load that report on the right." })] })), showHistoryView.topic && (_jsxs("section", { className: "ai-panel", style: { marginTop: 0, position: 'relative' }, children: [_jsx("button", { className: "history-btn history-back-btn", onClick: closeHistoryView, children: "Back to Live Data" }), _jsxs("div", { className: "ai-title-row", children: [_jsxs("h2", { children: ["History View: ", showHistoryView.topic.charAt(0).toUpperCase() + showHistoryView.topic.slice(1)] }), _jsxs("div", { className: "snapshot-actions", children: [_jsx("input", { type: "datetime-local", value: historyFrom, onChange: (e) => setHistoryFrom(e.target.value) }), _jsx("input", { type: "datetime-local", value: historyTo, onChange: (e) => setHistoryTo(e.target.value) }), _jsx("button", { onClick: startHistorySearch, disabled: historyLoading, children: historyLoading ? 'Loading...' : 'Load History' }), renderExportMenu('topic-history', true)] })] }), _jsxs("div", { className: "snapshot-actions", style: { marginTop: 6, opacity: 0.9 }, children: [_jsxs("span", { children: ["Rows: ", topicHistory.length] }), _jsxs("span", { children: ["Offset: ", historyOffset] }), _jsxs("span", { children: ["Total: ", historyTotal] })] }), _jsxs("table", { className: "backup-table", style: { marginTop: 12 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Snapshot ID" }), _jsx("th", { children: "Captured Timestamp" }), _jsxs("th", { children: [showHistoryView.topic.charAt(0).toUpperCase() + showHistoryView.topic.slice(1), " Metrics"] })] }) }), _jsx("tbody", { children: topicHistory.length > 0 ? (topicHistory.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.id }), _jsx("td", { children: new Date(row.capturedAt).toLocaleString() }), _jsx("td", { children: showHistoryView.topic === 'ple' && Array.isArray(row.value) && row.value.length > 0 ? (_jsxs("table", { style: { borderCollapse: 'collapse', width: '100%', fontSize: 13 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: { borderBottom: '1px solid #ccc', textAlign: 'left', paddingRight: 8 }, children: "Node" }), _jsx("th", { style: { borderBottom: '1px solid #ccc', textAlign: 'left', paddingRight: 8 }, children: "PLE (sec)" })] }) }), _jsx("tbody", { children: row.value.map((ple, idx) => (_jsxs("tr", { children: [_jsx("td", { children: ple.node_name ?? '-' }), _jsx("td", { children: ple.page_life_expectancy ?? '-' })] }, ple.node_name || idx))) })] })) : showHistoryView.topic === 'ple' ? (_jsx("span", { style: { opacity: 0.75 }, children: "PLE was not captured for this snapshot." })) : Array.isArray(row.value) ? (_jsxs("div", { children: [_jsxs("div", { style: { marginBottom: 6, fontWeight: 600 }, children: ["Array with ", row.value.length, " item(s)"] }), _jsx("pre", { style: { maxWidth: 700, maxHeight: 180, overflow: 'auto', margin: 0 }, children: JSON.stringify(row.value, null, 2) })] })) : isLooseRecord(row.value) ? (_jsx("table", { style: { borderCollapse: 'collapse', width: '100%', fontSize: 13 }, children: _jsx("tbody", { children: Object.entries(row.value).map(([key, val]) => (_jsxs("tr", { children: [_jsx("th", { style: { textAlign: 'left', width: 220, borderBottom: '1px solid #ddd', paddingRight: 8 }, children: key }), _jsx("td", { style: { borderBottom: '1px solid #ddd' }, children: typeof val === 'object' ? JSON.stringify(val) : String(val ?? '-') })] }, key))) }) })) : (_jsx("pre", { style: { maxWidth: 700, maxHeight: 220, overflow: 'auto', margin: 0 }, children: JSON.stringify(row.value, null, 2) })) })] }, row.id)))) : (_jsx("tr", { children: _jsx("td", { colSpan: 3, children: "No history data found for selected range." }) })) })] }), _jsxs("div", { className: "history-pagination", children: [_jsx("button", { type: "button", disabled: !canGoPrev || historyLoading, onClick: () => showHistoryView.topic && void loadTopicHistory(showHistoryView.topic, Math.max(0, historyOffset - historyLimit)), children: "Previous" }), _jsxs("span", { children: ["Showing ", topicHistory.length === 0 ? 0 : historyOffset + 1, "-", historyOffset + topicHistory.length, " of ", historyTotal] }), _jsx("button", { type: "button", disabled: !canGoNext || historyLoading, onClick: () => showHistoryView.topic && void loadTopicHistory(showHistoryView.topic, historyOffset + historyLimit), children: "Next" })] })] })), selectedTopic === 'health' && !showHistoryView.topic && (_jsxs(MetricCard, { title: "Instance Health Overview", titleProps: { title: 'SQL Server uptime, version, and start time.' }, children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('health'), children: "History View" }), _jsx("table", { className: "backup-table compact-table", children: _jsx("tbody", { children: healthRows.map((row) => (_jsxs("tr", { children: [_jsx("th", { children: row.label }), _jsx("td", { children: row.value })] }, row.label))) }) }), _jsxs("div", { className: "metric-bars", "aria-label": "Health Signals", children: [_jsx("h4", { children: "Operational Health Indicators" }), _jsx(MiniBarChart, { data: [
                                                    { label: 'Uptime', value: toNumber(health.uptimeMinutes), suffix: ' min' },
                                                    { label: 'CPU', value: toNumber(health.cpuUsagePercent), suffix: ' %' },
                                                    { label: 'Memory', value: memoryUsedPercent, suffix: ' %' },
                                                    { label: 'Active Sessions', value: sessions.length },
                                                    { label: 'Blocking Requests', value: blocking.length }
                                                ], height: 160, color: ["#1c7c54", "#d95d39", "#f2c14e", "#38618c"] })] })] })), selectedTopic === 'cpuMemory' && !showHistoryView.topic && (_jsxs(MetricCard, { title: "Host Resource Utilization", titleProps: { title: 'Current host utilization metrics.' }, children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('cpuMemory'), children: "History View" }), _jsxs("div", { className: "metric-bars", "aria-label": "CPU and Memory Utilization", children: [_jsx("h4", { children: "Host Resource Summary" }), _jsx(MiniBarChart, { data: [
                                                    { label: 'CPU Utilization', value: toNumber(health.cpuUsagePercent), suffix: ' %' },
                                                    { label: 'Memory Utilization', value: memoryUsedPercent, suffix: ' %' },
                                                    { label: 'Memory Free', value: toNumber(memory?.free), suffix: ' B' }
                                                ], height: 160, color: ["#d95d39", "#1c7c54", "#38618c"] })] }), _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Metric" }), _jsx("th", { children: "Value" })] }) }), _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("td", { children: "CPU Utilization" }), _jsxs("td", { children: [formatNumber(health.cpuUsagePercent), "%"] })] }), _jsxs("tr", { children: [_jsx("td", { children: "Total Memory" }), _jsx("td", { children: memory ? formatBytes(memory.total) : '-' })] }), _jsxs("tr", { children: [_jsx("td", { children: "Used Memory" }), _jsx("td", { children: memory ? formatBytes(memory.used) : '-' })] }), _jsxs("tr", { children: [_jsx("td", { children: "Free Memory" }), _jsx("td", { children: memory ? formatBytes(memory.free) : '-' })] }), _jsxs("tr", { children: [_jsx("td", { children: "Memory Utilization" }), _jsxs("td", { children: [memoryUsedPercent, "%"] })] })] })] }), _jsx("div", { className: "snapshot-actions", style: { marginTop: 10 }, children: _jsx("button", { type: "button", onClick: () => setShowProcessUtilization((current) => !current), children: showProcessUtilization ? 'Hide Process-Level Resource Details' : 'Show Process-Level Resource Details' }) }), showProcessUtilization && (_jsxs(Fragment, { children: [_jsxs("div", { className: "metric-bars", "aria-label": "Top Process CPU", style: { marginTop: 10 }, children: [_jsx("h4", { children: "Top SQL Session CPU Consumers" }), _jsx(MiniBarChart, { data: processCpuBars, height: 160, color: ["#d95d39", "#38618c"] })] }), _jsxs("div", { className: "metric-bars", "aria-label": "Top Process Memory", children: [_jsx("h4", { children: "Top SQL Session Memory Consumers" }), _jsx(MiniBarChart, { data: processMemoryBars, height: 160, color: ["#1c7c54", "#f2c14e"] })] }), _jsxs("div", { className: "metric-bars", "aria-label": "Top OS Process CPU", children: [_jsx("h4", { children: "Top OS Process CPU Consumers" }), _jsx(MiniBarChart, { data: osProcessCpuBars, height: 160, color: ["#38618c", "#f2c14e"] })] }), _jsxs("div", { className: "metric-bars", "aria-label": "Top OS Process Memory", children: [_jsx("h4", { children: "Top OS Process Memory Consumers" }), _jsx(MiniBarChart, { data: osProcessMemoryBars, height: 160, color: ["#1c7c54", "#d95d39"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Session ID" }), _jsx("th", { children: "Application Name" }), _jsx("th", { children: "Host Name" }), _jsx("th", { children: "Login Name" }), _jsx("th", { children: "CPU Time (ms)" }), _jsx("th", { children: "Memory Usage (MB)" }), _jsx("th", { children: "Elapsed Time (ms)" }), _jsx("th", { children: "Database Name" })] }) }), _jsx("tbody", { children: processUtilization.length > 0 ? processUtilization.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.session_id) }), _jsx("td", { title: String(row.program_name ?? ''), children: shortText(row.program_name, 28) }), _jsx("td", { title: String(row.host_name ?? ''), children: shortText(row.host_name, 18) }), _jsx("td", { title: String(row.login_name ?? ''), children: shortText(row.login_name, 18) }), _jsx("td", { children: formatNumber(row.cpu_time_ms) }), _jsx("td", { children: formatNumber(row.memory_mb) }), _jsx("td", { children: formatNumber(row.elapsed_ms) }), _jsx("td", { children: String(row.database_name ?? '-') })] }, `${row.session_id}-${row.program_name}-${row.host_name}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 8, children: "No process-level utilization metrics returned" }) })) })] }) }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "PID" }), _jsx("th", { children: "Process Name" }), _jsx("th", { children: "CPU (%)" }), _jsx("th", { children: "Memory (MB)" }), _jsx("th", { children: "Memory (%)" }), _jsx("th", { children: "State" }), _jsx("th", { children: "Command" })] }) }), _jsx("tbody", { children: osProcessUtilization.length > 0 ? osProcessUtilization.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.pid) }), _jsx("td", { title: String(row.name ?? ''), children: shortText(row.name, 30) }), _jsx("td", { children: toNumber(row.cpu_percent).toFixed(2) }), _jsx("td", { children: formatNumber(row.memory_mb) }), _jsx("td", { children: toNumber(row.memory_percent).toFixed(2) }), _jsx("td", { children: String(row.state ?? '-') }), _jsx("td", { title: String(row.command ?? ''), children: shortText(row.command, 70) })] }, `${row.pid}-${String(row.name ?? '')}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No OS process utilization metrics returned" }) })) })] }) })] }))] })), selectedTopic === 'performance' && !showHistoryView.topic && (_jsxs(MetricCard, { title: "Wait Statistics & Request Performance", titleProps: { title: 'Top waits and active requests.' }, children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('performance'), children: "History View" }), _jsxs("div", { className: "metric-bars", "aria-label": "Top Wait Time", children: [_jsx("h4", { children: "Top Wait Categories by Duration" }), _jsx(MiniBarChart, { data: waitBars, height: 180, color: ["#38618c", "#f2c14e"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Wait Category" }), _jsx("th", { children: "Total Wait Time (ms)" }), _jsx("th", { children: "Waiting Tasks" }), _jsx("th", { children: "Average Wait (ms)" })] }) }), _jsx("tbody", { children: waits.length > 0 ? waits.slice(0, 12).map((row) => (_jsxs("tr", { children: [_jsx("td", { title: String(row.wait_type ?? ''), children: shortText(row.wait_type, 30) }), _jsx("td", { children: formatNumber(row.wait_time_ms) }), _jsx("td", { children: formatNumber(row.waiting_tasks_count) }), _jsx("td", { children: formatNumber(row.avg_wait_ms) })] }, `${row.wait_type}-${row.wait_time_ms}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No wait statistics returned" }) })) })] }) }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Session ID" }), _jsx("th", { children: "Database Name" }), _jsx("th", { children: "CPU Time (ms)" }), _jsx("th", { children: "Elapsed Time (ms)" }), _jsx("th", { children: "SQL Text" })] }) }), _jsx("tbody", { children: activeRequests.length > 0 ? activeRequests.slice(0, 10).map((row) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.session_id) }), _jsx("td", { children: String(row.database_name ?? '-') }), _jsx("td", { children: formatNumber(row.cpu_time) }), _jsx("td", { children: formatNumber(row.total_elapsed_time) }), _jsxs("td", { title: String(row.sql_text ?? ''), children: [shortText(row.sql_text, 60), String(row.sql_text ?? '') && (_jsx("button", { style: { marginLeft: 8 }, onClick: () => void handleCopyText(`${row.session_id}-${row.total_elapsed_time}-sql`, String(row.sql_text ?? '')), children: copiedKey === `${row.session_id}-${row.total_elapsed_time}-sql` ? 'Copied' : 'Copy' }))] })] }, `${row.session_id}-${row.total_elapsed_time}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "No currently active requests" }) })) })] }) })] })), selectedTopic === 'storage' && !showHistoryView.topic && (_jsxs(MetricCard, { title: "Database Storage Capacity", titleProps: { title: 'Database file size and tempdb utilization.' }, children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('storage'), children: "History View" }), _jsxs("div", { className: "metric-bars", "aria-label": "Drive Space Usage", children: [_jsx("h4", { children: "Drive Capacity Utilization" }), _jsx(MiniBarChart, { data: driveBars, height: 180, color: ["#d95d39", "#f2c14e", "#1c7c54"] })] }), _jsx("div", { className: "metric-scroll", style: { marginBottom: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Drive Letter" }), _jsx("th", { children: "Drive Type" }), _jsx("th", { children: "Total Size" }), _jsx("th", { children: "Used Space" }), _jsx("th", { children: "Free Space" }), _jsx("th", { children: "Percent Used" })] }) }), _jsx("tbody", { children: drives.length > 0 ? drives.map((row) => {
                                                        const size = toNumber(row.size);
                                                        const used = toNumber(row.used);
                                                        const free = toNumber(row.available);
                                                        const usedPercent = size > 0 ? ((used / size) * 100) : 0;
                                                        return (_jsxs("tr", { children: [_jsx("td", { children: String(row.name ?? '-') }), _jsx("td", { children: String(row.type ?? '-') }), _jsx("td", { children: formatBytes(size) }), _jsx("td", { children: formatBytes(used) }), _jsx("td", { children: formatBytes(free) }), _jsxs("td", { children: [usedPercent.toFixed(2), "%"] })] }, `${row.name}-${row.type}-${size}`));
                                                    }) : (_jsx("tr", { children: _jsx("td", { colSpan: 6, children: "No drive capacity metrics returned" }) })) })] }) }), _jsxs("div", { className: "metric-bars", "aria-label": "Top Databases by Size", children: [_jsx("h4", { children: "Largest Databases by Allocated Size" }), _jsx(MiniBarChart, { data: storageBars, height: 180, color: ["#1c7c54", "#f2c14e", "#38618c"] })] }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8, marginBottom: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Total Allocated Size (MB)" })] }) }), _jsx("tbody", { children: Object.entries(fileSizeByDb).length > 0 ? Object.entries(fileSizeByDb)
                                                        .sort((left, right) => right[1] - left[1])
                                                        .map(([dbName, totalSizeMb]) => (_jsxs("tr", { children: [_jsx("td", { children: dbName }), _jsx("td", { children: formatNumber(totalSizeMb) })] }, dbName))) : (_jsx("tr", { children: _jsx("td", { colSpan: 2, children: "No per-database size metrics returned" }) })) })] }) }), _jsxs("table", { className: "backup-table compact-table", style: { marginTop: 8 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Count" }), _jsx("th", { children: "Total Allocated Size (MB)" }), _jsx("th", { children: "Total Used Space (MB)" }), _jsx("th", { children: "Total Free Space (MB)" })] }) }), _jsx("tbody", { children: _jsxs("tr", { children: [_jsx("td", { children: formatNumber(Object.keys(fileSizeByDb).length) }), _jsx("td", { children: formatNumber(storageTotals.allocatedMb) }), _jsx("td", { children: formatNumber(storageTotals.usedMb) }), _jsx("td", { children: formatNumber(storageTotals.freeMb) })] }) })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Database Total Size (MB)" }), _jsx("th", { children: "File Type" }), _jsx("th", { children: "Logical File Name" }), _jsx("th", { children: "File Size (MB)" }), _jsx("th", { children: "Used Space (MB)" }), _jsx("th", { children: "Free Space (MB)" })] }) }), _jsx("tbody", { children: files.length > 0 ? files.slice(0, 20).map((row) => (_jsxs("tr", { children: [_jsx("td", { children: String(row.database_name ?? '-') }), _jsx("td", { children: formatNumber(fileSizeByDb[String(row.database_name ?? '(unknown)')] ?? 0) }), _jsx("td", { children: String(row.type_desc ?? '-') }), _jsx("td", { title: String(row.logical_name ?? ''), children: shortText(row.logical_name, 24) }), _jsx("td", { children: formatNumber(row.file_size_mb) }), _jsx("td", { children: formatNumber(row.used_mb) }), _jsx("td", { children: formatNumber(row.free_mb) })] }, `${row.database_name}-${row.logical_name}-${row.type_desc}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No database file metrics returned" }) })) })] }) }), tempdb && (_jsxs("table", { className: "backup-table compact-table", style: { marginTop: 8 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "TempDB User MB" }), _jsx("th", { children: "TempDB Internal MB" }), _jsx("th", { children: "Version Store MB" }), _jsx("th", { children: "Free MB" })] }) }), _jsx("tbody", { children: _jsxs("tr", { children: [_jsx("td", { children: formatNumber(tempdb.user_object_mb) }), _jsx("td", { children: formatNumber(tempdb.internal_object_mb) }), _jsx("td", { children: formatNumber(tempdb.version_store_mb) }), _jsx("td", { children: formatNumber(tempdb.free_space_mb) })] }) })] }))] })), selectedTopic === 'sessions' && !showHistoryView.topic && (_jsxs(MetricCard, { title: "Session Activity & Control", titleProps: { title: 'Session count by host and application.' }, children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('sessions'), children: "History View" }), _jsxs("div", { className: "metric-bars", "aria-label": "Session Distribution", children: [_jsx("h4", { children: "Session Distribution by Workload Source" }), _jsx(MiniBarChart, { data: sessionBars, height: 180, color: ["#38618c", "#1c7c54"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Session ID" }), _jsx("th", { children: "Host Name" }), _jsx("th", { children: "Application Name" }), _jsx("th", { children: "Session Status" }), _jsx("th", { children: "Database Name" }), _jsx("th", { children: "Action" })] }) }), _jsx("tbody", { children: sessions.length > 0 ? sessions.map((row) => (_jsx("tr", { children: (() => {
                                                            const sessionId = toNumber(row.session_id);
                                                            const isProtectedSession = sessionId <= 50;
                                                            const isKilling = killingSessionId === sessionId;
                                                            return (_jsxs(Fragment, { children: [_jsx("td", { children: formatNumber(row.session_id) }), _jsx("td", { title: String(row.host_name ?? ''), children: shortText(row.host_name, 22) }), _jsx("td", { title: String(row.program_name ?? ''), children: shortText(row.program_name, 34) }), _jsx("td", { children: String(row.status ?? '-') }), _jsx("td", { children: String(row.database_name ?? '-') }), _jsx("td", { children: _jsx("button", { type: "button", onClick: () => void handleKillSession(sessionId), disabled: isKilling || !selectedTargetId || isProtectedSession, style: { color: '#b42318' }, title: isProtectedSession ? 'Protected system session' : `Kill session ${sessionId}`, children: isProtectedSession ? 'Protected' : isKilling ? 'Killing...' : 'KILL' }) })] }));
                                                        })() }, `${row.session_id}-${row.host_name}-${row.program_name}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 6, children: "No active session metadata returned" }) })) })] }) })] })), selectedTopic === 'queries' && !showHistoryView.topic && (_jsxs(MetricCard, { title: "Query Performance Analysis", titleProps: { title: 'Top queries by elapsed time.' }, children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('queries'), children: "History View" }), _jsxs("div", { className: "metric-bars", "aria-label": "Average Elapsed Time", children: [_jsx("h4", { children: "Average Elapsed Time by Query Pattern" }), _jsx(MiniBarChart, { data: queryBars, height: 180, color: ["#d95d39", "#38618c"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Execution Count" }), _jsx("th", { children: "Average Elapsed (ms)" }), _jsx("th", { children: "Total Logical Reads" }), _jsx("th", { children: "Query Text" })] }) }), _jsx("tbody", { children: queries.length > 0 ? queries.map((row, index) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.execution_count) }), _jsx("td", { children: formatNumber(row.avg_elapsed_ms) }), _jsx("td", { children: formatNumber(row.total_logical_reads) }), _jsxs("td", { title: String(row.query_text ?? ''), children: [shortText(row.query_text, 80), String(row.query_text ?? '') && (_jsx("button", { style: { marginLeft: 8 }, onClick: () => void handleCopyText(`query-${index}`, String(row.query_text ?? '')), children: copiedKey === `query-${index}` ? 'Copied' : 'Copy' }))] })] }, `${row.query_text}-${index}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No query performance statistics returned" }) })) })] }) }), showLongRunningQueryWindow && (_jsxs("section", { className: "backup-window backup-window-secondary", style: { marginTop: 10 }, children: [_jsxs("div", { className: "backup-window-header", children: [_jsxs("div", { children: [_jsx("h4", { children: "Long Running Queries (Detailed Window)" }), _jsx("p", { children: "Showing queries with average elapsed time greater than or equal to 5,000 ms." })] }), _jsxs("div", { className: "snapshot-actions", style: { justifyContent: 'flex-end' }, children: [_jsx("button", { type: "button", onClick: () => setLongRunningSortKey('running'), className: longRunningSortKey === 'running' ? 'btn-on' : 'btn-off', children: "Sort: Running Time" }), _jsx("button", { type: "button", onClick: () => setLongRunningSortKey('start'), className: longRunningSortKey === 'start' ? 'btn-on' : 'btn-off', children: "Sort: Start Time" }), _jsx("button", { type: "button", onClick: () => setLongRunningSortKey('session'), className: longRunningSortKey === 'session' ? 'btn-on' : 'btn-off', children: "Sort: Session ID" }), _jsxs("button", { type: "button", className: longRunningSortOrder === 'asc' ? 'btn-on' : 'btn-off', onClick: () => setLongRunningSortOrder((current) => current === 'asc' ? 'desc' : 'asc'), children: ["Order: ", longRunningSortOrder.toUpperCase()] }), _jsx("button", { type: "button", onClick: () => setShowLongRunningQueryWindow(false), children: "Close Window" })] })] }), _jsx("div", { className: "metric-scroll", style: { maxHeight: 300 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Session ID" }), _jsx("th", { children: "Program Name" }), _jsx("th", { children: "User / Login" }), _jsx("th", { children: "Host Name" }), _jsx("th", { children: "Start Time" }), _jsx("th", { children: "Running Duration" }), _jsx("th", { children: "Query Text (Full)" })] }) }), _jsx("tbody", { children: longRunningQueries.length > 0 ? longRunningQueries.map((row, index) => (_jsxs("tr", { children: [_jsx("td", { children: row.sessionId }), _jsx("td", { title: row.programName, children: shortText(row.programName, 28) }), _jsx("td", { title: row.loginName, children: shortText(row.loginName, 24) }), _jsx("td", { title: row.hostName, children: shortText(row.hostName, 24) }), _jsx("td", { children: row.startTime }), _jsx("td", { children: row.runningFor }), _jsxs("td", { children: [_jsx("pre", { className: "snapshot-json", style: { marginTop: 0, maxHeight: 180 }, children: row.queryText }), row.queryText && row.queryText !== '-' && (_jsx("button", { style: { marginTop: 6 }, onClick: () => void handleCopyText(`long-running-${index}`, row.queryText), children: copiedKey === `long-running-${index}` ? 'Copied' : 'Copy Full Query' }))] })] }, `long-running-${index}-${row.sessionId}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No long running queries found for current dataset." }) })) })] }) })] })), _jsxs("div", { className: "snapshot-actions", style: { marginTop: 10 }, children: [_jsx("button", { type: "button", onClick: () => setShowLongRunningQueryWindow((current) => !current), children: showLongRunningQueryWindow ? 'Hide Long Running Window' : `Open Long Running Window (${longRunningQueries.length})` }), _jsx("span", { style: { alignSelf: 'center', fontSize: 12, opacity: 0.85 }, children: "Threshold: Avg elapsed >= 5,000 ms" })] })] })), selectedTopic === 'alerts' && !showHistoryView.topic && (_jsxs(MetricCard, { title: "Operational Alerts & Incidents", titleProps: { title: 'Blocking chains and failed SQL Agent jobs.' }, children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('alerts'), children: "History View" }), _jsxs("div", { className: "alert-overview", children: [_jsxs("span", { className: String(alerts.severity) === 'high' ? 'backup-stale' : 'backup-ok', children: ["Severity: ", String(alerts.severity ?? 'normal').toUpperCase()] }), _jsxs("span", { children: ["Blocking: ", blocking.length] }), _jsxs("span", { children: ["Failed Jobs: ", failedJobs.length] })] }), _jsxs("div", { className: "metric-bars", "aria-label": "Blocking Wait Time", children: [_jsx("h4", { children: "Blocking Duration by Session" }), _jsx(MiniBarChart, { data: blocking.slice(0, 8).map((row) => ({
                                                    label: `SPID ${String(row.session_id ?? '-')}`,
                                                    value: toNumber(row.wait_time),
                                                    suffix: ' ms'
                                                })), height: 120, color: ["#d95d39", "#38618c"] })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Session ID" }), _jsx("th", { children: "Blocked By (Session ID)" }), _jsx("th", { children: "Session Status" }), _jsx("th", { children: "Wait Category" }), _jsx("th", { children: "Wait Time (ms)" })] }) }), _jsx("tbody", { children: blocking.length > 0 ? blocking.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: formatNumber(row.session_id) }), _jsx("td", { children: formatNumber(row.blocking_session_id) }), _jsx("td", { children: String(row.status ?? '-') }), _jsx("td", { children: String(row.wait_type ?? '-') }), _jsx("td", { children: formatNumber(row.wait_time) })] }, `${row.session_id}-${row.blocking_session_id}-${row.wait_time}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "No active blocking chains detected" }) })) })] }) }), _jsx("div", { className: "metric-scroll", style: { marginTop: 8 }, children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "SQL Agent Job Name" }), _jsx("th", { children: "Run Date" }), _jsx("th", { children: "Run Time" }), _jsx("th", { children: "Error Message" })] }) }), _jsx("tbody", { children: failedJobs.length > 0 ? failedJobs.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: String(row.job_name ?? '-') }), _jsx("td", { children: String(row.run_date ?? '-') }), _jsx("td", { children: String(row.run_time ?? '-') }), _jsx("td", { title: String(row.error_message ?? ''), children: shortText(row.error_message, 110) })] }, `${row.job_name}-${row.run_date}-${row.run_time}`))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No failed SQL Agent jobs detected" }) })) })] }) })] })), selectedTopic === 'backups' && !showHistoryView.topic && (_jsxs(MetricCard, { title: "Backup Compliance Status", children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('backups'), children: "History View" }), _jsxs("div", { className: "backup-pane-layout", children: [_jsxs("section", { className: "backup-window", children: [_jsxs("div", { className: "backup-window-header", children: [_jsxs("div", { children: [_jsx("h4", { children: "Databases with Backup Policy Violations" }), _jsxs("p", { children: [failedBackups.length, " failed database backup", failedBackups.length === 1 ? '' : 's', " and ", successfulBackups.length, " successful database backup", successfulBackups.length === 1 ? '' : 's', "."] })] }), _jsx("button", { type: "button", onClick: () => setShowSuccessBackups(true), disabled: showSuccessBackups || successfulBackups.length === 0, children: "Show Compliant Backup Details" })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Last Full Backup" }), _jsx("th", { children: "Last Differential Backup" }), _jsx("th", { children: "Last Log Backup" })] }) }), _jsxs("tbody", { children: [data.backups.length > 0 ? failedBackups.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { className: getBackupStatusClass(row.last_full_backup, 'full'), title: getBackupStalenessTooltip(row.last_full_backup), children: row.last_full_backup ? new Date(row.last_full_backup).toLocaleString() : '-' }), _jsx("td", { className: getBackupStatusClass(row.last_diff_backup, 'diff'), title: getBackupStalenessTooltip(row.last_diff_backup), children: row.last_diff_backup ? new Date(row.last_diff_backup).toLocaleString() : '-' }), _jsx("td", { className: getBackupStatusClass(row.last_log_backup, 'log'), title: getBackupStalenessTooltip(row.last_log_backup), children: row.last_log_backup ? new Date(row.last_log_backup).toLocaleString() : '-' })] }, row.database_name))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No backup metadata returned" }) })), data.backups.length > 0 && failedBackups.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No backup policy violations detected" }) }))] })] }) })] }), showSuccessBackups && (_jsxs("section", { className: "backup-window backup-window-secondary", children: [_jsxs("div", { className: "backup-window-header", children: [_jsxs("div", { children: [_jsx("h4", { children: "Databases Meeting Backup Policy" }), _jsxs("p", { children: [successfulBackups.length, " databases with a recorded successful full backup."] })] }), _jsx("button", { type: "button", onClick: () => setShowSuccessBackups(false), children: "Close Window" })] }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Last Full Backup" }), _jsx("th", { children: "Last Differential Backup" }), _jsx("th", { children: "Last Log Backup" })] }) }), _jsx("tbody", { children: successfulBackups.length > 0 ? successfulBackups.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { className: getBackupStatusClass(row.last_full_backup, 'full'), title: getBackupStalenessTooltip(row.last_full_backup), children: row.last_full_backup ? new Date(row.last_full_backup).toLocaleString() : '-' }), _jsx("td", { className: getBackupStatusClass(row.last_diff_backup, 'diff'), title: getBackupStalenessTooltip(row.last_diff_backup), children: row.last_diff_backup ? new Date(row.last_diff_backup).toLocaleString() : '-' }), _jsx("td", { className: getBackupStatusClass(row.last_log_backup, 'log'), title: getBackupStalenessTooltip(row.last_log_backup), children: row.last_log_backup ? new Date(row.last_log_backup).toLocaleString() : '-' })] }, row.database_name))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No compliant backup entries found" }) })) })] }) })] }))] })] })), selectedTopic === 'ple' && !showHistoryView.topic && (_jsxs(MetricCard, { title: "Buffer Cache Page Life Expectancy", titleProps: { title: 'PLE values by NUMA node and recent trend.' }, children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('ple'), children: "History View" }), _jsxs("div", { className: "metric-bars", "aria-label": "PLE Trend", children: [_jsx("h4", { children: "Recent PLE Trend (24h)" }), _jsx(MiniBarChart, { data: pleHourlyBars, height: 180, color: ["#38618c", "#f2c14e"] })] }), pleData.length > 1 && (_jsxs("div", { style: { background: '#fffbe6', color: '#ad6800', padding: '10px', borderRadius: 6, margin: '12px 0', fontSize: 15 }, children: [_jsx("b", { children: "Multiple NUMA nodes detected:" }), " PLE should be monitored ", _jsx("b", { children: "per NUMA node" }), ".", _jsx("br", {}), "Low PLE values (< 300 sec) on any node may indicate memory pressure. The ", _jsx("b", { children: "_Total" }), " value is not always representative in multi-NUMA systems."] })), pleData.length === 1 && pleData[0].node_name === '_Total' && (_jsxs("div", { style: { background: '#e6f7ff', color: '#0050b3', padding: '10px', borderRadius: 6, margin: '12px 0', fontSize: 15 }, children: [_jsx("b", { children: "Single NUMA node or legacy hardware:" }), " Only the ", _jsx("b", { children: "_Total" }), " PLE is available.", _jsx("br", {}), "Low PLE values (< 300 sec) may indicate memory pressure."] })), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "NUMA Node Name" }), _jsx("th", { children: "Page Life Expectancy (sec)" }), _jsx("th", { children: "Status" })] }) }), _jsx("tbody", { children: pleData.length > 0 ? pleData.map((row, idx) => {
                                                        const ple = Number(row.page_life_expectancy);
                                                        let status = 'OK';
                                                        let statusClass = '';
                                                        if (ple < 300) {
                                                            status = 'LOW';
                                                            statusClass = 'backup-stale';
                                                        }
                                                        else if (ple < 1000) {
                                                            status = 'Warning';
                                                            statusClass = 'backup-warning';
                                                        }
                                                        else {
                                                            status = 'Healthy';
                                                            statusClass = 'backup-ok';
                                                        }
                                                        return (_jsxs("tr", { children: [_jsx("td", { children: String(row.node_name ?? '-') }), _jsx("td", { children: ple }), _jsx("td", { className: statusClass, children: status })] }, row.node_name || idx));
                                                    }) : (_jsx("tr", { children: _jsx("td", { colSpan: 3, children: "No PLE metrics returned" }) })) })] }) })] })), selectedTopic === 'suggestions' && !showHistoryView.topic && (_jsxs(_Fragment, { children: [_jsxs(MetricCard, { title: "Missing Index Recommendations", titleProps: { title: 'Indexes that should be created for better performance.' }, children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('suggestions'), children: "History View" }), _jsx("div", { className: "metric-bars", style: { marginBottom: 16 }, children: _jsx(MiniBarChart, { data: suggestionsData.missingIndexes.map((row, idx) => ({
                                                        label: row.table_name || `Table ${idx + 1}`,
                                                        value: Number(row.impact) || 0
                                                    })), height: 180, color: ["#d95d39", "#38618c"] }) }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Table Name" }), _jsx("th", { children: "Equality Columns" }), _jsx("th", { children: "Inequality Columns" }), _jsx("th", { children: "Included Columns" }), _jsx("th", { children: "Estimated Impact" }), _jsx("th", { children: "CREATE INDEX Statement" })] }) }), _jsx("tbody", { children: suggestionsData.missingIndexes.length > 0 ? suggestionsData.missingIndexes.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.table_name }), _jsx("td", { children: row.equality_columns }), _jsx("td", { children: row.inequality_columns }), _jsx("td", { children: row.included_columns }), _jsx("td", { children: row.impact }), _jsxs("td", { children: [_jsx("code", { style: { fontSize: '0.85em' }, children: row.create_statement }), _jsx("button", { style: { marginLeft: 8 }, onClick: () => void handleCopyText(`create-${idx}`, String(row.create_statement ?? '')), children: copiedKey === `create-${idx}` ? 'Copied' : 'Copy' })] })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No missing index recommendations returned" }) })) })] }) })] }), _jsxs(MetricCard, { title: "Fragmented Indexes (>20%)", titleProps: { title: 'Indexes with high fragmentation that should be rebuilt.' }, children: [_jsx("div", { className: "metric-bars", style: { marginBottom: 16 }, children: _jsx(MiniBarChart, { data: suggestionsData.fragmentedIndexes.map((row, idx) => ({
                                                        label: row.index_name || `Index ${idx + 1}`,
                                                        value: Number(row.avg_fragmentation_in_percent) || 0
                                                    })), height: 180, color: ["#f2c14e", "#d95d39"] }) }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Table Name" }), _jsx("th", { children: "Index Name" }), _jsx("th", { children: "Fragmentation (%)" }), _jsx("th", { children: "ALTER INDEX Statement" })] }) }), _jsx("tbody", { children: suggestionsData.fragmentedIndexes.length > 0 ? suggestionsData.fragmentedIndexes.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.table_name }), _jsx("td", { children: row.index_name }), _jsx("td", { children: row.avg_fragmentation_in_percent }), _jsxs("td", { children: [_jsx("code", { style: { fontSize: '0.85em' }, children: row.alter_statement }), _jsx("button", { style: { marginLeft: 8 }, onClick: () => void handleCopyText(`alter-${idx}`, String(row.alter_statement ?? '')), children: copiedKey === `alter-${idx}` ? 'Copied' : 'Copy' })] })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 5, children: "No indexes above 20% fragmentation threshold" }) })) })] }) })] })] })), selectedTopic === 'history' && !showHistoryView.topic && (_jsxs("section", { className: "ai-panel", style: { marginTop: 0 }, children: [_jsxs("div", { className: "ai-title-row", children: [_jsx("h2", { children: "Monitoring Snapshot Audit Trail (DBA Repository)" }), _jsxs("div", { className: "snapshot-actions", children: [_jsx("button", { onClick: startHistorySearch, disabled: historyLoading, children: historyLoading ? 'Loading...' : 'Load History' }), renderExportMenu('audit-history', true)] })] }), _jsxs("div", { className: "hero-row", style: { marginTop: 8 }, children: [_jsx("input", { type: "datetime-local", value: historyFrom, onChange: (e) => setHistoryFrom(e.target.value) }), _jsx("input", { type: "datetime-local", value: historyTo, onChange: (e) => setHistoryTo(e.target.value) }), _jsx("input", { type: "number", min: 5, max: 500, value: historyLimit, onChange: (e) => setHistoryLimit(Math.min(500, Math.max(5, Number.parseInt(e.target.value, 10) || 25))), title: "Rows per page" }), _jsxs("label", { className: "target-checkbox", style: { marginLeft: 8 }, children: [_jsx("input", { type: "checkbox", checked: historyAuditOnly, onChange: (e) => {
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
                                                }, disabled: historyLoading, style: { fontWeight: historyAuditOnly && historyAuditOutcome === 'attempted' ? 700 : 400 }, children: "Attempted Outcomes" }), _jsx("button", { type: "button", onClick: () => {
                                                    setHistoryAuditOnly(true);
                                                    setHistoryAuditOutcome('succeeded');
                                                }, disabled: historyLoading, style: { fontWeight: historyAuditOnly && historyAuditOutcome === 'succeeded' ? 700 : 400 }, children: "Successful Outcomes" }), _jsx("button", { type: "button", onClick: () => {
                                                    setHistoryAuditOnly(true);
                                                    setHistoryAuditOutcome('failed');
                                                }, disabled: historyLoading, style: { fontWeight: historyAuditOnly && historyAuditOutcome === 'failed' ? 700 : 400 }, children: "Failed Outcomes" })] }), _jsxs("table", { className: "backup-table", style: { marginTop: 12 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Snapshot ID" }), _jsx("th", { children: "Captured At" }), _jsx("th", { children: "Target Instance" }), _jsx("th", { children: "Event" }), _jsx("th", { children: "Health Summary" }), _jsx("th", { children: "Alert Summary" }), _jsx("th", { children: "Details" })] }) }), _jsx("tbody", { children: historyRows.length > 0 ? (historyRows.map((row) => (_jsxs(Fragment, { children: [_jsxs("tr", { children: [_jsx("td", { children: row.id }), _jsx("td", { children: new Date(row.capturedAt).toLocaleString() }), _jsx("td", { children: row.targetId }), _jsx("td", { children: _jsx("span", { className: getHistoryEventClassName(row), children: formatHistoryEvent(row) }) }), _jsxs("td", { title: JSON.stringify(row.health), children: [JSON.stringify(row.health).slice(0, 80), JSON.stringify(row.health).length > 80 ? 'ΓÇª' : ''] }), _jsxs("td", { title: JSON.stringify(row.alerts), children: [JSON.stringify(row.alerts).slice(0, 80), JSON.stringify(row.alerts).length > 80 ? 'ΓÇª' : ''] }), _jsx("td", { children: _jsx("button", { type: "button", onClick: () => setExpandedSnapshotId((current) => current === row.id ? null : row.id), children: expandedSnapshotId === row.id ? 'Hide Detail' : 'View Detail' }) })] }), expandedSnapshotId === row.id && (_jsx("tr", { children: _jsxs("td", { colSpan: 7, children: [_jsx("div", { className: "snapshot-actions", style: { marginBottom: 8 }, children: _jsx("button", { type: "button", onClick: () => void copySnapshotJson(row), children: "Copy JSON" }) }), _jsx("pre", { className: "snapshot-json", children: JSON.stringify(row, null, 2) })] }) }))] }, row.id)))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: historyAuditOnly ? 'No session-kill audit events found for the selected outcome' : 'No snapshots found' }) })) })] }), _jsxs("div", { className: "history-pagination", children: [_jsx("button", { type: "button", disabled: !canGoPrev || historyLoading, onClick: () => void loadSnapshotHistory(Math.max(0, historyOffset - historyLimit)), children: "Previous Page" }), _jsxs("span", { children: ["Showing ", historyRows.length === 0 ? 0 : historyOffset + 1, "-", historyOffset + historyRows.length, " of ", historyTotal, historyAuditOnly ? ` (filtered: ${historyRows.length}${historyAuditOutcome !== 'all' ? `, outcome: ${historyAuditOutcome}` : ''})` : ''] }), _jsx("button", { type: "button", disabled: !canGoNext || historyLoading, onClick: () => void loadSnapshotHistory(historyOffset + historyLimit), children: "Next Page" })] })] })), selectedTopic === 'security' && !showHistoryView.topic && (_jsxs("section", { className: "ai-panel", children: [_jsx("button", { className: "history-btn", style: { position: 'absolute', top: 16, right: 24, zIndex: 2 }, onClick: () => openHistoryView('security'), children: "History View" }), _jsxs("div", { className: "panel-title-row", children: [_jsx("h2", { children: "Security, Principals & Privilege Posture" }), _jsx("button", { onClick: () => {
                                                    if (selectedTargetId) {
                                                        void loadSecurityForTarget(selectedTargetId);
                                                    }
                                                }, disabled: securityLoading, children: securityLoading ? 'Loading...' : 'Refresh Security Telemetry' })] }), securityLoading && _jsx("p", { children: "Loading security telemetry..." }), !securityLoading && !securityData && _jsx("p", { children: "Security data unavailable. Click Refresh to load." }), securityData && (_jsxs(_Fragment, { children: [_jsx("h3", { style: { marginTop: 16 }, children: "SQL Server Logins" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Login Name" }), _jsx("th", { children: "Login Type" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Password Policy" }), _jsx("th", { children: "Password Expiration" }), _jsx("th", { children: "Default Database" }), _jsx("th", { children: "Server Roles" }), _jsx("th", { children: "Created" }), _jsx("th", { children: "Last Modified" })] }) }), _jsx("tbody", { children: securityData.serverLogins.length > 0 ? securityData.serverLogins.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.login_name }), _jsx("td", { children: row.login_type.replace(/_/g, ' ') }), _jsx("td", { children: _jsx("span", { className: row.is_disabled ? 'status-warn' : 'status-ok', children: row.is_disabled ? 'Disabled' : 'Enabled' }) }), _jsx("td", { children: row.is_policy_checked ? 'Enforced' : 'Not Enforced' }), _jsx("td", { children: row.is_expiration_checked ? 'Enforced' : 'Not Enforced' }), _jsx("td", { children: row.default_database }), _jsx("td", { children: row.server_roles || '(none)' }), _jsx("td", { children: row.create_date }), _jsx("td", { children: row.modify_date })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 9, children: "No SQL Server logins found" }) })) })] }) }), _jsx("h3", { style: { marginTop: 20 }, children: "Server-Level Role Memberships" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Server Role" }), _jsx("th", { children: "Member Login" }), _jsx("th", { children: "Member Type" }), _jsx("th", { children: "Member Status" })] }) }), _jsx("tbody", { children: securityData.serverRoles.length > 0 ? securityData.serverRoles.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.role_name }), _jsx("td", { children: row.member_name }), _jsx("td", { children: row.member_type.replace(/_/g, ' ') }), _jsx("td", { children: _jsx("span", { className: row.is_member_disabled ? 'status-warn' : 'status-ok', children: row.is_member_disabled ? 'Disabled' : 'Active' }) })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No server role memberships found" }) })) })] }) }), _jsx("h3", { style: { marginTop: 20 }, children: "Database Principals" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Principal Name" }), _jsx("th", { children: "Principal Type" }), _jsx("th", { children: "Mapped Login" }), _jsx("th", { children: "Default Schema" }), _jsx("th", { children: "Database Roles" }), _jsx("th", { children: "Created" })] }) }), _jsx("tbody", { children: securityData.dbUsers.length > 0 ? securityData.dbUsers.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.user_name }), _jsx("td", { children: row.user_type.replace(/_/g, ' ') }), _jsx("td", { children: row.login_name || '(none)' }), _jsx("td", { children: row.default_schema }), _jsx("td", { children: row.db_roles || '(none)' }), _jsx("td", { children: row.create_date })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No database users found" }) })) })] }) }), _jsx("h3", { style: { marginTop: 20 }, children: "Database Role Memberships" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Database Role" }), _jsx("th", { children: "Member Name" }), _jsx("th", { children: "Member Type" })] }) }), _jsx("tbody", { children: securityData.dbRoles.length > 0 ? securityData.dbRoles.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.role_name }), _jsx("td", { children: row.member_name }), _jsx("td", { children: row.member_type.replace(/_/g, ' ') })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No database role memberships found" }) })) })] }) }), _jsx("h3", { style: { marginTop: 20 }, children: "Explicit Object-Level Permissions" }), _jsx("div", { className: "metric-scroll", children: _jsxs("table", { className: "backup-table compact-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Database Name" }), _jsx("th", { children: "Principal Name" }), _jsx("th", { children: "Principal Type" }), _jsx("th", { children: "Object Name" }), _jsx("th", { children: "Object Type" }), _jsx("th", { children: "Permission" }), _jsx("th", { children: "Grant State" })] }) }), _jsx("tbody", { children: securityData.objectPermissions.length > 0 ? securityData.objectPermissions.map((row, idx) => (_jsxs("tr", { children: [_jsx("td", { children: row.database_name }), _jsx("td", { children: row.principal_name }), _jsx("td", { children: row.principal_type.replace(/_/g, ' ') }), _jsx("td", { children: row.object_name || '(database)' }), _jsx("td", { children: row.object_type.replace(/_/g, ' ') }), _jsx("td", { children: row.permission_name }), _jsx("td", { children: _jsx("span", { className: row.permission_state === 'DENY' ? 'status-critical' : 'status-ok', children: row.permission_state }) })] }, idx))) : (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: "No explicit object permissions found" }) })) })] }) })] }))] }))] })] }))] }));
};
