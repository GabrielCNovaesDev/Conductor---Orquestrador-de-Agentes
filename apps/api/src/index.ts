import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

const logger = pino({
  name: 'api',
  level: process.env.LOG_LEVEL ?? 'info',
});
const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  logger.info({ port }, 'API server listening');
});
