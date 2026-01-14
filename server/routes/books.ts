import { Router } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import type { DB } from '../db';
import type { AppConfig } from '../config';
import { hashBuffer } from '../utils/hash';
import { extractEpubMetadata } from '../utils/epub-metadata';

export function createBooksRouter(db: DB, config: AppConfig): Router {
  const router = Router();

  // Configure multer for file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'application/epub+zip' || file.originalname.endsWith('.epub')) {
        cb(null, true);
      } else {
        cb(new Error('Only EPUB files are allowed'));
      }
    },
  });

  // GET /api/books - List all books
  router.get('/', (_req, res) => {
    try {
      const books = db.getAllBooks();

      // Add position for each book (from book record directly)
      const booksWithPosition = books.map((book) => {
        const position = db.getPosition(book.hash);
        return {
          id: book.id,
          hash: book.hash,
          filename: book.filename,
          title: book.title,
          author: book.author,
          added_at: book.added_at,
          last_read_at: book.last_read_at,
          position,
        };
      });

      res.json(booksWithPosition);
    } catch (err) {
      console.error('Failed to list books:', err);
      res.status(500).json({ error: 'Failed to list books' });
    }
  });

  // POST /api/books - Upload new EPUB
  router.post('/', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const buffer = req.file.buffer;
      const hash = hashBuffer(buffer);
      const filename = req.file.originalname;

      // Check if book already exists
      const existing = db.getBook(hash);
      if (existing) {
        // Include position data for existing books
        const position = db.getPosition(hash);
        return res.json({
          id: existing.id,
          hash: existing.hash,
          filename: existing.filename,
          title: existing.title,
          author: existing.author,
          added_at: existing.added_at,
          last_read_at: existing.last_read_at,
          alreadyExists: true,
          position,
        });
      }

      // Extract metadata from EPUB
      const metadata = await extractEpubMetadata(buffer);

      // Save file to disk
      const filePath = path.join(config.storage.booksDir, `${hash}.epub`);
      fs.writeFileSync(filePath, buffer);

      // Add to database with extracted metadata
      const book = db.addBook(hash, filename, metadata.title ?? undefined, metadata.author ?? undefined);

      res.status(201).json(book);
    } catch (err) {
      console.error('Failed to upload book:', err);
      res.status(500).json({ error: 'Failed to upload book' });
    }
  });

  // GET /api/books/:hash - Get book info
  router.get('/:hash', (req, res) => {
    try {
      const book = db.getBook(req.params.hash);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const position = db.getPosition(book.hash);
      const stats = db.getAggregateStats(book.hash);

      res.json({
        id: book.id,
        hash: book.hash,
        filename: book.filename,
        title: book.title,
        author: book.author,
        added_at: book.added_at,
        last_read_at: book.last_read_at,
        position,
        stats,
      });
    } catch (err) {
      console.error('Failed to get book:', err);
      res.status(500).json({ error: 'Failed to get book' });
    }
  });

  // PUT /api/books/:hash - Update book metadata
  router.put('/:hash', (req, res) => {
    try {
      const book = db.getBook(req.params.hash);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const { title, author } = req.body;
      const updated = db.addBook(book.hash, book.filename, title, author);

      res.json(updated);
    } catch (err) {
      console.error('Failed to update book:', err);
      res.status(500).json({ error: 'Failed to update book' });
    }
  });

  // GET /api/books/:hash/file - Download EPUB file
  router.get('/:hash/file', (req, res) => {
    try {
      const book = db.getBook(req.params.hash);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const filePath = path.join(config.storage.booksDir, `${book.hash}.epub`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Book file not found' });
      }

      // Update last read timestamp
      db.updateLastRead(book.hash);

      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Disposition', `attachment; filename="${book.filename}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error('Failed to download book:', err);
      res.status(500).json({ error: 'Failed to download book' });
    }
  });

  // DELETE /api/books/:hash - Remove book
  router.delete('/:hash', (req, res) => {
    try {
      const book = db.getBook(req.params.hash);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      // Delete file
      const filePath = path.join(config.storage.booksDir, `${book.hash}.epub`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete from database
      db.deleteBook(book.hash);

      res.json({ success: true });
    } catch (err) {
      console.error('Failed to delete book:', err);
      res.status(500).json({ error: 'Failed to delete book' });
    }
  });

  return router;
}
