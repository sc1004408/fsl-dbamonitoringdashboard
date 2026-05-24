import { runQuery } from './db';
import os from 'os';
import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

type OsProcessRow = {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_mb: number;
  memory_percent: number;
  state: string;
  started: string;
  command: string;
};

const normalizeOsProcessRows = (rows: OsProcessRow[]): OsProcessRow[] => {
  return rows
    .filter((proc) => proc.pid > 0)
    .sort((left, right) => {
      if (right.cpu_percent !== left.cpu_percent) {
        return right.cpu_percent - left.cpu_percent;
      }
      return right.memory_mb - left.memory_mb;
    });
};

const collectOsProcessesFromSystemInformation = async (): Promise<OsProcessRow[]> => {
  const processSnapshot = await si.processes();
  const list = Array.isArray(processSnapshot.list) ? processSnapshot.list : [];
  const totalMemBytes = os.totalmem();

  return normalizeOsProcessRows(
    list.map((proc: { pid?: number; name?: string; cpu?: number; mem?: number; memRss?: number; mem_rss?: number; state?: string; started?: string; command?: string; params?: string; path?: string }) => {
      const memRss = Number((proc as { memRss?: number; mem_rss?: number }).memRss ?? (proc as { memRss?: number; mem_rss?: number }).mem_rss ?? 0);
      const memPercent = Number(proc.mem ?? 0);
      const derivedMemBytes = memRss > 0 ? memRss : (totalMemBytes > 0 && memPercent > 0 ? (totalMemBytes * memPercent) / 100 : 0);
      const command = String((proc as { command?: string; params?: string; path?: string }).command
        ?? (proc as { command?: string; params?: string; path?: string }).params
        ?? (proc as { command?: string; params?: string; path?: string }).path
        ?? '');

      return {
        pid: Number(proc.pid ?? 0),
        name: String(proc.name ?? '(unknown)'),
        cpu_percent: Number(Number(proc.cpu ?? 0).toFixed(2)),
        memory_mb: Number((derivedMemBytes / (1024 * 1024)).toFixed(2)),
        memory_percent: Number(memPercent.toFixed(2)),
        state: String(proc.state ?? '(unknown)'),
        started: String(proc.started ?? ''),
        command
      };
    })
  );
};

const collectOsProcessesFromPowerShell = async (): Promise<OsProcessRow[]> => {
  const psScript = [
    "$totalMem = (Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize * 1024",
    'Get-Process | Select-Object Id, ProcessName, CPU, WorkingSet64, StartTime, Responding | ConvertTo-Json -Depth 2'
  ].join('; ');

  const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript}"`, { maxBuffer: 1024 * 1024 * 8 });
  const parsed = JSON.parse(stdout) as Array<Record<string, unknown>> | Record<string, unknown>;
  const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

  const totalMemBytes = os.totalmem();
  return normalizeOsProcessRows(
    list.map((proc) => {
      const workingSet = Number(proc.WorkingSet64 ?? 0);
      const memPercent = totalMemBytes > 0 ? (workingSet / totalMemBytes) * 100 : 0;
      return {
        pid: Number(proc.Id ?? 0),
        name: String(proc.ProcessName ?? '(unknown)'),
        cpu_percent: Number(Number(proc.CPU ?? 0).toFixed(2)),
        memory_mb: Number((workingSet / (1024 * 1024)).toFixed(2)),
        memory_percent: Number(memPercent.toFixed(2)),
        state: Boolean(proc.Responding) ? 'running' : 'not-responding',
        started: String(proc.StartTime ?? ''),
        command: String(proc.ProcessName ?? '')
      };
    })
  );
};

