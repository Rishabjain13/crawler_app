import express from 'express';
import cors    from 'cors';
import { logger } from './logger.js';
import {
  handleStartCrawl,
  handleGetJob,
  handleStreamJob,
} from './api/crawl-handler.js';
import { closePlaywright } from './crawler/js-crawler.js';

// ── Port validation ───────────────────────────────────────────────────────────
const rawPort = parseInt(process.env.PORT ?? '3001', 10);
if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
  logger.error('PORT must be an integer between 1 and 65535');
  process.exit(1);
}
const PORT = rawPort;

// ── CORS — explicit allowlist instead of wildcard ────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const app = express();

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no Origin header (curl, same-origin, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not in allowlist`));
  },
  methods:     ['GET', 'POST'],
  credentials: false,
}));

// 64 KB body limit — more than enough for a crawl config payload
app.use(express.json({ limit: '64kb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.post('/api/crawl',                 handleStartCrawl);  // start job → 202 + jobId
app.get('/api/jobs/:jobId',            handleGetJob);       // poll status + results
app.get('/api/jobs/:jobId/stream',     handleStreamJob);    // SSE live stream

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info({ allowedOrigins }, `Crawler API listening on http://localhost:${PORT}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down...');
  await closePlaywright();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
