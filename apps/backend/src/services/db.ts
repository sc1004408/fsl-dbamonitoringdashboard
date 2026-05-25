export const deleteTarget = async (targetId: string): Promise<void> => {
  await ensureInitialized();
  if (targetId === defaultTargetId) {
    throw new Error('Cannot delete the default server');
  }
  const target = targets.get(targetId);
  if (!target) {
    throw new Error(`Target not found: ${targetId}`);
  }
  // Close and remove pool if exists
  const pool = pools.get(targetId);
  if (pool) {
    await pool.close();
    pools.delete(targetId);
  }
  connectPromises.delete(targetId);
  targets.delete(targetId);
  // If deleted target was active, reset to default
  if (activeTargetId === targetId) {
    activeTargetId = defaultTargetId;
  }
  await persistTargets();
};
import sql from 'mssql';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

type DbTarget = {
  id: string;
  name: string;
  connectionString: string;
  createdAt: string;
};

export type ConnectionFieldsInput = {
  server: string;
  port: number;
  database: string;
  userId: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
};

type ConnectionFieldsPublic = {
  server: string;
  port: number;
  database: string;
  userId: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  hasPassword: boolean;
};

type DbTargetSummary = {
  id: string;
  name: string;
  connectionStringMasked: string;
  connection: ConnectionFieldsPublic;
  createdAt: string;
};

type PersistedTargetState = {
  targets: PersistedTarget[];
  activeTargetId: string;
};

type PersistedTarget = {
  id: string;
  name: string;
  createdAt: string;
  encryptedConnectionString?: string;
  connectionString?: string;
};

const targets = new Map<string, DbTarget>();
const pools = new Map<string, sql.ConnectionPool>();
const connectPromises = new Map<string, Promise<sql.ConnectionPool>>();

const defaultTargetId = 'default';
let activeTargetId = defaultTargetId;
let initialized = false;
let initializingPromise: Promise<void> | null = null;

const targetStorePath = path.resolve(__dirname, '..', '..', 'logs', 'db-targets.json');
const encryptionSeed = env.DB_TARGETS_ENCRYPTION_KEY ?? env.DB_PASSWORD;
const encryptionKey = createHash('sha256').update(`db-targets:${encryptionSeed}`).digest();

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }

  return value.trim().toLowerCase() === 'true';
};

const buildConnectionString = (connection: ConnectionFieldsInput): string => {
  const server = connection.server.trim();
  const port = Number.isFinite(connection.port) && connection.port > 0 ? connection.port : 1433;

  return [
    `Server=${server},${port}`,
    `Database=${connection.database.trim()}`,
    `User Id=${connection.userId.trim()}`,
    `Password=${connection.password}`,
    `Encrypt=${connection.encrypt}`,
    `TrustServerCertificate=${connection.trustServerCertificate}`
  ].join(';');
};

const parseConnectionString = (connectionString: string): ConnectionFieldsInput => {
  const map = new Map<string, string>();
  for (const segment of connectionString.split(';')) {
    const part = segment.trim();
    if (!part) {
      continue;
    }

    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim().toLowerCase();
    const value = part.slice(separatorIndex + 1).trim();
    map.set(key, value);
  }

  const serverRaw = map.get('server') ?? '';
  const serverParts = serverRaw.split(',');
  const portRaw = serverParts.length > 1 ? serverParts[serverParts.length - 1] : `${env.DB_PORT}`;
  const server = serverParts.length > 1 ? serverParts.slice(0, -1).join(',') : serverRaw;
  const port = Number.parseInt(portRaw, 10);

  return {
    server,
    port: Number.isFinite(port) && port > 0 ? port : env.DB_PORT,
    database: map.get('database') ?? env.DB_NAME,
    userId: map.get('user id') ?? map.get('uid') ?? '',
    password: map.get('password') ?? map.get('pwd') ?? '',
    encrypt: parseBoolean(map.get('encrypt'), false),
    trustServerCertificate: parseBoolean(map.get('trustservercertificate'), true)
  };
};

const toPublicConnection = (connection: ConnectionFieldsInput): ConnectionFieldsPublic => ({
  server: connection.server,
  port: connection.port,
  database: connection.database,
  userId: connection.userId,
  encrypt: connection.encrypt,
  trustServerCertificate: connection.trustServerCertificate,
  hasPassword: connection.password.length > 0
});

const normalizeConnectionInput = (connection: ConnectionFieldsInput): string => {
  if (!connection.server.trim()) {
    throw new Error('Server is required');
  }
  if (!connection.database.trim()) {
    throw new Error('Database is required');
  }
  if (!connection.userId.trim()) {
    throw new Error('User ID is required');
  }
  if (!connection.password) {
    throw new Error('Password is required');
  }

  return buildConnectionString(connection);
};

