import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import helmet from 'helmet';
import path from 'path';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { monitoringRouter } from './routes/monitoringRoutes';

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 120 }));

app.get('/api/ping', (_req, res) => {
  res.json({ message: 'DB Monitoring API online' });
});

app.use('/api', monitoringRouter);

const frontendDistPath = path.resolve(process.cwd(), 'apps/frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.use(errorHandler);

app.listen(env.APP_PORT, () => {
  console.log(`Backend started on port ${env.APP_PORT}`);
});
