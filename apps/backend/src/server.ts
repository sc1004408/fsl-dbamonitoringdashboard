import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
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
app.use(errorHandler);

app.listen(env.APP_PORT, () => {
  console.log(`Backend started on port ${env.APP_PORT}`);
});