export const monitoringService = {
  async health(targetId?: string) {
    const [uptime] = await runQuery<{
      server_name: string;
      sql_version: string;
      sqlserver_start_time: string;
      uptime_minutes: number;
    }>(`
      SELECT
        @@SERVERNAME AS server_name,
        @@VERSION AS sql_version,
        sqlserver_start_time,
        DATEDIFF(MINUTE, sqlserver_start_time, SYSDATETIME()) AS uptime_minutes
      FROM sys.dm_os_sys_info;
    `, targetId);

    let cpuUsagePercent = 0;
    let totalMemory = os.totalmem();
    let freeMemory = os.freemem();

    try {
      const [load, memory] = await Promise.all([si.currentLoad(), si.mem()]);
      cpuUsagePercent = Number.isFinite(load.currentLoad) ? Number(load.currentLoad.toFixed(2)) : 0;
      totalMemory = memory.total;
      freeMemory = memory.available;
    } catch {
      const cpuCount = Math.max(os.cpus().length, 1);
      const loadAvg = os.loadavg()[0];
      cpuUsagePercent = Number(((loadAvg / cpuCount) * 100).toFixed(2));
    }

    const usedMemory = Math.max(totalMemory - freeMemory, 0);

    return {
      status: 'up',
      serverName: uptime?.server_name ?? null,
      sqlVersion: uptime?.sql_version ?? null,
      sqlServerStartTime: uptime?.sqlserver_start_time ?? null,
      uptimeMinutes: uptime?.uptime_minutes ?? null,
      cpuUsagePercent,
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory
      },
      checkedAt: new Date().toISOString()
    };
  },

  async performance(targetId?: string) {
    const waits = await runQuery<{
      wait_type: string;
      wait_time_ms: number;
      waiting_tasks_count: number;
      avg_wait_ms: number;
    }>(`
      SELECT TOP 20
        wait_type,
        wait_time_ms,
        waiting_tasks_count,
        CAST(wait_time_ms * 1.0 / NULLIF(waiting_tasks_count, 0) AS DECIMAL(18,2)) AS avg_wait_ms
      FROM sys.dm_os_wait_stats
      WHERE wait_type NOT LIKE 'SLEEP%'
      ORDER BY wait_time_ms DESC;
    `, targetId);

    const activeRequests = await runQuery<{
      session_id: number;
      status: string;
      command: string;
      cpu_time: number;
      logical_reads: number;
      reads: number;
      writes: number;
      total_elapsed_time: number;
      database_name: string;
      sql_text: string;
    }>(`
      SELECT TOP 25
        r.session_id,
        r.status,
        r.command,
        r.cpu_time,
        r.logical_reads,
        r.reads,
        r.writes,
        r.total_elapsed_time,
        DB_NAME(r.database_id) AS database_name,
        t.text AS sql_text
      FROM sys.dm_exec_requests r
      CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
      WHERE r.session_id <> @@SPID
      ORDER BY r.total_elapsed_time DESC;
    `, targetId);

    const processUtilization = await runQuery<{
      session_id: number;
      host_name: string;
      program_name: string;
      login_name: string;
      status: string;
      cpu_time_ms: number;
      memory_mb: number;
      elapsed_ms: number;
      database_name: string;
    }>(`
      SELECT
        s.session_id,
        COALESCE(s.host_name, '(unknown)') AS host_name,
        COALESCE(s.program_name, '(unknown)') AS program_name,
        COALESCE(s.login_name, '(unknown)') AS login_name,
        COALESCE(s.status, '(unknown)') AS status,
        COALESCE(r.cpu_time, s.cpu_time, 0) AS cpu_time_ms,
        CAST(COALESCE(s.memory_usage, 0) * 8.0 / 1024 AS DECIMAL(18,2)) AS memory_mb,
        COALESCE(r.total_elapsed_time, 0) AS elapsed_ms,
        COALESCE(DB_NAME(r.database_id), '(none)') AS database_name
      FROM sys.dm_exec_sessions s
      LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
      WHERE s.is_user_process = 1
      ORDER BY COALESCE(r.cpu_time, s.cpu_time, 0) DESC, s.memory_usage DESC;
    `, targetId);

    let osProcessUtilization: OsProcessRow[] = [];

    try {
      osProcessUtilization = await collectOsProcessesFromSystemInformation();
      const hasMeaningfulSignal = osProcessUtilization.some((proc) => proc.cpu_percent > 0 || proc.memory_mb > 0);
      if (!hasMeaningfulSignal) {
        osProcessUtilization = await collectOsProcessesFromPowerShell();
      }
    } catch {
      try {
        osProcessUtilization = await collectOsProcessesFromPowerShell();
      } catch {
        osProcessUtilization = [];
      }
    }

    return {
      topWaits: waits,
      activeRequests,
      processUtilization,
      osProcessUtilization
    };
  },

  async storage(targetId?: string) {
    const files = await runQuery<{
      database_name: string;
      type_desc: string;
      logical_name: string;
      file_size_mb: number;
      used_mb: number;
      free_mb: number;
    }>(
      `
      SELECT
        DB_NAME(mf.database_id) AS database_name,
        mf.type_desc,
        mf.name AS logical_name,
        CAST(mf.size * 8.0 / 1024 AS DECIMAL(18,2)) AS file_size_mb,
        CAST(FILEPROPERTY(mf.name, 'SpaceUsed') * 8.0 / 1024 AS DECIMAL(18,2)) AS used_mb,
        CAST((mf.size - FILEPROPERTY(mf.name, 'SpaceUsed')) * 8.0 / 1024 AS DECIMAL(18,2)) AS free_mb
      FROM sys.master_files mf
      ORDER BY database_name, mf.type_desc;
    `,
      targetId
    );

    const [tempdb] = await runQuery<{
      user_object_mb: number;
      internal_object_mb: number;
      version_store_mb: number;
      free_space_mb: number;
    }>(
      `
      SELECT
        SUM(user_object_reserved_page_count) * 8.0 / 1024 AS user_object_mb,
        SUM(internal_object_reserved_page_count) * 8.0 / 1024 AS internal_object_mb,
        SUM(version_store_reserved_page_count) * 8.0 / 1024 AS version_store_mb,
        SUM(unallocated_extent_page_count) * 8.0 / 1024 AS free_space_mb
      FROM tempdb.sys.dm_db_file_space_usage;
    `,
      targetId
    );

    const drives = await si.fsSize();

    const sqlVolumes = await runQuery<{
      volume_mount_point: string | null;
      logical_volume_name: string | null;
      total_bytes: number | null;
      available_bytes: number | null;
      file_system_type: string | null;
    }>(
      `
      SELECT DISTINCT
        vs.volume_mount_point,
        vs.logical_volume_name,
        vs.total_bytes,
        vs.available_bytes,
        vs.file_system_type
      FROM sys.master_files mf
      CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs
      WHERE vs.volume_mount_point IS NOT NULL;
      `,
      targetId
    );

    const normalizeDriveName = (name: string): string => name.replace(/[\\/]+$/, '').toUpperCase();

    const driveMap = new Map<string, {
      name: string;
      type: string;
      size: number;
      used: number;
      available: number;
    }>();

    for (const drive of drives) {
      const name = String(drive.fs ?? '').trim();
      if (!name) continue;
      const size = Number(drive.size ?? 0);
      const used = Number(drive.used ?? 0);
      const available = Math.max(size - used, 0);
      driveMap.set(normalizeDriveName(name), {
        name,
        type: String(drive.type ?? 'unknown'),
        size,
        used,
        available
      });
    }

    for (const volume of sqlVolumes) {
      const rawName = String(volume.volume_mount_point ?? volume.logical_volume_name ?? '').trim();
      if (!rawName) continue;
      const name = rawName.replace(/[\\/]+$/, '');
      const key = normalizeDriveName(name);
      const size = Number(volume.total_bytes ?? 0);
      const available = Number(volume.available_bytes ?? 0);
      const used = Math.max(size - available, 0);

      if (!driveMap.has(key) || driveMap.get(key)?.size === 0) {
        driveMap.set(key, {
          name,
          type: String(volume.file_system_type ?? 'unknown'),
          size,
          used,
          available
        });
      }
    }

    const mergedDrives = Array.from(driveMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    return {
      files,
      tempdb: tempdb ?? null,
      drives: mergedDrives
    };
  },

  async sessions(targetId?: string) {
    return runQuery<{
      session_id: number;
      host_name: string;
      program_name: string;
      login_name: string;
      status: string;
      login_time: string;
      database_name: string;
    }>(
      `
      SELECT
        s.session_id,
        COALESCE(host_name, '(unknown)') AS host_name,
        COALESCE(program_name, '(unknown)') AS program_name,
        COALESCE(s.login_name, '(unknown)') AS login_name,
        COALESCE(s.status, '(unknown)') AS status,
        s.login_time,
        COALESCE(DB_NAME(r.database_id), '(none)') AS database_name
      FROM sys.dm_exec_sessions s
      LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
      WHERE s.is_user_process = 1
      ORDER BY s.session_id DESC;
    `,
      targetId
    );
  },

  async killSession(sessionId: number, targetId?: string) {
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      throw new Error('Invalid session id');
    }

    const [currentSession] = await runQuery<{ current_session_id: number }>(
      'SELECT @@SPID AS current_session_id;',
      targetId
    );

    if (sessionId === Number(currentSession?.current_session_id ?? -1)) {
      throw new Error('Cannot kill the current monitoring session');
    }

    const [targetSession] = await runQuery<{
      session_id: number;
      is_user_process: boolean;
      login_name: string;
      host_name: string;
    }>(
      `
      SELECT
        session_id,
        is_user_process,
        login_name,
        host_name
      FROM sys.dm_exec_sessions
      WHERE session_id = ${sessionId};
      `,
      targetId
    );

    if (!targetSession) {
      throw new Error(`Session ${sessionId} does not exist`);
    }

    if (!targetSession.is_user_process || sessionId <= 50) {
      throw new Error(`Session ${sessionId} is protected and cannot be killed`);
    }

    await runQuery(`KILL ${sessionId};`, targetId);

    return {
      sessionId,
      loginName: targetSession.login_name,
      hostName: targetSession.host_name
    };
  },

  async topQueries(targetId?: string) {
    return runQuery<{
      execution_count: number;
      total_elapsed_time: number;
      avg_elapsed_ms: number;
      total_worker_time: number;
      total_logical_reads: number;
      query_text: string;
    }>(
      `
      SELECT TOP 20
        qs.execution_count,
        qs.total_elapsed_time,
        CAST(qs.total_elapsed_time * 1.0 / NULLIF(qs.execution_count, 0) AS DECIMAL(18,2)) AS avg_elapsed_ms,
        qs.total_worker_time,
        qs.total_logical_reads,
        SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
          ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
          ELSE qs.statement_end_offset END - qs.statement_start_offset)/2) + 1) AS query_text
      FROM sys.dm_exec_query_stats AS qs
      CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st
      ORDER BY qs.total_elapsed_time DESC;
    `,
      targetId
    );
  },

  async alerts(targetId?: string) {
    const blocking = await runQuery<{
      session_id: number;
      blocking_session_id: number;
      status: string;
      wait_type: string;
      wait_time: number;
      cpu_time: number;
      total_elapsed_time: number;
      database_name: string;
    }>(
      `
      SELECT
        r.session_id,
        r.blocking_session_id,
        r.status,
        r.wait_type,
        r.wait_time,
        r.cpu_time,
        r.total_elapsed_time,
        DB_NAME(r.database_id) AS database_name
      FROM sys.dm_exec_requests r
      WHERE r.blocking_session_id <> 0
      ORDER BY r.wait_time DESC;
    `,
      targetId
    );

    const failedJobs = await runQuery<{ job_name: string; run_date: number; run_time: number; error_message: string }>(
      `
      SELECT TOP 10
        j.name AS job_name,
        h.run_date,
        h.run_time,
        COALESCE(h.message, '(no error message)') AS error_message
      FROM msdb.dbo.sysjobhistory h
      JOIN msdb.dbo.sysjobs j ON h.job_id = j.job_id
      WHERE h.step_id = 0 AND h.run_status = 0
      ORDER BY h.instance_id DESC;
    `,
      targetId
    );

    return {
      blocking,
      failedJobs,
      severity: blocking.length > 0 || failedJobs.length > 0 ? 'high' : 'normal'
    };
  },

  async backups(targetId?: string) {
    return runQuery<{
      database_name: string;
      last_full_backup: string | null;
      last_diff_backup: string | null;
      last_log_backup: string | null;
    }>(
      `
      SELECT
        d.name AS database_name,
        MAX(CASE WHEN b.type = 'D' THEN b.backup_finish_date END) AS last_full_backup,
        MAX(CASE WHEN b.type = 'I' THEN b.backup_finish_date END) AS last_diff_backup,
        MAX(CASE WHEN b.type = 'L' THEN b.backup_finish_date END) AS last_log_backup
      FROM sys.databases d
      LEFT JOIN msdb.dbo.backupset b
        ON d.name = b.database_name
      GROUP BY d.name
      ORDER BY d.name;
    `,
      targetId
    );
  }
};