const defaultConnectionString = buildConnectionString({
  server: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  userId: env.DB_USER,
  password: env.DB_PASSWORD,
  encrypt: false,
  trustServerCertificate: true
});

targets.set(defaultTargetId, {
  id: defaultTargetId,
  name: 'Default Server',
  connectionString: defaultConnectionString,
  createdAt: new Date().toISOString()
});

if (!env.DB_TARGETS_ENCRYPTION_KEY) {
  console.warn('DB_TARGETS_ENCRYPTION_KEY is not set. Falling back to DB_PASSWORD-derived key for target encryption.');
}

const encryptConnectionString = (connectionString: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(connectionString, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}.${authTag.toString('hex')}.${encrypted.toString('hex')}`;
};

const decryptConnectionString = (payload: string): string => {
  const [ivHex, authTagHex, encryptedHex] = payload.split('.');
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted connection string payload format.');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
};

const ensureStoreDirectory = async (): Promise<void> => {
  await fs.mkdir(path.dirname(targetStorePath), { recursive: true });
};

const recoverTargetsFromMonitoringServerList = async (): Promise<void> => {
  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await buildPool(defaultConnectionString).connect();
    const result = await pool.request().query<{
      targetId: string;
      targetName: string;
      serverName: string;
      port: number;
      databaseName: string;
      userId: string;
      encrypt: boolean;
      trustServerCertificate: boolean;
    }>(`
      SELECT
        targetId,
        targetName,
        serverName,
        port,
        databaseName,
        userId,
        encrypt,
        trustServerCertificate
      FROM [DBA_Monitoring].[dbo].[MonitoringServerList]
      WHERE targetId IS NOT NULL
        AND targetId <> 'default'
    `);

    for (const row of result.recordset) {
      const id = String(row.targetId ?? '').trim();
      if (!id || targets.has(id)) {
        continue;
      }

      const connectionString = buildConnectionString({
        server: String(row.serverName ?? '').trim(),
        port: Number.isFinite(Number(row.port)) && Number(row.port) > 0 ? Number(row.port) : env.DB_PORT,
        database: String(row.databaseName ?? env.DB_NAME).trim(),
        userId: String(row.userId ?? env.DB_USER).trim(),
        password: env.DB_PASSWORD,
        encrypt: Boolean(row.encrypt),
        trustServerCertificate: Boolean(row.trustServerCertificate)
      });

      targets.set(id, {
        id,
        name: String(row.targetName ?? id).trim() || id,
        connectionString,
        createdAt: new Date().toISOString()
      });
    }
  } catch {
    // Recovery from monitoring table is best-effort only.
  } finally {
    if (pool) {
      await pool.close();
    }
  }
};

const persistTargets = async (): Promise<void> => {
  await ensureStoreDirectory();

  const payload: PersistedTargetState = {
    targets: Array.from(targets.values()).map((target) => ({
      id: target.id,
      name: target.name,
      createdAt: target.createdAt,
      encryptedConnectionString: encryptConnectionString(target.connectionString)
    })),
    activeTargetId
  };

  await fs.writeFile(targetStorePath, JSON.stringify(payload, null, 2), 'utf-8');
};

const hydrateTargets = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(targetStorePath, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedTargetState;

    if (!Array.isArray(parsed.targets)) {
      return;
    }

    targets.clear();
    for (const target of parsed.targets) {
      if (!target.id || !target.name || !target.createdAt) {
        continue;
      }

      let connectionString: string | null = null;

      if (typeof target.encryptedConnectionString === 'string' && target.encryptedConnectionString.length > 0) {
        try {
          connectionString = decryptConnectionString(target.encryptedConnectionString);
        } catch {
          console.warn(`Unable to decrypt connection string for target ${target.id}. Skipping target.`);
          continue;
        }
      } else if (typeof target.connectionString === 'string' && target.connectionString.length > 0) {
        connectionString = target.connectionString;
      }

      if (!connectionString) {
        continue;
      }

      targets.set(target.id, {
        id: target.id,
        name: target.name,
        createdAt: target.createdAt,
        connectionString
      });
    }

    if (!targets.has(defaultTargetId)) {
      targets.set(defaultTargetId, {
        id: defaultTargetId,
        name: 'Default Server',
        connectionString: defaultConnectionString,
        createdAt: new Date().toISOString()
      });
    }

    if (targets.size <= 1) {
      await recoverTargetsFromMonitoringServerList();
    }

    if (typeof parsed.activeTargetId === 'string' && targets.has(parsed.activeTargetId)) {
      activeTargetId = parsed.activeTargetId;
    } else {
      activeTargetId = defaultTargetId;
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ENOENT') {
      console.warn('Unable to load persisted DB targets. Falling back to defaults.');
    }
  }
};

const ensureInitialized = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  if (!initializingPromise) {
    initializingPromise = (async () => {
      await hydrateTargets();
      await persistTargets();
      initialized = true;
    })();
  }

  await initializingPromise;
};

const maskConnectionString = (connectionString: string): string =>
  connectionString
    .replace(/(password\s*=\s*)([^;]+)/i, '$1****')
    .replace(/(pwd\s*=\s*)([^;]+)/i, '$1****');

const getTarget = (targetId?: string): DbTarget => {
  const effectiveTargetId = targetId ?? activeTargetId;
  const target = targets.get(effectiveTargetId);

  if (!target) {
    throw new Error(`Unknown database target: ${effectiveTargetId}`);
  }

  return target;
};

const buildPool = (connectionString: string): sql.ConnectionPool =>
  new sql.ConnectionPool(connectionString);

export const listTargets = async (): Promise<{ targets: DbTargetSummary[]; activeTargetId: string }> => {
  await ensureInitialized();

  const summaries = Array.from(targets.values()).map((target) => ({
    id: target.id,
    name: target.name,
    connectionStringMasked: maskConnectionString(target.connectionString),
    connection: toPublicConnection(parseConnectionString(target.connectionString)),
    createdAt: target.createdAt
  }));

  return {
    targets: summaries,
    activeTargetId
  };
};

export const addTarget = async (
  name: string,
  connection: ConnectionFieldsInput
): Promise<DbTargetSummary> => {
  await ensureInitialized();

  const trimmedName = name.trim();
  const normalizedConnectionString = normalizeConnectionInput(connection);

  if (!trimmedName) {
    throw new Error('Target name is required');
  }

  const id = `db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdTarget: DbTarget = {
    id,
    name: trimmedName,
    connectionString: normalizedConnectionString,
    createdAt: new Date().toISOString()
  };

  targets.set(id, createdTarget);

  await persistTargets();

  return {
    id: createdTarget.id,
    name: createdTarget.name,
    connectionStringMasked: maskConnectionString(createdTarget.connectionString),
    connection: toPublicConnection(parseConnectionString(createdTarget.connectionString)),
    createdAt: createdTarget.createdAt
  };
};

