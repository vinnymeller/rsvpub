import type { ReadingPosition } from '../types';

export interface Position {
  chapterIndex: number;
  paragraphIndex: number;
  wordIndex: number;
  wpm: number;
  chapterTitle: string | null;
}

export interface BookInfo {
  id: number;
  hash: string;
  filename: string;
  title: string | null;
  author: string | null;
  added_at: number;
  last_read_at: number | null;
  position: Position | null;
}

export interface BookStats {
  aggregate: {
    totalSessions: number;
    totalWordsRead: number;
    totalTimeMs: number;
    overallAvgWpm: number | null;
  };
  sessions: Array<{
    id: number;
    sessionStart: number;
    sessionEnd: number;
    wordsRead: number;
    avgWpm: number | null;
    durationMs: number;
  }>;
}

class APIClient {
  private baseUrl = '/api';

  async getBooks(): Promise<BookInfo[]> {
    const res = await fetch(`${this.baseUrl}/books`);
    if (!res.ok) throw new Error('Failed to fetch books');
    return res.json();
  }

  async uploadBook(file: File): Promise<BookInfo & { alreadyExists?: boolean }> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${this.baseUrl}/books`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Failed to upload book');
    }

    return res.json();
  }

  async getBook(hash: string): Promise<BookInfo & { stats: BookStats['aggregate'] }> {
    const res = await fetch(`${this.baseUrl}/books/${hash}`);
    if (!res.ok) throw new Error('Failed to fetch book');
    return res.json();
  }

  async updateBookMetadata(hash: string, title: string, author: string): Promise<BookInfo> {
    const res = await fetch(`${this.baseUrl}/books/${hash}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, author }),
    });
    if (!res.ok) throw new Error('Failed to update book');
    return res.json();
  }

  async getBookFile(hash: string): Promise<ArrayBuffer> {
    const res = await fetch(`${this.baseUrl}/books/${hash}/file`);
    if (!res.ok) throw new Error('Failed to fetch book file');
    return res.arrayBuffer();
  }

  async deleteBook(hash: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/books/${hash}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete book');
  }

  async getPosition(hash: string): Promise<Position | null> {
    const res = await fetch(`${this.baseUrl}/books/${hash}/checkpoints/position`);
    if (!res.ok) throw new Error('Failed to fetch position');
    return res.json();
  }

  async savePosition(
    hash: string,
    position: ReadingPosition,
    wpm: number,
    chapterTitle?: string
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/books/${hash}/checkpoints/position`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterIndex: position.chapterIndex,
        paragraphIndex: position.paragraphIndex,
        wordIndex: position.wordIndex,
        wpm,
        chapterTitle,
      }),
    });
    if (!res.ok) throw new Error('Failed to save position');
  }

  async getStats(hash: string): Promise<BookStats> {
    const res = await fetch(`${this.baseUrl}/books/${hash}/stats`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  }

  async saveSession(
    hash: string,
    sessionStart: number,
    sessionEnd: number,
    wordsRead: number,
    avgWpm?: number
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/books/${hash}/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionStart, sessionEnd, wordsRead, avgWpm }),
    });
    if (!res.ok) throw new Error('Failed to save session');
  }
}

export const api = new APIClient();
