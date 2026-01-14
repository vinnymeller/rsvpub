import { Router, Request, Response } from 'express';
import type { DB } from '../db';

interface BookParams {
  hash: string;
}

export function createCheckpointsRouter(db: DB): Router {
  const router = Router({ mergeParams: true });

  // GET /api/books/:hash/checkpoints/position - Get current position
  router.get('/position', (req: Request<BookParams>, res: Response) => {
    try {
      const { hash } = req.params;

      const book = db.getBook(hash);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const position = db.getPosition(hash);
      res.json(position);
    } catch (err) {
      console.error('Failed to get position:', err);
      res.status(500).json({ error: 'Failed to get position' });
    }
  });

  // PUT /api/books/:hash/checkpoints/position - Update current position
  router.put('/position', (req: Request<BookParams>, res: Response) => {
    try {
      const { hash } = req.params;
      const { chapterIndex, paragraphIndex, wordIndex, wpm, chapterTitle } = req.body;

      const book = db.getBook(hash);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      if (
        typeof chapterIndex !== 'number' ||
        typeof paragraphIndex !== 'number' ||
        typeof wordIndex !== 'number' ||
        typeof wpm !== 'number'
      ) {
        return res.status(400).json({ error: 'Invalid position data' });
      }

      db.updatePosition(hash, chapterIndex, paragraphIndex, wordIndex, wpm, chapterTitle);

      res.json({
        chapterIndex,
        paragraphIndex,
        wordIndex,
        wpm,
        chapterTitle,
      });
    } catch (err) {
      console.error('Failed to update position:', err);
      res.status(500).json({ error: 'Failed to update position' });
    }
  });

  return router;
}