export const updateTarget = async (
  targetId: string,
  updates: { name?: string; connection?: ConnectionFieldsInput }
): Promise<DbTargetSummary> => {
  await ensureInitialized();

  const existing = getTarget(targetId);
  const nextName = updates.name?.trim();
  const hasObjectConnectionUpdate = typeof updates.connection === 'object' && updates.connection !== null;
  const hasConnectionUpdate = hasObjectConnectionUpdate;

  if (!nextName && !hasConnectionUpdate) {
    throw new Error('At least one field is required to update target');
  }

  const nextConnectionString = hasObjectConnectionUpdate
    ? normalizeConnectionInput(updates.connection as ConnectionFieldsInput)
    : existing.connectionString;

  const updatedTarget: DbTarget = {
    ...existing,
    name: nextName && nextName.length > 0 ? nextName : existing.name,
    connectionString: nextConnectionString
  };

  targets.set(targetId, updatedTarget);

  if (hasConnectionUpdate) {
    const pool = pools.get(targetId);
    if (pool) {
      await pool.close();
      pools.delete(targetId);
    }
    connectPromises.delete(targetId);
  }

  await persistTargets();

  return {
    id: updatedTarget.id,
    name: updatedTarget.name,
    connectionStringMasked: maskConnectionString(updatedTarget.connectionString),
    connection: toPublicConnection(parseConnectionString(updatedTarget.connectionString)),
    createdAt: updatedTarget.createdAt
  };
};

export const selectTarget = async (targetId: string): Promise<void> => {
  await ensureInitialized();
  getTarget(targetId);
  activeTargetId = targetId;
  await persistTargets();
};

export const getPool = async (targetId?: string): Promise<sql.ConnectionPool> => {
  await ensureInitialized();

  const target = getTarget(targetId);
  const existingPool = pools.get(target.id);
  if (existingPool) {
    return existingPool;
  }

  const existingPromise = connectPromises.get(target.id);
  if (existingPromise) {
    return existingPromise;
  }

  const pool = buildPool(target.connectionString);
  const connectionPromise = pool.connect().then((connectedPool) => {
    pools.set(target.id, connectedPool);
    connectPromises.delete(target.id);
    return connectedPool;
  });

  connectPromises.set(target.id, connectionPromise);
  return connectionPromise;
};

export const runQuery = async <T = unknown>(query: string, targetId?: string): Promise<T[]> => {
  const p = await getPool(targetId);
  const result = await p.request().query<T>(query);
  return result.recordset;
};
