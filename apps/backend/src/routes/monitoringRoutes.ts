import { Router } from 'express';
import jwt from 'jsonwebtoken';
import sql from 'mssql';
import { z } from 'zod';
import XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { monitoringService, pleAndSuggestionsService, securityService } from '../services/monitoringService';
import { aiService } from '../services/aiService';
import { addTarget, deleteTarget, getPool, listTargets, selectTarget, updateTarget } from '../services/db';
import { getAllDashboardSnapshots, getDashboardSnapshots, getMonitoringTableStats, saveDashboardSnapshot } from '../services/snapshotService';
import { checkRole, requireAuth, type RequestWithUser } from '../middleware/errorHandler';
import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { getPresenceByUserId, markPresenceClosed, markPresenceHeartbeat } from '../services/presenceService';

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

const getClientTabId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 128) {
    return null;
  }

  return trimmed;
};

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
  format: z.enum(['json', 'csv', 'excel', 'pdf']).default('json')
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const createUserSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1),
  role: z.enum(['admin', 'reader'])
});

type AuthUserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'reader';
};

type AdminUserRow = {
  id: number;
  username: string;
  role: 'admin' | 'reader';
  created_at?: string;
  is_active?: boolean;
  active_tab_count?: number;
  last_active_at?: string | null;
};

const presenceSchema = z.object({
  tabId: z.string().min(8).max(128)
});

const getAuthUserByUsername = async (pool: sql.ConnectionPool, username: string): Promise<AuthUserRow | null> => {
  const candidates = [
    'SELECT TOP 1 id, username, password_hash, role FROM dbo.users WHERE username = @username',
    'SELECT TOP 1 id, username, password_hash, mode AS role FROM dbo.users WHERE username = @username',
    'SELECT TOP 1 id, username, password_hash, user_role AS role FROM dbo.users WHERE username = @username',
    "SELECT TOP 1 id, username, password_hash, 'admin' AS role FROM dbo.users WHERE username = @username"
  ];

  for (const queryText of candidates) {
    try {
      const result = await pool.request()
        .input('username', sql.VarChar(255), username)
        .query<AuthUserRow>(queryText);
      const row = result.recordset[0];
      if (!row) {
        return null;
      }
      return {
        ...row,
        role: row.role === 'reader' ? 'reader' : 'admin'
      };
    } catch {
      // Try next role-column variant.
    }
  }

  return null;
};

