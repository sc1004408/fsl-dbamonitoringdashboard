import { runQuery } from './db';

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

    return {
      status: 'up',
      serverName: uptime?.server_name ?? null,
      sqlVersion: uptime?.sql_version ?? null,
      sqlServerStartTime: uptime?.sqlserver_start_time ?? null,
      uptimeMinutes: uptime?.uptime_minutes ?? null,
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

    return {
      topWaits: waits,
      activeRequests
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
    }>(`
      SELECT
        DB_NAME(mf.database_id) AS database_name,
        mf.type_desc,
        mf.name AS logical_name,
        CAST(mf.size * 8.0 / 1024 AS DECIMAL(18,2)) AS file_size_mb,
        CAST(FILEPROPERTY(mf.name, 'SpaceUsed') * 8.0 / 1024 AS DECIMAL(18,2)) AS used_mb,
        CAST((mf.size - FILEPROPERTY(mf.name, 'SpaceUsed')) * 8.0 / 1024 AS DECIMAL(18,2)) AS free_mb
      FROM sys.master_files mf
      ORDER BY database_name, mf.type_desc;
    `, targetId);

    const [tempdb] = await runQuery<{
      user_object_mb: number;
      internal_object_mb: number;
      version_store_mb: number;
      free_space_mb: number;
    }>(`
      SELECT
        SUM(user_object_reserved_page_count) * 8.0 / 1024 AS user_object_mb,
        SUM(internal_object_reserved_page_count) * 8.0 / 1024 AS internal_object_mb,
        SUM(version_store_reserved_page_count) * 8.0 / 1024 AS version_store_mb,
        SUM(unallocated_extent_page_count) * 8.0 / 1024 AS free_space_mb
      FROM tempdb.sys.dm_db_file_space_usage;
    `, targetId);

    return {
      files,
      tempdb: tempdb ?? null
    };
  },

  async sessions(targetId?: string) {
    return runQuery<{ host_name: string; program_name: string; session_count: number }>(`
      SELECT
        COALESCE(host_name, '(unknown)') AS host_name,
        COALESCE(program_name, '(unknown)') AS program_name,
        COUNT(*) AS session_count
      FROM sys.dm_exec_sessions
      WHERE is_user_process = 1
      GROUP BY host_name, program_name
      ORDER BY session_count DESC;
    `, targetId);
  },

  async topQueries(targetId?: string) {
    return runQuery<{
      execution_count: number;
      total_elapsed_time: number;
      avg_elapsed_ms: number;
      total_worker_time: number;
      total_logical_reads: number;
      query_text: string;
    }>(`
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
    `, targetId);
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
    }>(`
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
    `, targetId);

    const failedJobs = await runQuery<{ job_name: string; run_date: number; run_time: number }>(`
      SELECT TOP 10 j.name AS job_name, h.run_date, h.run_time
      FROM msdb.dbo.sysjobhistory h
      JOIN msdb.dbo.sysjobs j ON h.job_id = j.job_id
      WHERE h.step_id = 0 AND h.run_status = 0
      ORDER BY h.instance_id DESC;
    `, targetId);

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
    }>(`
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
    `, targetId);
  }
};
