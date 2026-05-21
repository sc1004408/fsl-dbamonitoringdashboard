-- Migration: Create table for dashboard snapshots in DBA_Monitoring
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DashboardSnapshots')
BEGIN
  CREATE TABLE [dbo].[DashboardSnapshots] (
    [id] INT IDENTITY(1,1) PRIMARY KEY,
    [capturedAt] DATETIME2 NOT NULL,
    [targetId] NVARCHAR(100) NOT NULL,
    [health] NVARCHAR(MAX) NOT NULL,
    [performance] NVARCHAR(MAX) NOT NULL,
    [storage] NVARCHAR(MAX) NOT NULL,
    [sessions] NVARCHAR(MAX) NOT NULL,
    [queries] NVARCHAR(MAX) NOT NULL,
    [alerts] NVARCHAR(MAX) NOT NULL,
    [backups] NVARCHAR(MAX) NOT NULL
  );
END
