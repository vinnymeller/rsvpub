export interface ReadingPosition {
  chapterIndex: number;
  paragraphIndex: number;
  wordIndex: number;
}

export interface ProcessedWord {
  text: string;
  orpIndex: number;
  delay: number;
}

export interface Paragraph {
  words: ProcessedWord[];
  sourceElement: string;
}

export interface Chapter {
  index: number;
  title: string;
  paragraphs: Paragraph[];
}

export interface ProcessedBook {
  title: string;
  author: string;
  chapters: Chapter[];
}

export type RSVPStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused';
export type ViewMode = 'rsvp' | 'paragraph';

export interface RSVPState {
  status: RSVPStatus;
  position: ReadingPosition;
  wpm: number;
  book: ProcessedBook | null;
  viewMode: ViewMode;
}

export interface CurrentWordInfo {
  word: ProcessedWord;
  position: ReadingPosition;
  totalWordsInParagraph: number;
  totalParagraphsInChapter: number;
  totalChapters: number;
  chapterTitle: string;
}

export interface SavedState {
  bookTitle: string;
  position: ReadingPosition;
  wpm: number;
  timestamp: number;
}
