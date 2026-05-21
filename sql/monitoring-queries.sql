-- SQL Server monitoring query index
-- This file now serves as a catalog for two dedicated packs:
--
-- 1) monitoring-queries-lite.sql
--    - Lightweight health/performance checks for frequent dashboard polling.
--
-- 2) monitoring-queries-deep-diagnosis.sql
--    - Deep diagnostics and tuning queries for DBA investigation sessions.
--
-- NOTE:
-- 1) Run as a login with VIEW SERVER STATE and appropriate DB rights.
-- 2) Some DMVs reset after SQL Server restart.
-- 3) Review tuning suggestions before making production changes.

SELECT
  'Use sql/monitoring-queries-lite.sql for periodic monitoring.' AS guidance_1,
  'Use sql/monitoring-queries-deep-diagnosis.sql for deep troubleshooting.' AS guidance_2;

