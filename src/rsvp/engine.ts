import type {
  ProcessedBook,
  ReadingPosition,
  RSVPState,
  RSVPStatus,
  CurrentWordInfo,
  ProcessedWord,
  ViewMode,
} from '../types';
import { calculateTotalDelay, DEFAULT_WPM, DEFAULT_TIMING_SETTINGS } from './timing';
import type { TimingSettings } from './timing';

type Listener<T> = (data: T) => void;

export class RSVPEngine {
  private state: RSVPState = {
    status: 'idle',
    position: { chapterIndex: 0, paragraphIndex: 0, wordIndex: 0 },
    wpm: DEFAULT_WPM,
    book: null,
    viewMode: 'rsvp',
  };

  private timerId: number | null = null;
  private wordListeners = new Set<Listener<CurrentWordInfo | null>>();
  private statusListeners = new Set<Listener<RSVPStatus>>();
  private viewModeListeners = new Set<Listener<ViewMode>>();
  private timingSettingsGetter: (() => TimingSettings) | null = null;

  loadBook(book: ProcessedBook): void {
    this.pause();
    this.state.book = book;
    this.state.position = { chapterIndex: 0, paragraphIndex: 0, wordIndex: 0 };
    this.setStatus('ready');
    this.notifyWordChange();
  }

  play(): void {
    if (this.state.status !== 'ready' && this.state.status !== 'paused') return;
    this.setStatus('playing');
    this.scheduleNext();
  }

