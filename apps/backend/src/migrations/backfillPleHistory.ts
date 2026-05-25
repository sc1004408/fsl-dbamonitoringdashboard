import sql from 'mssql';
import { env } from '../config/env';
import { getPool, listTargets } from '../services/db';

type MissingByTargetRow = {
  targetId: string;
  missingCount: number;
};

type PleRow = {
  node_name: string;
  page_life_expectancy: number;
};

const EMPTY_PLE_CONDITION = `
  (ple IS NULL OR LTRIM(RTRIM(CAST(ple AS NVARCHAR(MAX)))) IN ('', '[]', '{}'))
`;

const fetchPleForTarget = async (targetId: string): Promise<PleRow[]> => {
  const targetPool = await getPool(targetId);
  const result = await targetPool.request().query<PleRow>(`
    SELECT
      COALESCE(NULLIF(pc.instance_name, ''), '_Total') AS node_name,
      CAST(pc.cntr_value AS BIGINT) AS page_life_expectancy
    FROM sys.dm_os_performance_counters AS pc
    WHERE pc.object_name LIKE '%Buffer Manager%'
      AND pc.counter_name = 'Page life expectancy'
    ORDER BY
      CASE WHEN pc.instance_name = '_Total' THEN 1 ELSE 0 END,
      pc.instance_name;
  `);

  return result.recordset ?? [];
};

const run = async () => {
  const monitoringPool = await sql.connect({
    server: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'DBA_Monitoring',
    options: { encrypt: false, trustServerCertificate: true }
  });

  const missingResult = await monitoringPool.request().query<MissingByTargetRow>(`
    SELECT
      targetId,
      COUNT(1) AS missingCount
    FROM [DBA_Monitoring].[dbo].[DashboardSnapshots]
    WHERE ${EMPTY_PLE_CONDITION}
    GROUP BY targetId
    ORDER BY targetId;
  `);

  const missingTargets = missingResult.recordset ?? [];
  if (missingTargets.length === 0) {
    console.log('No snapshots with empty PLE found.');
    await monitoringPool.close();
    return;
  }

  const targetState = await listTargets();
  const knownTargetIds = new Set(targetState.targets.map((target) => target.id));

  let totalUpdated = 0;
  for (const row of missingTargets) {
    const targetId = String(row.targetId ?? '').trim();
    if (!targetId || !knownTargetIds.has(targetId)) {
      console.warn(`Skipping target ${targetId || '(empty)'}: not found in current target list.`);
      continue;
    }

    let pleRows: PleRow[] = [];
    try {
      pleRows = await fetchPleForTarget(targetId);
    } catch (error) {
      console.warn(`Skipping target ${targetId}: unable to fetch PLE from target.`, error);
      continue;
    }

    if (pleRows.length === 0) {
      console.warn(`Skipping target ${targetId}: live PLE query returned no rows.`);
      continue;
    }

    const pleJson = JSON.stringify(pleRows);

    const updateResult = await monitoringPool.request()
      .input('targetId', sql.NVarChar(100), targetId)
      .input('pleJson', sql.NVarChar(sql.MAX), pleJson)
      .query(`
        UPDATE [DBA_Monitoring].[dbo].[DashboardSnapshots]
        SET ple = @pleJson
        WHERE targetId = @targetId
          AND ${EMPTY_PLE_CONDITION};

        SELECT @@ROWCOUNT AS affected;
      `);

    const affected = Number(updateResult.recordset?.[0]?.affected ?? 0);
    totalUpdated += affected;
    console.log(`Target ${targetId}: backfilled ${affected} snapshot(s).`);
  }

  console.log(`PLE backfill complete. Total updated snapshots: ${totalUpdated}.`);
  await monitoringPool.close();
};

void run().catch((error) => {
  console.error('PLE backfill failed:', error);
  process.exitCode = 1;
});
