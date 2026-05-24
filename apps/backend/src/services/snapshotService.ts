import sql from 'mssql';
import { env } from '../config/env';
import { listTargets } from './db';

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

const SNAPSHOT_TABLE = '[DBA_Monitoring].[dbo].[DashboardSnapshots]';
const SERVER_LIST_TABLE = '[DBA_Monitoring].[dbo].[MonitoringServerList]';
const SNAPSHOT_HEADER_TABLE = '[DBA_Monitoring].[dbo].[MonitoringSnapshotHeader]';
const SNAPSHOT_DETAIL_TABLE = '[DBA_Monitoring].[dbo].[MonitoringSnapshotDetail]';

type SnapshotDetailRow = {
  section: string;
  rowIndex: number;
  columnName: string;
  columnValue: string | null;
};

const connectMonitoringDb = async () => {
  return sql.connect({
    server: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'DBA_Monitoring',
    options: { encrypt: false, trustServerCertificate: true }
  });
};

const stringifyCell = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const flattenSection = (section: string, payload: unknown): SnapshotDetailRow[] => {
  const rows: SnapshotDetailRow[] = [];

  if (Array.isArray(payload)) {
    payload.forEach((item, rowIndex) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        for (const [columnName, columnValue] of Object.entries(item as Record<string, unknown>)) {
          rows.push({ section, rowIndex, columnName, columnValue: stringifyCell(columnValue) });
        }
      } else {
        rows.push({ section, rowIndex, columnName: 'value', columnValue: stringifyCell(item) });
      }
    });
    return rows;
  }

  if (payload && typeof payload === 'object') {
    for (const [columnName, columnValue] of Object.entries(payload as Record<string, unknown>)) {
      rows.push({ section, rowIndex: 0, columnName, columnValue: stringifyCell(columnValue) });
    }
    return rows;
  }

  rows.push({ section, rowIndex: 0, columnName: 'value', columnValue: stringifyCell(payload) });
  return rows;
};

const ensureMonitoringTables = async (pool: sql.ConnectionPool) => {
  await pool.request().query(`
    IF OBJECT_ID('${SNAPSHOT_TABLE}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${SNAPSHOT_TABLE} (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        capturedAt DATETIME2 NOT NULL,
        targetId NVARCHAR(100) NOT NULL,
        health NVARCHAR(MAX) NOT NULL,
        performance NVARCHAR(MAX) NOT NULL,
        storage NVARCHAR(MAX) NOT NULL,
        sessions NVARCHAR(MAX) NOT NULL,
        queries NVARCHAR(MAX) NOT NULL,
        alerts NVARCHAR(MAX) NOT NULL,
        backups NVARCHAR(MAX) NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );

      CREATE INDEX IX_DashboardSnapshots_CapturedAt ON ${SNAPSHOT_TABLE}(capturedAt DESC);
      CREATE INDEX IX_DashboardSnapshots_TargetId ON ${SNAPSHOT_TABLE}(targetId);
    END

    IF OBJECT_ID('${SERVER_LIST_TABLE}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${SERVER_LIST_TABLE} (
        targetId NVARCHAR(100) NOT NULL PRIMARY KEY,
        targetName NVARCHAR(200) NOT NULL,
        serverName NVARCHAR(256) NOT NULL,
        port INT NOT NULL,
        databaseName NVARCHAR(256) NOT NULL,
        userId NVARCHAR(256) NOT NULL,
        encrypt BIT NOT NULL,
        trustServerCertificate BIT NOT NULL,
        connectionStringMasked NVARCHAR(1000) NOT NULL,
        createdAt DATETIME2 NOT NULL,
        updatedAt DATETIME2 NOT NULL
      );
    END

    IF OBJECT_ID('${SNAPSHOT_HEADER_TABLE}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${SNAPSHOT_HEADER_TABLE} (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        capturedAt DATETIME2 NOT NULL,
        targetId NVARCHAR(100) NOT NULL,
        targetName NVARCHAR(200) NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );

      CREATE INDEX IX_MonitoringSnapshotHeader_CapturedAt ON ${SNAPSHOT_HEADER_TABLE}(capturedAt DESC);
      CREATE INDEX IX_MonitoringSnapshotHeader_TargetId ON ${SNAPSHOT_HEADER_TABLE}(targetId);
    END

    IF OBJECT_ID('${SNAPSHOT_DETAIL_TABLE}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${SNAPSHOT_DETAIL_TABLE} (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        snapshotId BIGINT NOT NULL,
        section NVARCHAR(100) NOT NULL,
        rowIndex INT NOT NULL,
        columnName NVARCHAR(200) NOT NULL,
        columnValue NVARCHAR(MAX) NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_MonitoringSnapshotDetail_SnapshotHeader
          FOREIGN KEY (snapshotId) REFERENCES ${SNAPSHOT_HEADER_TABLE}(id) ON DELETE CASCADE
      );

      CREATE INDEX IX_MonitoringSnapshotDetail_SnapshotId ON ${SNAPSHOT_DETAIL_TABLE}(snapshotId);
      CREATE INDEX IX_MonitoringSnapshotDetail_Section ON ${SNAPSHOT_DETAIL_TABLE}(section);
    END
  `);
};