  pause(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.state.status === 'playing') {
      this.setStatus('paused');
    }
  }

  toggle(): void {
    if (this.state.status === 'playing') {
      this.pause();
    } else {
      this.play();
    }
  }

  nextWord(): void {
    if (!this.state.book) return;
    this.advance();
    this.notifyWordChange();
  }

  prevWord(): void {
    if (!this.state.book) return;
    this.retreat();
    this.notifyWordChange();
  }

  restartParagraph(): void {
    this.state.position.wordIndex = 0;
    this.notifyWordChange();
  }

  goToChapter(index: number): void {
    if (!this.state.book) return;
    if (index < 0 || index >= this.state.book.chapters.length) return;

    this.state.position = {
      chapterIndex: index,
      paragraphIndex: 0,
      wordIndex: 0,
    };
    this.notifyWordChange();
  }

  nextChapter(): void {
    if (!this.state.book) return;
    const next = this.state.position.chapterIndex + 1;
    if (next < this.state.book.chapters.length) {
      this.goToChapter(next);
    }
  }

  prevChapter(): void {
    const prev = this.state.position.chapterIndex - 1;
    if (prev >= 0) {
      this.goToChapter(prev);
    }
  }

  setWPM(wpm: number): void {
    this.state.wpm = wpm;
  }

  getWPM(): number {
    return this.state.wpm;
  }

  setTimingSettingsGetter(getter: () => TimingSettings): void {
    this.timingSettingsGetter = getter;
  }

  private getTimingSettings(): TimingSettings {
    return this.timingSettingsGetter?.() ?? DEFAULT_TIMING_SETTINGS;
  }

  getStatus(): RSVPStatus {
    return this.state.status;
  }

  getViewMode(): ViewMode {
    return this.state.viewMode;
  }

  setViewMode(mode: ViewMode): void {
    if (this.state.viewMode === mode) return;
    // Pause RSVP when switching to paragraph view
    if (mode === 'paragraph') {
      this.pause();
    }
    this.state.viewMode = mode;
    this.viewModeListeners.forEach(cb => cb(mode));
  }

  toggleViewMode(): void {
    this.setViewMode(this.state.viewMode === 'rsvp' ? 'paragraph' : 'rsvp');
  }

  onViewModeChange(callback: Listener<ViewMode>): () => void {
    this.viewModeListeners.add(callback);
    return () => this.viewModeListeners.delete(callback);
  }

  getPosition(): ReadingPosition {
    return { ...this.state.position };
  }

  setPosition(position: ReadingPosition): void {
    if (!this.state.book) return;
    const { chapterIndex, paragraphIndex, wordIndex } = position;

    // Validate position
    if (chapterIndex < 0 || chapterIndex >= this.state.book.chapters.length) return;
    const chapter = this.state.book.chapters[chapterIndex];
    if (paragraphIndex < 0 || paragraphIndex >= chapter.paragraphs.length) return;
    const paragraph = chapter.paragraphs[paragraphIndex];
    if (wordIndex < 0 || wordIndex >= paragraph.words.length) return;

    this.state.position = { chapterIndex, paragraphIndex, wordIndex };
    this.notifyWordChange();
  }

  getCurrentWordInfo(): CurrentWordInfo | null {
    if (!this.state.book) return null;

    const { chapterIndex, paragraphIndex, wordIndex } = this.state.position;
    const chapter = this.state.book.chapters[chapterIndex];
    if (!chapter) return null;

    const paragraph = chapter.paragraphs[paragraphIndex];
    if (!paragraph) return null;

    const word = paragraph.words[wordIndex];
    if (!word) return null;

    return {
      word,
      position: { ...this.state.position },
      totalWordsInParagraph: paragraph.words.length,
      totalParagraphsInChapter: chapter.paragraphs.length,
      totalChapters: this.state.book.chapters.length,
      chapterTitle: chapter.title,
    };
  }

  getBook(): ProcessedBook | null {
    return this.state.book;
  }

  onWordChange(callback: Listener<CurrentWordInfo | null>): () => void {
    this.wordListeners.add(callback);
    return () => this.wordListeners.delete(callback);
  }

  onStatusChange(callback: Listener<RSVPStatus>): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  private setStatus(status: RSVPStatus): void {
    this.state.status = status;
    this.statusListeners.forEach(cb => cb(status));
  }

  private notifyWordChange(): void {
    const info = this.getCurrentWordInfo();
    this.wordListeners.forEach(cb => cb(info));
  }

  private getCurrentWord(): ProcessedWord | null {
    if (!this.state.book) return null;
    const { chapterIndex, paragraphIndex, wordIndex } = this.state.position;
    return this.state.book.chapters[chapterIndex]
      ?.paragraphs[paragraphIndex]
      ?.words[wordIndex] ?? null;
  }

  private scheduleNext(): void {
    if (this.state.status !== 'playing') return;

    const word = this.getCurrentWord();
    if (!word) {
      this.pause();
      return;
    }

    const settings = this.getTimingSettings();
    const totalDelay = calculateTotalDelay(word.text, this.state.wpm, settings);

    this.timerId = window.setTimeout(() => {
      this.advance();
      this.notifyWordChange();
      this.scheduleNext();
    }, totalDelay);
  }

  private advance(): void {
    if (!this.state.book) return;

    const { chapterIndex, paragraphIndex, wordIndex } = this.state.position;
    const chapter = this.state.book.chapters[chapterIndex];
    if (!chapter) return;

    const paragraph = chapter.paragraphs[paragraphIndex];
    if (!paragraph) return;

    // Try next word in paragraph
    if (wordIndex + 1 < paragraph.words.length) {
      this.state.position.wordIndex++;
      return;
    }

    // Try next paragraph in chapter
    if (paragraphIndex + 1 < chapter.paragraphs.length) {
      this.state.position.paragraphIndex++;
      this.state.position.wordIndex = 0;
      return;
    }

    // Try next chapter
    if (chapterIndex + 1 < this.state.book.chapters.length) {
      this.state.position.chapterIndex++;
      this.state.position.paragraphIndex = 0;
      this.state.position.wordIndex = 0;
      return;
    }

    // End of book
    this.pause();
  }

  private retreat(): void {
    if (!this.state.book) return;

    const { chapterIndex, paragraphIndex, wordIndex } = this.state.position;

    // Try previous word in paragraph
    if (wordIndex > 0) {
      this.state.position.wordIndex--;
      return;
    }

    // Try previous paragraph in chapter
    if (paragraphIndex > 0) {
      this.state.position.paragraphIndex--;
      const newParagraph = this.state.book.chapters[chapterIndex]
        .paragraphs[this.state.position.paragraphIndex];
      this.state.position.wordIndex = Math.max(0, newParagraph.words.length - 1);
      return;
    }

    // Try previous chapter
    if (chapterIndex > 0) {
      this.state.position.chapterIndex--;
      const newChapter = this.state.book.chapters[this.state.position.chapterIndex];
      this.state.position.paragraphIndex = Math.max(0, newChapter.paragraphs.length - 1);
      const newParagraph = newChapter.paragraphs[this.state.position.paragraphIndex];
      this.state.position.wordIndex = Math.max(0, newParagraph.words.length - 1);
    }
  }
}