// --- New: PLE and Index Suggestions ---
export const pleAndSuggestionsService = {
  async ple(targetId?: string) {
    // PLE is exposed as cntr_value in dm_os_performance_counters.
    return runQuery<{
      node_id: number;
      node_name: string;
      page_life_expectancy: number;
    }>(
      `
      SELECT
        ROW_NUMBER() OVER (
          ORDER BY CASE WHEN instance_name = '_Total' THEN 1 ELSE 0 END, instance_name
        ) AS node_id,
        COALESCE(NULLIF(instance_name, ''), '_Total') AS node_name,
        CAST(cntr_value AS BIGINT) AS page_life_expectancy
      FROM sys.dm_os_performance_counters
      WHERE counter_name = 'Page life expectancy'
        AND object_name LIKE '%Buffer Manager%'
      ORDER BY node_id;
      `,
      targetId
    );
  },

  async suggestions(targetId?: string) {
    // Missing indexes
    const missingIndexes = await runQuery<{
      database_name: string;
      table_name: string;
      equality_columns: string;
      inequality_columns: string;
      included_columns: string;
      impact: number;
      create_statement: string;
    }>(
      `
      SELECT TOP 25
        DB_NAME(mid.database_id) AS database_name,
        COALESCE(OBJECT_SCHEMA_NAME(mid.object_id, mid.database_id) + '.', '')
          + OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
        COALESCE(mid.equality_columns, '') AS equality_columns,
        COALESCE(mid.inequality_columns, '') AS inequality_columns,
        COALESCE(mid.included_columns, '') AS included_columns,
        CAST(migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) AS DECIMAL(18, 2)) AS impact,
        'CREATE INDEX [IX_' + OBJECT_NAME(mid.object_id, mid.database_id) + '_' + CAST(mid.index_handle AS VARCHAR(20)) + '] ON '
          + QUOTENAME(DB_NAME(mid.database_id)) + '.'
          + QUOTENAME(COALESCE(OBJECT_SCHEMA_NAME(mid.object_id, mid.database_id), 'dbo')) + '.'
          + QUOTENAME(OBJECT_NAME(mid.object_id, mid.database_id))
          + ' (' + COALESCE(mid.equality_columns, '')
          + CASE
              WHEN mid.equality_columns IS NOT NULL AND mid.equality_columns <> ''
                AND mid.inequality_columns IS NOT NULL AND mid.inequality_columns <> ''
              THEN ', '
              ELSE ''
            END
          + COALESCE(mid.inequality_columns, '') + ')'
          + CASE
              WHEN mid.included_columns IS NOT NULL AND mid.included_columns <> ''
              THEN ' INCLUDE (' + mid.included_columns + ')'
              ELSE ''
            END AS create_statement
      FROM sys.dm_db_missing_index_group_stats AS migs
      INNER JOIN sys.dm_db_missing_index_groups AS mig
        ON migs.group_handle = mig.index_group_handle
      INNER JOIN sys.dm_db_missing_index_details AS mid
        ON mig.index_handle = mid.index_handle
      WHERE mid.database_id > 4
      ORDER BY impact DESC;
      `,
      targetId
    );

    // Fragmented indexes (recommend ALTER INDEX ... REBUILD)
    let fragmentedIndexes: Array<{
      database_name: string;
      table_name: string;
      index_name: string;
      avg_fragmentation_in_percent: number;
      alter_statement: string;
    }> = [];

    try {
      fragmentedIndexes = await runQuery<{
        database_name: string;
        table_name: string;
        index_name: string;
        avg_fragmentation_in_percent: number;
        alter_statement: string;
      }>(
        `
        SELECT TOP 50
          DB_NAME(ips.database_id) AS database_name,
          QUOTENAME(OBJECT_SCHEMA_NAME(ips.object_id, ips.database_id)) + '.'
            + QUOTENAME(OBJECT_NAME(ips.object_id, ips.database_id)) AS table_name,
          i.name AS index_name,
          CAST(ips.avg_fragmentation_in_percent AS DECIMAL(18, 2)) AS avg_fragmentation_in_percent,
          'ALTER INDEX ' + QUOTENAME(i.name) + ' ON '
            + QUOTENAME(OBJECT_SCHEMA_NAME(ips.object_id, ips.database_id)) + '.'
            + QUOTENAME(OBJECT_NAME(ips.object_id, ips.database_id))
            + ' REBUILD' AS alter_statement
        FROM sys.dm_db_index_physical_stats(NULL, NULL, NULL, NULL, 'LIMITED') AS ips
        INNER JOIN sys.indexes AS i
          ON ips.object_id = i.object_id
         AND ips.index_id = i.index_id
        WHERE ips.database_id > 4
          AND ips.avg_fragmentation_in_percent > 5
          AND i.index_id > 0
          AND i.name IS NOT NULL
          AND OBJECTPROPERTY(ips.object_id, 'IsMsShipped') = 0
        ORDER BY ips.avg_fragmentation_in_percent DESC;
        `,
        targetId
      );
    } catch {
      fragmentedIndexes = [];
    }

    // Fallback: when missing index DMV is empty, surface scan-heavy objects as tuning candidates.
    if (missingIndexes.length === 0) {
      const scanHeavy = await runQuery<{
        database_name: string;
        table_name: string;
        user_scans: number;
        user_seeks: number;
      }>(
        `
        SELECT TOP 25
          DB_NAME(ius.database_id) AS database_name,
          COALESCE(OBJECT_SCHEMA_NAME(ius.object_id, ius.database_id) + '.', '')
            + OBJECT_NAME(ius.object_id, ius.database_id) AS table_name,
          ius.user_scans,
          ius.user_seeks
        FROM sys.dm_db_index_usage_stats AS ius
        WHERE ius.database_id > 4
          AND ius.object_id > 0
          AND ius.user_scans > ius.user_seeks
        ORDER BY ius.user_scans DESC;
        `,
        targetId
      );

      const fallbackMissing = scanHeavy.map((row) => ({
        database_name: row.database_name,
        table_name: row.table_name,
        equality_columns: '',
        inequality_columns: '',
        included_columns: '',
        impact: Number(row.user_scans) - Number(row.user_seeks),
        create_statement: `Review scan-heavy object (${row.user_scans} scans vs ${row.user_seeks} seeks) and add supporting index for frequent predicates.`
      }));

      if (fallbackMissing.length > 0) {
        missingIndexes.push(...fallbackMissing);
      }
    }

    if (missingIndexes.length === 0) {
      missingIndexes.push({
        database_name: 'N/A',
        table_name: 'N/A',
        equality_columns: '',
        inequality_columns: '',
        included_columns: '',
        impact: 0,
        create_statement: 'No missing-index recommendation found currently. Keep monitoring after workload hours.'
      });
    }

    if (fragmentedIndexes.length === 0) {
      fragmentedIndexes.push({
        database_name: 'N/A',
        table_name: 'N/A',
        index_name: 'N/A',
        avg_fragmentation_in_percent: 0,
        alter_statement: 'No fragmented indexes above threshold currently.'
      });
    }

    return { missingIndexes, fragmentedIndexes };
  }
};

