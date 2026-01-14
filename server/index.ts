import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { loadConfig, ensureStorageDirs } from './config';
import { DB } from './db';
import { createBooksRouter } from './routes/books';
import { createCheckpointsRouter } from './routes/checkpoints';
import { createStatsRouter } from './routes/stats';

async function main() {
  const config = loadConfig();
  ensureStorageDirs(config);

  const db = await DB.create(config);
  const app = express();

  // Middleware
  app.use(express.json());

  // API routes
  app.use('/api/books', createBooksRouter(db, config));
  app.use('/api/books/:hash/checkpoints', createCheckpointsRouter(db));
  app.use('/api/books/:hash/stats', createStatsRouter(db));

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    // Development: use Vite as middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve static files
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.join(__dirname, '..', 'dist');

    if (!fs.existsSync(distPath)) {
      console.error('Production build not found. Run `npm run build` first.');
      process.exit(1);
    }

    app.use(express.static(distPath));

    // SPA fallback
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start server
  app.listen(config.server.port, config.server.host, () => {
    console.log(`\nRSVPub server running at:`);
    console.log(`  http://${config.server.host}:${config.server.port}`);
    console.log(`\nData directory: ${config.storage.dataDir}`);
    console.log(`Mode: ${isDev ? 'development' : 'production'}\n`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    db.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