const insertUserWithRoleCompatibility = async (
  pool: sql.ConnectionPool,
  username: string,
  passwordHash: string,
  role: 'admin' | 'reader'
): Promise<void> => {
  const candidates = [
    'INSERT INTO dbo.users (username, password_hash, role) VALUES (@username, @password_hash, @role)',
    'INSERT INTO dbo.users (username, password_hash, mode) VALUES (@username, @password_hash, @role)',
    'INSERT INTO dbo.users (username, password_hash, user_role) VALUES (@username, @password_hash, @role)',
    'INSERT INTO dbo.users (username, password_hash) VALUES (@username, @password_hash)'
  ];

  let lastError: unknown = null;
  for (const queryText of candidates) {
    try {
      await pool.request()
        .input('username', sql.VarChar(255), username)
        .input('password_hash', sql.VarChar(255), passwordHash)
        .input('role', sql.VarChar(50), role)
        .query(queryText);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('Unable to insert user');
};

const listUsersWithRoleCompatibility = async (pool: sql.ConnectionPool): Promise<AdminUserRow[]> => {
  const candidates = [
    'SELECT id, username, role, created_at FROM dbo.users ORDER BY id ASC',
    'SELECT id, username, mode AS role, created_at FROM dbo.users ORDER BY id ASC',
    'SELECT id, username, user_role AS role, created_at FROM dbo.users ORDER BY id ASC',
    "SELECT id, username, 'admin' AS role, created_at FROM dbo.users ORDER BY id ASC"
  ];

  for (const queryText of candidates) {
    try {
      const result = await pool.request().query<AdminUserRow>(queryText);
      return result.recordset.map((row) => ({
        ...row,
        role: row.role === 'reader' ? 'reader' : 'admin'
      }));
    } catch {
      // Try next role-column variant.
    }
  }

  return [];
};

const toCsvCell = (value: unknown): string => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const escaped = String(raw ?? '').replace(/"/g, '""');
  return `"${escaped}"`;
};

const toExcelCellText = (value: unknown): string => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const text = String(raw ?? '');
  const maxLen = 32767;
  if (text.length <= maxLen) {
    return text;
  }

  return `${text.slice(0, maxLen - 16)} ...[truncated]`;
};

const toExportRow = (row: {
  id: number;
  capturedAt: string;
  targetId: string;
  health: unknown;
  performance: unknown;
  ple: unknown;
  storage: unknown;
  sessions: unknown;
  queries: unknown;
  alerts: unknown;
  backups: unknown;
}) => ({
  id: row.id,
  capturedAt: row.capturedAt,
  targetId: row.targetId,
  health: toExcelCellText(row.health),
  performance: toExcelCellText(row.performance),
  ple: toExcelCellText(row.ple),
  storage: toExcelCellText(row.storage),
  sessions: toExcelCellText(row.sessions),
  queries: toExcelCellText(row.queries),
  alerts: toExcelCellText(row.alerts),
  backups: toExcelCellText(row.backups)
});

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
      ple: [],
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
    const { targetId, health, performance, ple, storage, sessions, queries, alerts, backups } = req.body;
    if (!targetId) {
      res.status(400).json({ error: 'targetId is required' });
      return;
    }
    await saveDashboardSnapshot({
      capturedAt: new Date().toISOString(),
      targetId,
      health,
      performance,
      ple: ple ?? [],
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
      const headers = ['id', 'capturedAt', 'targetId', 'health', 'performance', 'ple', 'storage', 'sessions', 'queries', 'alerts', 'backups'];
      const lines = rows.map((row) => [
        toCsvCell(row.id),
        toCsvCell(row.capturedAt),
        toCsvCell(row.targetId),
        toCsvCell(row.health),
        toCsvCell(row.performance),
        toCsvCell(row.ple),
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

    if (query.format === 'excel') {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(rows.map(toExportRow));
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Snapshots');
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="dashboard-snapshots.xlsx"');
      res.send(excelBuffer);
      return;
    }

    if (query.format === 'pdf') {
      const doc = new PDFDocument({ margin: 36, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="dashboard-snapshots.pdf"');
        res.send(pdfBuffer);
      });

      doc.fontSize(16).text('Monitoring Snapshot Export', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Total snapshots: ${rows.length}`);
      doc.moveDown(0.8);

      rows.forEach((row, index) => {
        if (index > 0) {
          doc.moveDown(0.6);
        }
        if (doc.y > 730) {
          doc.addPage();
        }

        doc.fontSize(11).text(`#${row.id}  ${row.capturedAt}`);
        doc.fontSize(9).text(`Target: ${row.targetId}`);

        const pleText = JSON.stringify(row.ple);
        const alertsText = JSON.stringify(row.alerts);
        const queriesText = JSON.stringify(row.queries);

        doc.fontSize(8).text(`PLE: ${pleText}`, { width: 520 });
        doc.fontSize(8).text(`Alerts: ${alertsText}`, { width: 520 });
        doc.fontSize(8).text(`Queries: ${queriesText}`, { width: 520 });
      });

      doc.end();
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

monitoringRouter.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const pool = await getPool('default');
    const user = await getAuthUserByUsername(pool, body.username);
    if (!user) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const validPassword = await bcrypt.compare(body.password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

monitoringRouter.post('/presence/heartbeat', requireAuth, async (req: RequestWithUser, res) => {
  const body = presenceSchema.safeParse(req.body);
  if (!body.success || !req.user) {
    res.status(400).json({ message: 'Invalid presence payload' });
    return;
  }

  markPresenceHeartbeat(req.user.id, req.user.username, body.data.tabId);
  res.status(204).send();
});

monitoringRouter.post('/presence/close', requireAuth, async (req: RequestWithUser, res) => {
  const body = presenceSchema.safeParse(req.body);
  if (!body.success || !req.user) {
    res.status(400).json({ message: 'Invalid presence payload' });
    return;
  }

  markPresenceClosed(req.user.id, body.data.tabId);
  res.status(204).send();
});

monitoringRouter.post('/users', checkRole('admin'), async (req, res) => {
  try {
    const body = createUserSchema.parse(req.body);
    const pool = await getPool('default');
    const existing = await pool.request()
      .input('username', sql.VarChar(255), body.username)
      .query('SELECT TOP 1 id FROM dbo.users WHERE username = @username');

    if (existing.recordset.length > 0) {
      res.status(409).json({ message: 'Username already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(body.password, 10);
    await insertUserWithRoleCompatibility(pool, body.username, hashedPassword, body.role);

    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error creating user', error });
  }
});

monitoringRouter.get('/users', checkRole('admin'), async (req: RequestWithUser, res) => {
  try {
    const tabId = getClientTabId(req.headers['x-client-tab-id']);
    if (req.user && tabId) {
      markPresenceHeartbeat(req.user.id, req.user.username, tabId);
    }

    const pool = await getPool('default');
    const users = await listUsersWithRoleCompatibility(pool);
    const presenceByUserId = getPresenceByUserId();

    const usersWithPresence: AdminUserRow[] = users.map((user) => {
      const presence = presenceByUserId.get(user.id);
      return {
        ...user,
        is_active: presence?.isActive ?? false,
        active_tab_count: presence?.activeTabCount ?? 0,
        last_active_at: presence?.lastActiveAt ?? null
      };
    });

    res.json(usersWithPresence);
  } catch (error) {
    res.status(500).json({ message: 'Error listing users', error });
  }
});

monitoringRouter.delete('/users/:userId', checkRole('admin'), async (req: RequestWithUser, res) => {
  try {
    const userId = Number.parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ message: 'Invalid user id' });
      return;
    }

    const actorId = req.user?.id ?? 0;
    if (actorId === userId) {
      res.status(400).json({ message: 'You cannot delete your own account' });
      return;
    }

    const pool = await getPool('default');
    const deleted = await pool.request()
      .input('userId', sql.Int, userId)
      .query('DELETE FROM dbo.users WHERE id = @userId');

    if ((deleted.rowsAffected?.[0] ?? 0) === 0) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user', error });
  }
});

monitoringRouter.get('/reports', checkRole('reader'), async (req, res) => {
  try {
    const pool = await getPool('default');
    const reports = await pool.request().query(
      'SELECT TOP 50 id, capturedAt, targetId FROM dbo.DashboardSnapshots ORDER BY capturedAt DESC'
    );
    res.json(reports.recordset);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching reports', error });
  }
});