const syncServerListTable = async (pool: sql.ConnectionPool) => {
  const serverState = await listTargets();

  for (const target of serverState.targets) {
    await pool.request()
      .input('targetId', sql.NVarChar(100), target.id)
      .input('targetName', sql.NVarChar(200), target.name)
      .input('serverName', sql.NVarChar(256), target.connection.server)
      .input('port', sql.Int, target.connection.port)
      .input('databaseName', sql.NVarChar(256), target.connection.database)
      .input('userId', sql.NVarChar(256), target.connection.userId)
      .input('encrypt', sql.Bit, target.connection.encrypt)
      .input('trustServerCertificate', sql.Bit, target.connection.trustServerCertificate)
      .input('connectionStringMasked', sql.NVarChar(1000), target.connectionStringMasked)
      .input('createdAt', sql.DateTime2, target.createdAt)
      .query(`
        MERGE ${SERVER_LIST_TABLE} AS tgt
        USING (SELECT @targetId AS targetId) AS src
        ON tgt.targetId = src.targetId
        WHEN MATCHED THEN
          UPDATE SET
            targetName = @targetName,
            serverName = @serverName,
            port = @port,
            databaseName = @databaseName,
            userId = @userId,
            encrypt = @encrypt,
            trustServerCertificate = @trustServerCertificate,
            connectionStringMasked = @connectionStringMasked,
            createdAt = @createdAt,
            updatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (targetId, targetName, serverName, port, databaseName, userId, encrypt, trustServerCertificate, connectionStringMasked, createdAt, updatedAt)
          VALUES (@targetId, @targetName, @serverName, @port, @databaseName, @userId, @encrypt, @trustServerCertificate, @connectionStringMasked, @createdAt, SYSUTCDATETIME());
      `);
  }
};

const purgeOldMonitoringData = async (pool: sql.ConnectionPool, retentionDays: number) => {
  await pool.request()
    .input('retentionDays', sql.Int, retentionDays)
    .query(`
      DELETE FROM ${SNAPSHOT_HEADER_TABLE}
      WHERE capturedAt < DATEADD(DAY, -@retentionDays, SYSUTCDATETIME());

      DELETE FROM ${SNAPSHOT_TABLE}
      WHERE capturedAt < DATEADD(DAY, -@retentionDays, SYSUTCDATETIME());
    `);
};

export async function saveDashboardSnapshot(snapshot: DashboardSnapshot) {
  const pool = await connectMonitoringDb();
  await ensureMonitoringTables(pool);
  await syncServerListTable(pool);

  const serverState = await listTargets();
  const targetName = serverState.targets.find((target) => target.id === snapshot.targetId)?.name ?? snapshot.targetId;

  const detailRows = [
    ...flattenSection('health', snapshot.health),
    ...flattenSection('performance', snapshot.performance),
    ...flattenSection('storage', snapshot.storage),
    ...flattenSection('sessions', snapshot.sessions),
    ...flattenSection('queries', snapshot.queries),
    ...flattenSection('alerts', snapshot.alerts),
    ...flattenSection('backups', snapshot.backups)
  ];

  const headerInsert = await pool.request()
    .input('capturedAt', sql.DateTime2, snapshot.capturedAt)
    .input('targetId', sql.NVarChar(100), snapshot.targetId)
    .input('targetName', sql.NVarChar(200), targetName)
    .query(`
      INSERT INTO ${SNAPSHOT_HEADER_TABLE} (capturedAt, targetId, targetName)
      VALUES (@capturedAt, @targetId, @targetName);
      SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS snapshotId;
    `);

  const snapshotId = Number(headerInsert.recordset[0]?.snapshotId ?? 0);

  if (snapshotId > 0) {
    for (const row of detailRows) {
      await pool.request()
        .input('snapshotId', sql.BigInt, snapshotId)
        .input('section', sql.NVarChar(100), row.section)
        .input('rowIndex', sql.Int, row.rowIndex)
        .input('columnName', sql.NVarChar(200), row.columnName)
        .input('columnValue', sql.NVarChar(sql.MAX), row.columnValue)
        .query(`
          INSERT INTO ${SNAPSHOT_DETAIL_TABLE} (snapshotId, section, rowIndex, columnName, columnValue)
          VALUES (@snapshotId, @section, @rowIndex, @columnName, @columnValue);
        `);
    }
  }

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

  await purgeOldMonitoringData(pool, 60);
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
  const pool = await connectMonitoringDb();

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
  const pool = await connectMonitoringDb();

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

export async function getMonitoringTableStats(): Promise<MonitoringTableStats> {
  const pool = await connectMonitoringDb();

  const result = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM ${SERVER_LIST_TABLE}) AS serverListCount,
      (SELECT COUNT(*) FROM ${SNAPSHOT_HEADER_TABLE}) AS snapshotHeaderCount,
      (SELECT COUNT(*) FROM ${SNAPSHOT_DETAIL_TABLE}) AS snapshotDetailCount,
      (SELECT COUNT(*) FROM ${SNAPSHOT_TABLE}) AS dashboardSnapshotCount,
      (SELECT MIN(capturedAt) FROM ${SNAPSHOT_TABLE}) AS oldestSnapshotAt,
      (SELECT MAX(capturedAt) FROM ${SNAPSHOT_TABLE}) AS newestSnapshotAt
    FROM ${SNAPSHOT_TABLE};
  `);

  const stats = result.recordset[0];
  return {
    serverListCount: stats.serverListCount || 0,
    snapshotHeaderCount: stats.snapshotHeaderCount || 0,
    snapshotDetailCount: stats.snapshotDetailCount || 0,
    dashboardSnapshotCount: stats.dashboardSnapshotCount || 0,
    oldestSnapshotAt: stats.oldestSnapshotAt || null,
    newestSnapshotAt: stats.newestSnapshotAt || null,
    retentionDays: 60,
    error: null
  };
}
