import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { runTaskInBackground } from '@repo/orchestrator';

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

const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  description: z.string().trim().min(1, 'description is required'),
  source: z.enum(['manual', 'jira', 'github']),
  sourceId: z.string().trim().min(1).optional(),
  workspaceId: z.string().trim().min(1).optional(),
  orgId: z.string().trim().min(1).optional(),
});

app.post('/tasks', (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid task payload',
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const task = runTaskInBackground(parsed.data);

  res.status(202).json(task);
});

app.listen(port, () => {
  logger.info({ port }, 'API server listening');
});
