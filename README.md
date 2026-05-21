# DB Monitoring AI

A full-stack monitoring website for SQL Server with an AI mode that summarizes health and performance from A to Z.

## Architecture

- Frontend: React + Vite dashboard
- Backend: Node.js + Express API
- Database target: SQL Server host on same machine as app host
- AI mode: local summarizer by default, optional OpenAI integration

## Key Features

- Health and uptime monitoring
- CPU and wait diagnostics
- Storage usage by database
- Active session visibility
- Top expensive query tracking
- Alert feed (blocking + failed jobs)
- AI mode for action-oriented recommendations

## Project Structure

- apps/backend: API and SQL Server monitoring logic
- apps/frontend: Monitoring dashboard UI
- sql: raw monitoring SQL snippets
- deploy/iis: IIS reverse proxy config and prerequisites

## 1) Prerequisites on INCH-VITFS01

1. Install Node.js 20 LTS.
2. Ensure SQL Server is reachable locally on port 1433.
3. Create a SQL login with read access to DMVs and msdb job history.
4. (For IIS hosting) install IIS URL Rewrite and ARR modules.

## 2) Configure Environment

Create `.env` in the repository root:

```env
DB_HOST=INCH-VITFS01
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=your_password_here
DB_NAME=master
APP_PORT=4000
CORS_ORIGIN=http://INCH-VITFS01
AI_PROVIDER=local
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
DB_TARGETS_ENCRYPTION_KEY=use_a_long_random_secret
```

`DB_TARGETS_ENCRYPTION_KEY` is used to encrypt stored DB server connection strings at rest.

## 3) Local Run

```powershell
npm install
npm run dev
npm run dev:frontend
```

- Backend API: `http://localhost:4000/api/ping`
- Frontend: `http://localhost:5173`

Key API endpoints:
- `GET /api/health`
- `GET /api/performance`
- `GET /api/storage`
- `GET /api/sessions`
- `GET /api/queries`
- `GET /api/alerts`
- `GET /api/backups`

## 4) Production Build

```powershell
npm install
npm run build
npm run start
```


## 5) Localhost Auto-Start Deployment

### Auto-Start (Recommended for Windows)

1. Backend and frontend are configured to auto-start at user logon using Windows Startup folder entries:
	- Backend: `deploy/windows/start-backend.cmd` (runs on port 4000)
	- Frontend: `deploy/windows/start-frontend.cmd` (runs on port 5173)
2. Startup entries are created in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.
3. No admin rights or Task Scheduler required.
4. To trigger manually, double-click the CMD files above or restart your PC and log in.

### Manual Start (for troubleshooting)

```powershell
cd C:\Users\sc1004408\db-monitoring-ai
start deploy\windows\start-backend.cmd
start deploy\windows\start-frontend.cmd
```

### Access URLs

- Backend API: `http://localhost:4000/api/ping`
- Frontend: `http://localhost:5173`

### Logs

- Backend: `logs/backend.out.log`, `logs/backend.err.log`
- Frontend: `logs/frontend.out.log`, `logs/frontend.err.log`

### Notes

- If you see port conflicts, close any old Node/serve/Vite processes and re-run the startup scripts.
- PowerShell execution policy is not required; all launchers are `.cmd` files.

## 6) AI Mode

- Default (`AI_PROVIDER=local`): built-in summarizer with recommendations.
- OpenAI (`AI_PROVIDER=openai`): set `OPENAI_API_KEY` to generate model-based insights.

## Security Notes

- API has `helmet`, CORS, and rate limiting enabled.
- Use a least-privilege SQL login for monitoring.
- Avoid exposing backend directly to internet; place behind firewall and IIS reverse proxy.

## Test

```powershell
npm run test
```
