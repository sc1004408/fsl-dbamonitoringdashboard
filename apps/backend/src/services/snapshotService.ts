import sql from 'mssql';
import { env } from '../config/env';

export type DashboardSnapshot = {
  capturedAt: string;
  targetId: string;
  health: unknown;
  performance: unknown;
  storage: unknown;
  sessions: unknown;
  queries: unknown;
  alerts: unknown;
  backups: unknown;
};

export type SnapshotHistoryRow = {
  id: number;
  capturedAt: string;
  targetId: string;
  health: unknown;
  performance: unknown;
  storage: unknown;
  sessions: unknown;
  queries: unknown;
  alerts: unknown;
  backups: unknown;
};

export type SnapshotHistoryFilter = {
  targetId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type SnapshotHistoryResult = {
  items: SnapshotHistoryRow[];
  total: number;
  limit: number;
  offset: number;
};

const SNAPSHOT_TABLE = '[DBA_Monitoring].[dbo].[DashboardSnapshots]';

export async function saveDashboardSnapshot(snapshot: DashboardSnapshot) {
  // Use a dedicated connection to DBA_Monitoring
  const pool = await sql.connect({
    server: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'DBA_Monitoring',
    options: { encrypt: false, trustServerCertificate: true }
  });

  await pool.request()
    .input('capturedAt', sql.DateTime2, snapshot.capturedAt)
    .input('targetId', sql.NVarChar(100), snapshot.targetId)
    .input('health', sql.NVarChar(sql.MAX), JSON.stringify(snapshot.health))
    .input('performance', sql.NVarChar(sql.MAX), JSON.stringify(snapshot.performance))
    .input('storage', sql.NVarChar(sql.MAX), JSON.stringify(snapshot.storage))
    .input('sessions', sql.NVarChar(sql.MAX), JSON.stringify(snapshot.sessions))
    .input('queries', sql.NVarChar(sql.MAX), JSON.stringify(snapshot.queries))
    .input('alerts', sql.NVarChar(sql.MAX), JSON.stringify(snapshot.alerts))
    .input('backups', sql.NVarChar(sql.MAX), JSON.stringify(snapshot.backups))
    .query(`INSERT INTO ${SNAPSHOT_TABLE}
      (capturedAt, targetId, health, performance, storage, sessions, queries, alerts, backups)
      VALUES (@capturedAt, @targetId, @health, @performance, @storage, @sessions, @queries, @alerts, @backups)`);
}

const parseJsonField = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const mapSnapshotRows = (rows: Array<Record<string, unknown>>): SnapshotHistoryRow[] => {
  return rows.map((row) => ({
    id: Number(row.id),
    capturedAt: String(row.capturedAt),
    targetId: String(row.targetId),
    health: parseJsonField(row.health),
    performance: parseJsonField(row.performance),
    storage: parseJsonField(row.storage),
    sessions: parseJsonField(row.sessions),
    queries: parseJsonField(row.queries),
    alerts: parseJsonField(row.alerts),
    backups: parseJsonField(row.backups)
  }));
};

export async function getDashboardSnapshots(filter: SnapshotHistoryFilter): Promise<SnapshotHistoryResult> {
  const pool = await sql.connect({
    server: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'DBA_Monitoring',
    options: { encrypt: false, trustServerCertificate: true }
  });

  const request = pool.request();
  request.input('targetId', sql.NVarChar(100), filter.targetId ?? null);
  request.input('fromAt', sql.DateTime2, filter.from ?? null);
  request.input('toAt', sql.DateTime2, filter.to ?? null);
  request.input('limit', sql.Int, filter.limit ?? 50);
  request.input('offset', sql.Int, filter.offset ?? 0);

  const result = await request.query(`
    SELECT
      id,
      capturedAt,
      targetId,
      health,
      performance,
      storage,
      sessions,
      queries,
      alerts,
      backups
    FROM ${SNAPSHOT_TABLE}
    WHERE (@targetId IS NULL OR targetId = @targetId)
      AND (@fromAt IS NULL OR capturedAt >= @fromAt)
      AND (@toAt IS NULL OR capturedAt <= @toAt)
    ORDER BY capturedAt DESC
    OFFSET @offset ROWS
    FETCH NEXT @limit ROWS ONLY;
  `);

  const countResult = await pool.request()
    .input('targetId', sql.NVarChar(100), filter.targetId ?? null)
    .input('fromAt', sql.DateTime2, filter.from ?? null)
    .input('toAt', sql.DateTime2, filter.to ?? null)
    .query(`
      SELECT COUNT(1) AS total
      FROM ${SNAPSHOT_TABLE}
      WHERE (@targetId IS NULL OR targetId = @targetId)
        AND (@fromAt IS NULL OR capturedAt >= @fromAt)
        AND (@toAt IS NULL OR capturedAt <= @toAt);
    `);

  const items = mapSnapshotRows(result.recordset as Array<Record<string, unknown>>);

  const total = Number(countResult.recordset[0]?.total ?? 0);
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  return { items, total, limit, offset };
}

export async function getAllDashboardSnapshots(filter: SnapshotHistoryFilter): Promise<SnapshotHistoryRow[]> {
  const pool = await sql.connect({
    server: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'DBA_Monitoring',
    options: { encrypt: false, trustServerCertificate: true }
  });

  const result = await pool.request()
    .input('targetId', sql.NVarChar(100), filter.targetId ?? null)
    .input('fromAt', sql.DateTime2, filter.from ?? null)
    .input('toAt', sql.DateTime2, filter.to ?? null)
    .query(`
      SELECT
        id,
        capturedAt,
        targetId,
        health,
        performance,
        storage,
        sessions,
        queries,
        alerts,
        backups
      FROM ${SNAPSHOT_TABLE}
      WHERE (@targetId IS NULL OR targetId = @targetId)
        AND (@fromAt IS NULL OR capturedAt >= @fromAt)
        AND (@toAt IS NULL OR capturedAt <= @toAt)
      ORDER BY capturedAt DESC;
    `);

  return mapSnapshotRows(result.recordset as Array<Record<string, unknown>>);
}
