-- SQL Server deep diagnosis and tuning queries (manual/investigation use)
-- Some queries are expensive and should not run at high frequency.

SET NOCOUNT ON;

/* 1) CPU signal wait profile */
WITH wait_data AS (
  SELECT
    wait_type,
    wait_time_ms,
    signal_wait_time_ms,
    waiting_tasks_count
  FROM sys.dm_os_wait_stats
  WHERE wait_type NOT LIKE 'SLEEP%'
    AND wait_type NOT IN (
      'BROKER_EVENTHANDLER','BROKER_RECEIVE_WAITFOR','BROKER_TASK_STOP',
      'SQLTRACE_BUFFER_FLUSH','CLR_AUTO_EVENT','CLR_MANUAL_EVENT',
      'LAZYWRITER_SLEEP','XE_DISPATCHER_WAIT','XE_TIMER_EVENT'
    )
)
SELECT TOP 30
  wait_type,
  wait_time_ms,
  signal_wait_time_ms,
  waiting_tasks_count,
  CAST(100.0 * signal_wait_time_ms / NULLIF(wait_time_ms, 0) AS DECIMAL(10,2)) AS signal_wait_ratio_percent
FROM wait_data
ORDER BY wait_time_ms DESC;

/* 2) Top CPU-consuming cached statements */
SELECT TOP 30
  qs.execution_count,
  qs.total_worker_time,
  CAST(qs.total_worker_time * 1.0 / NULLIF(qs.execution_count, 0) AS DECIMAL(18,2)) AS avg_cpu_ms,
  qs.total_elapsed_time,
  qs.total_logical_reads,
  qs.total_logical_writes,
  SUBSTRING(st.text,
    (qs.statement_start_offset / 2) + 1,
    ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
      ELSE qs.statement_end_offset END - qs.statement_start_offset) / 2) + 1
  ) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_worker_time DESC;

/* 3) Top elapsed-time cached statements */
SELECT TOP 30
  qs.execution_count,
  qs.total_elapsed_time,
  CAST(qs.total_elapsed_time * 1.0 / NULLIF(qs.execution_count, 0) AS DECIMAL(18,2)) AS avg_elapsed_ms,
  qs.total_worker_time,
  qs.total_logical_reads,
  SUBSTRING(st.text,
    (qs.statement_start_offset / 2) + 1,
    ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
      ELSE qs.statement_end_offset END - qs.statement_start_offset) / 2) + 1
  ) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_elapsed_time DESC;

/* 4) Missing index candidates */
SELECT TOP 50
  DB_NAME(d.database_id) AS database_name,
  OBJECT_SCHEMA_NAME(d.object_id, d.database_id) AS schema_name,
  OBJECT_NAME(d.object_id, d.database_id) AS table_name,
  CAST(gs.avg_total_user_cost AS DECIMAL(18,2)) AS avg_total_user_cost,
  CAST(gs.avg_user_impact AS DECIMAL(18,2)) AS avg_user_impact,
  gs.user_seeks,
  gs.user_scans,
  d.equality_columns,
  d.inequality_columns,
  d.included_columns
FROM sys.dm_db_missing_index_group_stats gs
JOIN sys.dm_db_missing_index_groups g
  ON gs.group_handle = g.index_group_handle
JOIN sys.dm_db_missing_index_details d
  ON g.index_handle = d.index_handle
ORDER BY (gs.avg_total_user_cost * gs.avg_user_impact * (gs.user_seeks + gs.user_scans)) DESC;

/* 5) Unused indexes (review before drop) */
SELECT TOP 100
  DB_NAME() AS database_name,
  OBJECT_SCHEMA_NAME(i.object_id) AS schema_name,
  OBJECT_NAME(i.object_id) AS table_name,
  i.name AS index_name,
  ISNULL(s.user_seeks, 0) AS user_seeks,
  ISNULL(s.user_scans, 0) AS user_scans,
  ISNULL(s.user_lookups, 0) AS user_lookups,
  ISNULL(s.user_updates, 0) AS user_updates
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats s
  ON s.object_id = i.object_id
 AND s.index_id = i.index_id
 AND s.database_id = DB_ID()
