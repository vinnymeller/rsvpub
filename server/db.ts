import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import type { AppConfig } from './config';

export interface BookRecord {
  id: number;
  hash: string;
  filename: string;
  title: string | null;
  author: string | null;
  added_at: number;
  last_read_at: number | null;
  // Position fields (stored directly on book)
  position_chapter: number;
  position_paragraph: number;
  position_word: number;
  position_wpm: number;
  position_chapter_title: string | null;
}

export interface CheckpointRecord {
  id: number;
  book_hash: string;
  chapter_index: number;
  paragraph_index: number;
  word_index: number;
  wpm: number;
  chapter_title: string | null;
  created_at: number;
}

export interface StatsRecord {
  id: number;
  book_hash: string;
  session_start: number;
  session_end: number;
  words_read: number;
  avg_wpm: number | null;
}

const SCHEMA = `
-- Books table (identified by hash)
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  hash TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  title TEXT,
  author TEXT,
  added_at INTEGER NOT NULL,
  last_read_at INTEGER
);

-- Reading checkpoints (history)
CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY,
  book_hash TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  paragraph_index INTEGER NOT NULL,
  word_index INTEGER NOT NULL,
  wpm INTEGER NOT NULL,
  chapter_title TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_hash) REFERENCES books(hash)
);

-- Reading stats
CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY,
  book_hash TEXT NOT NULL,
  session_start INTEGER NOT NULL,
  session_end INTEGER NOT NULL,
  words_read INTEGER NOT NULL,
  avg_wpm REAL,
  FOREIGN KEY (book_hash) REFERENCES books(hash)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_checkpoints_book ON checkpoints(book_hash);
CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints(created_at);
CREATE INDEX IF NOT EXISTS idx_stats_book ON stats(book_hash);
`;

export class DB {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  static async create(config: AppConfig): Promise<DB> {
    const instance = new DB(config.storage.dbPath);
    await instance.init();
    return instance;
  }

  private async init(): Promise<void> {
    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    // Run schema
    this.db.run(SCHEMA);

    // Migration: add chapter_title column if it doesn't exist
    try {
      this.db.run('ALTER TABLE checkpoints ADD COLUMN chapter_title TEXT');
    } catch {
      // Column already exists, ignore
    }

    // Migration: add position columns to books table
    const positionMigrations = [
      'ALTER TABLE books ADD COLUMN position_chapter INTEGER DEFAULT 0',
      'ALTER TABLE books ADD COLUMN position_paragraph INTEGER DEFAULT 0',
      'ALTER TABLE books ADD COLUMN position_word INTEGER DEFAULT 0',
      'ALTER TABLE books ADD COLUMN position_wpm INTEGER DEFAULT 300',
      'ALTER TABLE books ADD COLUMN position_chapter_title TEXT',
    ];

    for (const sql of positionMigrations) {
      try {
        this.db.run(sql);
      } catch {
        // Column already exists, ignore
      }
    }

    // Migrate existing checkpoint data to position fields
    this.migrateCheckpointsToPosition();

    this.save();
  }

  private migrateCheckpointsToPosition(): void {
    // Get all books that might need migration
    const books = this.getAllBooks();

    for (const book of books) {
      // Check if position is at default (0,0,0) and checkpoints exist
      if (
        book.position_chapter === 0 &&
        book.position_paragraph === 0 &&
        book.position_word === 0
      ) {
        const checkpoint = this.getLatestCheckpoint(book.hash);
        if (checkpoint) {
          this.db.run(
            `UPDATE books SET
              position_chapter = ?,
              position_paragraph = ?,
              position_word = ?,
              position_wpm = ?,
              position_chapter_title = ?
            WHERE hash = ?`,
            [
              checkpoint.chapter_index,
              checkpoint.paragraph_index,
              checkpoint.word_index,
              checkpoint.wpm,
              checkpoint.chapter_title,
              book.hash,
            ]
          );
        }
      }
    }
  }