// --- Security & Access Monitoring ---
export const securityService = {
  async security(targetId?: string) {
    // 1. SQL Server logins with server role memberships
    const serverLogins = await runQuery<{
      login_name: string;
      login_type: string;
      is_disabled: number;
      is_policy_checked: number;
      is_expiration_checked: number;
      default_database: string;
      create_date: string;
      modify_date: string;
      server_roles: string;
    }>(
      `
      SELECT
        sp.name AS login_name,
        sp.type_desc AS login_type,
        CAST(sp.is_disabled AS INT) AS is_disabled,
        CAST(ISNULL(sl.is_policy_checked, 0) AS INT) AS is_policy_checked,
        CAST(ISNULL(sl.is_expiration_checked, 0) AS INT) AS is_expiration_checked,
        ISNULL(sp.default_database_name, 'master') AS default_database,
        CONVERT(VARCHAR(23), sp.create_date, 120) AS create_date,
        CONVERT(VARCHAR(23), sp.modify_date, 120) AS modify_date,
        ISNULL(
          STUFF((
            SELECT ',' + srole.name
            FROM sys.server_role_members srm
            JOIN sys.server_principals srole ON srm.role_principal_id = srole.principal_id
            WHERE srm.member_principal_id = sp.principal_id
            ORDER BY srole.name
            FOR XML PATH('')
          ), 1, 1, ''),
          ''
        ) AS server_roles
      FROM sys.server_principals sp
      LEFT JOIN sys.sql_logins sl ON sp.principal_id = sl.principal_id
      WHERE sp.type_desc IN ('SQL_LOGIN','WINDOWS_LOGIN','WINDOWS_GROUP','CERTIFICATE_MAPPED_LOGIN','ASYMMETRIC_KEY_MAPPED_LOGIN')
        AND sp.name NOT LIKE '##%'
      ORDER BY sp.name;
      `,
      targetId
    );

    // 2. Server-level roles and their members
    const serverRoles = await runQuery<{
      role_name: string;
      member_name: string;
      member_type: string;
      is_member_disabled: number;
    }>(
      `
      SELECT
        srole.name AS role_name,
        member.name AS member_name,
        member.type_desc AS member_type,
        CAST(member.is_disabled AS INT) AS is_member_disabled
      FROM sys.server_role_members srm
      JOIN sys.server_principals srole ON srm.role_principal_id = srole.principal_id
      JOIN sys.server_principals member ON srm.member_principal_id = member.principal_id
      WHERE member.name NOT LIKE '##%'
      ORDER BY srole.name, member.name;
      `,
      targetId
    );

    // 3. Database users with their database role memberships (across all user databases)
    const dbUsers = await runQuery<{
      database_name: string;
      user_name: string;
      user_type: string;
      login_name: string;
      default_schema: string;
      create_date: string;
      db_roles: string;
    }>(
      `
      SELECT
        DB_NAME() AS database_name,
        dp.name AS user_name,
        dp.type_desc AS user_type,
        ISNULL(sp.name, '') AS login_name,
        ISNULL(dp.default_schema_name, 'dbo') AS default_schema,
        CONVERT(VARCHAR(23), dp.create_date, 120) AS create_date,
        ISNULL(
          STUFF((
            SELECT ',' + drole.name
            FROM sys.database_role_members drm
            JOIN sys.database_principals drole ON drm.role_principal_id = drole.principal_id
            WHERE drm.member_principal_id = dp.principal_id
            ORDER BY drole.name
            FOR XML PATH('')
          ), 1, 1, ''),
          ''
        ) AS db_roles
      FROM sys.database_principals dp
      LEFT JOIN sys.server_principals sp ON dp.sid = sp.sid
      WHERE dp.type_desc IN ('SQL_USER','WINDOWS_USER','WINDOWS_GROUP','CERTIFICATE_MAPPED_USER','ASYMMETRIC_KEY_MAPPED_USER')
        AND dp.name NOT IN ('dbo','guest','INFORMATION_SCHEMA','sys')
      ORDER BY dp.name;
      `,
      targetId
    );

    // 4. Database-level roles and their members (current DB context)
    const dbRoles = await runQuery<{
      database_name: string;
      role_name: string;
      member_name: string;
      member_type: string;
    }>(
      `
      SELECT
        DB_NAME() AS database_name,
        drole.name AS role_name,
        member.name AS member_name,
        member.type_desc AS member_type
      FROM sys.database_role_members drm
      JOIN sys.database_principals drole ON drm.role_principal_id = drole.principal_id
      JOIN sys.database_principals member ON drm.member_principal_id = member.principal_id
      WHERE member.name NOT IN ('dbo','guest','INFORMATION_SCHEMA','sys')
      ORDER BY drole.name, member.name;
      `,
      targetId
    );

    // 5. Explicit object-level permissions for non-system principals
    const objectPermissions = await runQuery<{
      database_name: string;
      principal_name: string;
      principal_type: string;
      object_name: string;
      object_type: string;
      permission_name: string;
      permission_state: string;
    }>(
      `
      SELECT TOP 200
        DB_NAME() AS database_name,
        pr.name AS principal_name,
        pr.type_desc AS principal_type,
        ISNULL(OBJECT_NAME(pe.major_id), '') AS object_name,
        ISNULL(o.type_desc, pe.class_desc) AS object_type,
        pe.permission_name,
        pe.state_desc AS permission_state
      FROM sys.database_permissions pe
      JOIN sys.database_principals pr ON pe.grantee_principal_id = pr.principal_id
      LEFT JOIN sys.objects o ON pe.major_id = o.object_id
      WHERE pr.name NOT IN ('dbo','guest','INFORMATION_SCHEMA','sys','public')
        AND pr.type_desc NOT IN ('DATABASE_ROLE')
        AND pe.class_desc IN ('OBJECT_OR_COLUMN','DATABASE','SCHEMA')
      ORDER BY pr.name, ISNULL(OBJECT_NAME(pe.major_id), ''), pe.permission_name;
      `,
      targetId
    );

    return { serverLogins, serverRoles, dbUsers, dbRoles, objectPermissions };
  }
};
