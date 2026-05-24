const jsonGet = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API failed for ${url}`);
    }
    return response.json();
};
const jsonPost = async (url, body) => {
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
        return undefined;
    }
    return response.json();
};
const jsonPut = async (url, body) => {
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
    return response.json();
};
const downloadGet = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API failed for ${url}`);
    }
    return response.blob();
};
const withTarget = (path, targetId) => {
    if (!targetId) {
        return path;
    }
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}targetId=${encodeURIComponent(targetId)}`;
};
export const api = {
    ple: (targetId) => jsonGet(withTarget('/api/ple', targetId)),
    suggestions: (targetId) => jsonGet(withTarget('/api/suggestions', targetId)),
    ping: () => jsonGet('/api/ping'),
    listTargets: () => jsonGet('/api/targets'),
    addTarget: (name, connection) => jsonPost('/api/targets', { name, connection }),
    updateTarget: (targetId, payload) => jsonPut(`/api/targets/${encodeURIComponent(targetId)}`, payload),
    selectTarget: (targetId) => jsonPost('/api/targets/select', { targetId }),
    health: (targetId) => jsonGet(withTarget('/api/health', targetId)),
    performance: (targetId) => jsonGet(withTarget('/api/performance', targetId)),
    storage: (targetId) => jsonGet(withTarget('/api/storage', targetId)),
    sessions: (targetId) => jsonGet(withTarget('/api/sessions', targetId)),
    queries: (targetId) => jsonGet(withTarget('/api/queries', targetId)),
    alerts: (targetId) => jsonGet(withTarget('/api/alerts', targetId)),
    killSession: (sessionId, targetId) => jsonPost(`/api/sessions/${encodeURIComponent(String(sessionId))}/kill`, { targetId }),
    aiInsights: (targetId) => jsonGet(withTarget('/api/ai/insights', targetId)),
    backups: (targetId) => jsonGet(withTarget('/api/backups', targetId)),
    saveSnapshot: (snapshot) => jsonPost('/api/snapshots', snapshot),
    listSnapshots: (params) => {
        const search = new URLSearchParams();
        if (params?.targetId)
            search.set('targetId', params.targetId);
        if (params?.from)
            search.set('from', params.from);
        if (params?.to)
            search.set('to', params.to);
        if (params?.limit)
            search.set('limit', String(params.limit));
        if (typeof params?.offset === 'number')
            search.set('offset', String(params.offset));
        const qs = search.toString();
        return jsonGet(`/api/snapshots${qs ? `?${qs}` : ''}`);
    },
    exportSnapshots: (params) => {
        const search = new URLSearchParams();
        if (params?.targetId)
            search.set('targetId', params.targetId);
        if (params?.from)
            search.set('from', params.from);
        if (params?.to)
            search.set('to', params.to);
        search.set('format', params?.format ?? 'json');
        const qs = search.toString();
        return downloadGet(`/api/snapshots/export?${qs}`);
    },
    monitoringStats: () => jsonGet('/api/admin/monitoring-stats'),
    security: (targetId) => jsonGet(withTarget('/api/security', targetId)),
    deleteTarget: (targetId) => fetch(`/api/targets/${encodeURIComponent(targetId)}`, { method: 'DELETE' }).then((res) => {
        if (!res.ok)
            throw new Error('Failed to delete target');
    }),
};