  private save(): void {
    // Debounce saves to avoid excessive disk writes
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveSync();
    }, 100);
  }

  private saveSync(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dbPath, buffer);
  }

  // Books
  addBook(hash: string, filename: string, title?: string, author?: string): BookRecord {
    // Check if exists
    const existing = this.getBook(hash);
    if (existing) {
      // Update existing
      this.db.run(
        `UPDATE books SET filename = ?, title = COALESCE(?, title), author = COALESCE(?, author) WHERE hash = ?`,
        [filename, title ?? null, author ?? null, hash]
      );
      this.save();
      return this.getBook(hash)!;
    }

    // Insert new
    this.db.run(
      `INSERT INTO books (hash, filename, title, author, added_at) VALUES (?, ?, ?, ?, ?)`,
      [hash, filename, title ?? null, author ?? null, Date.now()]
    );
    this.save();
    return this.getBook(hash)!;
  }

  getBook(hash: string): BookRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM books WHERE hash = ?');
    stmt.bind([hash]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as BookRecord;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  getAllBooks(): BookRecord[] {
    const results: BookRecord[] = [];
    const stmt = this.db.prepare(`SELECT * FROM books ORDER BY COALESCE(last_read_at, added_at) DESC`);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as BookRecord);
    }
    stmt.free();
    return results;
  }

  updateLastRead(hash: string): void {
    this.db.run('UPDATE books SET last_read_at = ? WHERE hash = ?', [Date.now(), hash]);
    this.save();
  }

  deleteBook(hash: string): void {
    this.db.run('DELETE FROM checkpoints WHERE book_hash = ?', [hash]);
    this.db.run('DELETE FROM stats WHERE book_hash = ?', [hash]);
    this.db.run('DELETE FROM books WHERE hash = ?', [hash]);
    this.save();
  }

  // Checkpoints
  addCheckpoint(
    bookHash: string,
    chapterIndex: number,
    paragraphIndex: number,
    wordIndex: number,
    wpm: number,
    chapterTitle?: string
  ): CheckpointRecord {
    const createdAt = Date.now();
    this.db.run(
      `INSERT INTO checkpoints (book_hash, chapter_index, paragraph_index, word_index, wpm, chapter_title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bookHash, chapterIndex, paragraphIndex, wordIndex, wpm, chapterTitle ?? null, createdAt]
    );
    this.save();

    // Get the inserted row
    const stmt = this.db.prepare('SELECT * FROM checkpoints WHERE rowid = last_insert_rowid()');
    stmt.step();
    const row = stmt.getAsObject() as unknown as CheckpointRecord;
    stmt.free();
    return row;
  }

  getCheckpoints(bookHash: string, limit = 50): CheckpointRecord[] {
    const results: CheckpointRecord[] = [];
    const stmt = this.db.prepare(
      `SELECT * FROM checkpoints WHERE book_hash = ? ORDER BY created_at DESC LIMIT ?`
    );
    stmt.bind([bookHash, limit]);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as CheckpointRecord);
    }
    stmt.free();
    return results;
  }

  getLatestCheckpoint(bookHash: string): CheckpointRecord | undefined {
    const stmt = this.db.prepare(
      `SELECT * FROM checkpoints WHERE book_hash = ? ORDER BY created_at DESC LIMIT 1`
    );
    stmt.bind([bookHash]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as CheckpointRecord;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  // Position (simplified - single position per book)
  updatePosition(
    hash: string,
    chapterIndex: number,
    paragraphIndex: number,
    wordIndex: number,
    wpm: number,
    chapterTitle?: string
  ): void {
    this.db.run(
      `UPDATE books SET
        position_chapter = ?,
        position_paragraph = ?,
        position_word = ?,
        position_wpm = ?,
        position_chapter_title = ?,
        last_read_at = ?
      WHERE hash = ?`,
      [chapterIndex, paragraphIndex, wordIndex, wpm, chapterTitle ?? null, Date.now(), hash]
    );
    this.save();
  }

  getPosition(hash: string): {
    chapterIndex: number;
    paragraphIndex: number;
    wordIndex: number;
    wpm: number;
    chapterTitle: string | null;
  } | null {
    const book = this.getBook(hash);
    if (!book) return null;

    // Return null if never read (all zeros with no last_read_at)
    if (
      !book.last_read_at &&
      book.position_chapter === 0 &&
      book.position_paragraph === 0 &&
      book.position_word === 0
    ) {
      return null;
    }

    return {
      chapterIndex: book.position_chapter,
      paragraphIndex: book.position_paragraph,
      wordIndex: book.position_word,
      wpm: book.position_wpm,
      chapterTitle: book.position_chapter_title,
    };
  }

  // Stats
  addSession(
    bookHash: string,
    sessionStart: number,
    sessionEnd: number,
    wordsRead: number,
    avgWpm?: number
  ): StatsRecord {
    this.db.run(
      `INSERT INTO stats (book_hash, session_start, session_end, words_read, avg_wpm) VALUES (?, ?, ?, ?, ?)`,
      [bookHash, sessionStart, sessionEnd, wordsRead, avgWpm ?? null]
    );
    this.save();

    const stmt = this.db.prepare('SELECT * FROM stats WHERE rowid = last_insert_rowid()');
    stmt.step();
    const row = stmt.getAsObject() as unknown as StatsRecord;
    stmt.free();
    return row;
  }

  getStats(bookHash: string): StatsRecord[] {
    const results: StatsRecord[] = [];
    const stmt = this.db.prepare(`SELECT * FROM stats WHERE book_hash = ? ORDER BY session_start DESC`);
    stmt.bind([bookHash]);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as StatsRecord);
    }
    stmt.free();
    return results;
  }

  getAggregateStats(bookHash: string): {
    totalSessions: number;
    totalWordsRead: number;
    totalTimeMs: number;
    overallAvgWpm: number | null;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(words_read), 0) as total_words,
        COALESCE(SUM(session_end - session_start), 0) as total_time,
        AVG(avg_wpm) as overall_avg_wpm
      FROM stats
      WHERE book_hash = ?
    `);
    stmt.bind([bookHash]);
    stmt.step();
    const row = stmt.getAsObject() as {
      total_sessions: number;
      total_words: number;
      total_time: number;
      overall_avg_wpm: number | null;
    };
    stmt.free();

    return {
      totalSessions: row.total_sessions,
      totalWordsRead: row.total_words,
      totalTimeMs: row.total_time,
      overallAvgWpm: row.overall_avg_wpm,
    };
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveSync();
    this.db.close();
  }
}
