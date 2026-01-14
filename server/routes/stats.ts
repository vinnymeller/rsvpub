import { Router, Request, Response } from 'express';
import type { DB } from '../db';

interface BookParams {
  hash: string;
}

export function createStatsRouter(db: DB): Router {
  const router = Router({ mergeParams: true });

  // GET /api/books/:hash/stats - Get reading stats
  router.get('/', (req: Request<BookParams>, res: Response) => {
    try {
      const { hash } = req.params;

      const book = db.getBook(hash);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const aggregate = db.getAggregateStats(hash);
      const sessions = db.getStats(hash);

      res.json({
        aggregate: {
          totalSessions: aggregate.totalSessions,
          totalWordsRead: aggregate.totalWordsRead,
          totalTimeMs: aggregate.totalTimeMs,
          overallAvgWpm: aggregate.overallAvgWpm,
        },
        sessions: sessions.map((s) => ({
          id: s.id,
          sessionStart: s.session_start,
          sessionEnd: s.session_end,
          wordsRead: s.words_read,
          avgWpm: s.avg_wpm,
          durationMs: s.session_end - s.session_start,
        })),
      });
    } catch (err) {
      console.error('Failed to get stats:', err);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

  // POST /api/books/:hash/stats - Save session stats
  router.post('/', (req: Request<BookParams>, res: Response) => {
    try {
      const { hash } = req.params;
      const { sessionStart, sessionEnd, wordsRead, avgWpm } = req.body;

      const book = db.getBook(hash);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      // Validate required fields
      if (
        typeof sessionStart !== 'number' ||
        typeof sessionEnd !== 'number' ||
        typeof wordsRead !== 'number'
      ) {
        return res.status(400).json({ error: 'Invalid stats data' });
      }

      const stat = db.addSession(hash, sessionStart, sessionEnd, wordsRead, avgWpm);

      res.status(201).json({
        id: stat.id,
        sessionStart: stat.session_start,
        sessionEnd: stat.session_end,
        wordsRead: stat.words_read,
        avgWpm: stat.avg_wpm,
        durationMs: stat.session_end - stat.session_start,
      });
    } catch (err) {
      console.error('Failed to save stats:', err);
      res.status(500).json({ error: 'Failed to save stats' });
    }
  });

  return router;
}
