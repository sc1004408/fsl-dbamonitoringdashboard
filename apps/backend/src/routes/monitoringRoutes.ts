import { Router } from 'express';
import { z } from 'zod';
import { monitoringService, pleAndSuggestionsService, securityService } from '../services/monitoringService';
import { aiService } from '../services/aiService';
import { addTarget, listTargets, selectTarget, updateTarget, deleteTarget } from '../services/db';
import { getAllDashboardSnapshots, getDashboardSnapshots, getMonitoringTableStats, saveDashboardSnapshot } from '../services/snapshotService';

export const monitoringRouter = Router();

// Register new endpoints after router declaration
monitoringRouter.get('/ple', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await pleAndSuggestionsService.ple(targetId));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/suggestions', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await pleAndSuggestionsService.suggestions(targetId));
  } catch (error) {
    next(error);
  }
});

const getTargetId = (targetId: unknown): string | undefined =>
  typeof targetId === 'string' && targetId.length > 0 ? targetId : undefined;

const connectionFieldsSchema = z.object({
  server: z.string().min(1),
  port: z.coerce.number().int().positive(),
  database: z.string().min(1),
  userId: z.string().min(1),
  password: z.string().min(1),
  encrypt: z.boolean(),
  trustServerCertificate: z.boolean()
});

const addTargetSchema = z.object({
  name: z.string().min(1),
  connection: connectionFieldsSchema
});

const selectTargetSchema = z.object({
  targetId: z.string().min(1)
});

const killSessionSchema = z.object({
  targetId: z.string().optional()
});

const updateTargetSchema = z.object({
  name: z.string().min(1).optional(),
  connection: connectionFieldsSchema.optional()
}).refine((value) => Boolean(value.name || value.connection), {
  message: 'At least one update field is required'
});

const snapshotQuerySchema = z.object({
  targetId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const snapshotExportQuerySchema = z.object({
  targetId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'csv']).default('json')
});

const toCsvCell = (value: unknown): string => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const escaped = String(raw ?? '').replace(/"/g, '""');
  return `"${escaped}"`;
};

const writeSessionKillAudit = async (
  targetId: string,
  sessionId: number,
  outcome: 'attempted' | 'succeeded' | 'failed',
  detail?: string,
) => {
  try {
    await saveDashboardSnapshot({
      capturedAt: new Date().toISOString(),
      targetId,
      health: {
        status: 'audit',
        eventType: 'kill-session',
        outcome,
        sessionId,
        detail: detail ?? null
      },
      performance: {},
      storage: {},
      sessions: {},
      queries: {},
      alerts: {
        severity: outcome === 'failed' ? 'high' : 'normal',
        audit: true
      },
      backups: {}
    });
  } catch {
    // Audit persistence must not block operational routes.
  }
};

monitoringRouter.post('/snapshots', async (req, res, next) => {
  try {
    const { targetId, health, performance, storage, sessions, queries, alerts, backups } = req.body;
    if (!targetId) {
      res.status(400).json({ error: 'targetId is required' });
      return;
    }
    await saveDashboardSnapshot({
      capturedAt: new Date().toISOString(),
      targetId,
      health,
      performance,
      storage,
      sessions,
      queries,
      alerts,
      backups
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/snapshots', async (req, res, next) => {
  try {
    const query = snapshotQuerySchema.parse(req.query);
    const snapshots = await getDashboardSnapshots({
      targetId: query.targetId,
      from: query.from,
      to: query.to,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0
    });
    res.json(snapshots);
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/snapshots/export', async (req, res, next) => {
  try {
    const query = snapshotExportQuerySchema.parse(req.query);
    const rows = await getAllDashboardSnapshots({
      targetId: query.targetId,
      from: query.from,
      to: query.to
    });

    if (query.format === 'csv') {
      const headers = ['id', 'capturedAt', 'targetId', 'health', 'performance', 'storage', 'sessions', 'queries', 'alerts', 'backups'];
      const lines = rows.map((row) => [
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
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dashboard-snapshots.csv"');
      res.send(csv);
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dashboard-snapshots.json"');
    res.send(JSON.stringify(rows, null, 2));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/admin/monitoring-stats', async (_req, res, next) => {
  try {
    res.json(await getMonitoringTableStats());
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/security', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await securityService.security(targetId));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/targets', async (_req, res, next) => {
  try {
    res.json(await listTargets());
  } catch (error) {
    next(error);
  }
});

monitoringRouter.post('/targets', async (req, res, next) => {
  try {
    const body = addTargetSchema.parse(req.body);
    const target = await addTarget(body.name, body.connection);
    res.status(201).json(target);
  } catch (error) {
    next(error);
  }
});

monitoringRouter.post('/targets/select', async (req, res, next) => {
  try {
    const body = selectTargetSchema.parse(req.body);
    await selectTarget(body.targetId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

monitoringRouter.put('/targets/:targetId', async (req, res, next) => {
  try {
    const targetId = req.params.targetId;
    const body = updateTargetSchema.parse(req.body);
    const target = await updateTarget(targetId, {
      name: body.name,
      connection: body.connection
    });
    res.json(target);
  } catch (error) {
    next(error);
  }
});

monitoringRouter.delete('/targets/:targetId', async (req, res, next) => {
  try {
    const targetId = req.params.targetId;
    await deleteTarget(targetId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/health', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await monitoringService.health(targetId));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/performance', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await monitoringService.performance(targetId));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/storage', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await monitoringService.storage(targetId));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/sessions', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await monitoringService.sessions(targetId));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.post('/sessions/:sessionId/kill', async (req, res, next) => {
  try {
    const sessionId = Number.parseInt(req.params.sessionId, 10);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      res.status(400).json({ error: 'Invalid session id' });
      return;
    }

    const body = killSessionSchema.parse(req.body ?? {});
    const targetId = getTargetId(body.targetId) ?? 'default';

    await writeSessionKillAudit(targetId, sessionId, 'attempted');
    const killResult = await monitoringService.killSession(sessionId, targetId);
    await writeSessionKillAudit(
      targetId,
      sessionId,
      'succeeded',
      `login=${killResult.loginName ?? '(unknown)'}, host=${killResult.hostName ?? '(unknown)'}`
    );

    res.status(204).send();
  } catch (error) {
    const sessionId = Number.parseInt(req.params.sessionId, 10);
    const targetId = getTargetId((req.body as { targetId?: string } | undefined)?.targetId) ?? 'default';
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (Number.isInteger(sessionId) && sessionId > 0) {
      await writeSessionKillAudit(targetId, sessionId, 'failed', message);
    }
    next(error);
  }
});

monitoringRouter.get('/queries', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await monitoringService.topQueries(targetId));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/alerts', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await monitoringService.alerts(targetId));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/backups', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    res.json(await monitoringService.backups(targetId));
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/ai/insights', async (req, res, next) => {
  try {
    const targetId = getTargetId(req.query.targetId);
    const health = await monitoringService.health(targetId);
    const performance = await monitoringService.performance(targetId);
    const storage = await monitoringService.storage(targetId);
    const alerts = await monitoringService.alerts(targetId);

    const summary = await aiService.generateInsights({
      health,
      performance,
      storage,
      alerts
    });

    res.json({ summary, generatedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get('/monitoring-stats', async (_req, res, next) => {
  try {
    const stats = await getMonitoringTableStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});
