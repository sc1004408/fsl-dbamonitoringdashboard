-- SQL Server lightweight monitoring queries (safe for frequent polling)
-- Intended for dashboard refresh jobs and quick health checks.

SET NOCOUNT ON;

/* 1) Server uptime and version */
SELECT
  @@SERVERNAME AS server_name,
  @@VERSION AS sql_version,
  sqlserver_start_time,
  DATEDIFF(MINUTE, sqlserver_start_time, SYSDATETIME()) AS uptime_minutes
FROM sys.dm_os_sys_info;

/* 2) Top waits (quick signal) */
SELECT TOP 20
  wait_type,
  wait_time_ms,
  waiting_tasks_count,
  CAST(wait_time_ms * 1.0 / NULLIF(waiting_tasks_count, 0) AS DECIMAL(18,2)) AS avg_wait_ms
FROM sys.dm_os_wait_stats
WHERE wait_type NOT LIKE 'SLEEP%'
ORDER BY wait_time_ms DESC;

/* 3) Current active requests */
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

/* 4) Current blocking sessions */
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

/* 5) Active user sessions by host/app */
SELECT
  COALESCE(host_name, '(unknown)') AS host_name,
  COALESCE(program_name, '(unknown)') AS program_name,
  COUNT(*) AS session_count
FROM sys.dm_exec_sessions
WHERE is_user_process = 1
GROUP BY host_name, program_name
ORDER BY session_count DESC;

/* 6) DB file size and free space */
SELECT
  DB_NAME(mf.database_id) AS database_name,
  mf.type_desc,
  mf.name AS logical_name,
  CAST(mf.size * 8.0 / 1024 AS DECIMAL(18,2)) AS file_size_mb,
  CAST(FILEPROPERTY(mf.name, 'SpaceUsed') * 8.0 / 1024 AS DECIMAL(18,2)) AS used_mb,
  CAST((mf.size - FILEPROPERTY(mf.name, 'SpaceUsed')) * 8.0 / 1024 AS DECIMAL(18,2)) AS free_mb
FROM sys.master_files mf
ORDER BY database_name, mf.type_desc;

/* 7) TempDB utilization */
SELECT
  SUM(user_object_reserved_page_count) * 8.0 / 1024 AS user_object_mb,
  SUM(internal_object_reserved_page_count) * 8.0 / 1024 AS internal_object_mb,
  SUM(version_store_reserved_page_count) * 8.0 / 1024 AS version_store_mb,
  SUM(unallocated_extent_page_count) * 8.0 / 1024 AS free_space_mb
FROM tempdb.sys.dm_db_file_space_usage;

/* 8) Backup freshness */
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