WHERE i.index_id > 1
  AND i.is_primary_key = 0
  AND i.is_unique_constraint = 0
  AND ISNULL(s.user_seeks, 0) = 0
  AND ISNULL(s.user_scans, 0) = 0
  AND ISNULL(s.user_lookups, 0) = 0
ORDER BY user_updates DESC;

/* 6) Index fragmentation candidates */
SELECT TOP 100
  OBJECT_SCHEMA_NAME(ps.object_id) AS schema_name,
  OBJECT_NAME(ps.object_id) AS table_name,
  i.name AS index_name,
  ps.index_type_desc,
  ps.page_count,
  CAST(ps.avg_fragmentation_in_percent AS DECIMAL(10,2)) AS avg_fragmentation_in_percent
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ps
JOIN sys.indexes i
  ON ps.object_id = i.object_id
 AND ps.index_id = i.index_id
WHERE ps.page_count >= 1000
ORDER BY ps.avg_fragmentation_in_percent DESC;

/* 7) Statistics update candidates */
SELECT TOP 100
  OBJECT_SCHEMA_NAME(s.object_id) AS schema_name,
  OBJECT_NAME(s.object_id) AS table_name,
  s.name AS stats_name,
  sp.last_updated,
  sp.rows,
  sp.rows_sampled,
  sp.modification_counter
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE sp.modification_counter > 1000
ORDER BY sp.modification_counter DESC;

/* 8) Memory grant pressure */
SELECT
  requested_memory_kb,
  granted_memory_kb,
  required_memory_kb,
  ideal_memory_kb,
  wait_time_ms,
  queue_id,
  dop,
  DB_NAME(st.dbid) AS database_name,
  st.text AS sql_text
FROM sys.dm_exec_query_memory_grants mg
CROSS APPLY sys.dm_exec_sql_text(mg.sql_handle) st
ORDER BY wait_time_ms DESC;

/* 9) File-level I/O stalls */
SELECT
  DB_NAME(vfs.database_id) AS database_name,
  mf.physical_name,
  vfs.num_of_reads,
  vfs.num_of_writes,
  vfs.io_stall_read_ms,
  vfs.io_stall_write_ms,
  CAST(vfs.io_stall_read_ms * 1.0 / NULLIF(vfs.num_of_reads, 0) AS DECIMAL(18,2)) AS avg_read_stall_ms,
  CAST(vfs.io_stall_write_ms * 1.0 / NULLIF(vfs.num_of_writes, 0) AS DECIMAL(18,2)) AS avg_write_stall_ms
FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
JOIN sys.master_files mf
  ON vfs.database_id = mf.database_id
 AND vfs.file_id = mf.file_id
ORDER BY (vfs.io_stall_read_ms + vfs.io_stall_write_ms) DESC;

/* 10) Plan cache bloat and single-use ad hoc plans */
SELECT
  objtype,
  cacheobjtype,
  COUNT(*) AS plan_count,
  SUM(CAST(size_in_bytes AS BIGINT)) / 1024 / 1024 AS total_size_mb
FROM sys.dm_exec_cached_plans
GROUP BY objtype, cacheobjtype
ORDER BY total_size_mb DESC;

SELECT
  COUNT(*) AS single_use_adhoc_plans,
  SUM(CAST(size_in_bytes AS BIGINT)) / 1024 / 1024 AS single_use_adhoc_mb
FROM sys.dm_exec_cached_plans
WHERE objtype = 'Adhoc'
  AND usecounts = 1;

/* 11) Deadlock reports from system_health XEL */
SELECT TOP 20
  CAST(event_data AS XML) AS deadlock_report_xml,
  DATEADD(HOUR, DATEDIFF(HOUR, GETUTCDATE(), SYSDATETIME()),
    CAST(event_data AS XML).value('(event/@timestamp)[1]', 'datetime2')) AS local_deadlock_time
FROM sys.fn_xe_file_target_read_file('system_health*.xel', NULL, NULL, NULL)
WHERE object_name = 'xml_deadlock_report'
ORDER BY local_deadlock_time DESC;

/* 12) VLF count check */
SELECT
  DB_NAME(database_id) AS database_name,
  COUNT(*) AS vlf_count
FROM sys.dm_db_log_info(NULL)
GROUP BY database_id
ORDER BY vlf_count DESC;
