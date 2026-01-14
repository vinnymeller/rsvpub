import type { CurrentWordInfo, ProcessedBook, ProcessedWord, ReadingPosition, ViewMode } from '../types';
import { EPUBLoader } from '../epub/loader';
import { TextExtractor } from '../epub/extractor';
import { RSVPEngine } from '../rsvp/engine';
import { MIN_WPM, MAX_WPM, WPM_STEP, DEFAULT_TIMING_SETTINGS } from '../rsvp/timing';
import type { TimingSettings } from '../rsvp/timing';
import { Library } from './library';
import { api, type BookInfo } from '../api/client';
import { loadWordlist } from '../wordlist';

export class App {
  private container: HTMLElement;
  private loader = new EPUBLoader();
  private extractor = new TextExtractor();
  private engine = new RSVPEngine();
  private library: Library;

  // Current book context
  private currentBookHash: string | null = null;
  private isPlaying = false;
  private engineCleanup: (() => void)[] = [];

  // UI Elements
  private wordDisplay!: HTMLElement;
  private paragraphView!: HTMLElement;
  private playPauseBtn!: HTMLButtonElement;
  private wpmSlider!: HTMLInputElement;
  private wpmValue!: HTMLElement;
  private progressBar!: HTMLElement;
  private progressText!: HTMLElement;
  private chapterSelect!: HTMLSelectElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.library = new Library(container, (book) => this.openBook(book));
    this.init();
  }

  private init(): void {
    // Load wordlist for frequency-based delays (async, non-blocking)
    loadWordlist();

    // Connect engine to timing settings
    this.engine.setTimingSettingsGetter(() => this.getTimingSettings());

    this.showLibrary();
    this.bindKeyboard();
  }

  private showLibrary(): void {
    // Save position before leaving reader
    this.savePosition();
    this.cleanupEngineListeners();
    this.currentBookHash = null;
    this.engine.pause();
    this.library.show();
  }

  private showLoading(): void {
    this.container.innerHTML = `
      <div class="loading">
        <div class="loading-spinner"></div>
        <div>Loading book...</div>
      </div>
    `;
  }

  private showReader(): void {
    const wpm = this.engine.getWPM();

    this.container.innerHTML = `
      <div class="reader">
        <div class="reader-header">
          <button class="back-btn">← Library</button>
          <div class="book-title"></div>
          <select class="chapter-select"></select>
          <button class="settings-btn" title="Settings">⚙</button>
        </div>

        <div class="word-display">
          <div class="focal-line"></div>
          <div class="word-container">
            <span class="word-placeholder">Press Play to start</span>
          </div>
        </div>

        <div class="paragraph-view" style="display: none;"></div>

        <div class="controls">
          <div class="control-row">
            <button class="control-btn prev-word" title="Previous Word (←)">&#9664;</button>
            <button class="control-btn play-pause" title="Play/Pause (Space)">&#9654;</button>
            <button class="control-btn next-word" title="Next Word (→)">&#9654;</button>
          </div>
          <div class="control-row">
            <button class="control-btn restart-para" title="Restart Paragraph (R)">&#8634;</button>
          </div>
          <div class="wpm-control">
            <span class="wpm-label">WPM:</span>
            <input type="range" class="wpm-slider" min="${MIN_WPM}" max="${MAX_WPM}" step="${WPM_STEP}" value="${wpm}">
            <span class="wpm-value">${wpm}</span>
          </div>
        </div>

        <div class="progress">
          <div class="progress-bar-container">
            <div class="progress-bar" style="width: 0%"></div>
          </div>
          <div class="progress-text">
            <span class="progress-position">Chapter 1</span>
            <span class="progress-percent">0%</span>
          </div>
        </div>

        <div class="keyboard-hints">
          <span class="keyboard-hint"><kbd>Space</kbd> Play/Pause</span>
          <span class="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> Navigate</span>
          <span class="keyboard-hint"><kbd>R</kbd> Restart para</span>
          <span class="keyboard-hint"><kbd>[</kbd><kbd>]</kbd> Speed</span>
          <span class="keyboard-hint"><kbd>V</kbd> Toggle view</span>
        </div>

        <div class="mobile-controls">
          <button class="mobile-btn mobile-prev-word" title="Previous Word">◀</button>
          <button class="mobile-btn mobile-restart" title="Restart Paragraph">↺</button>
          <button class="mobile-btn mobile-view-toggle" title="Toggle View">¶</button>
          <button class="mobile-btn mobile-next-word" title="Next Word">▶</button>
        </div>
      </div>
    `;

    this.cacheElements();
    this.bindControls();
    this.updateBookInfo();
    this.setupEngineListeners();
    this.applyStoredFontSize();
  }

  private cacheElements(): void {
    this.wordDisplay = this.container.querySelector('.word-container')!;
    this.paragraphView = this.container.querySelector('.paragraph-view')!;
    this.playPauseBtn = this.container.querySelector('.play-pause')!;
    this.wpmSlider = this.container.querySelector('.wpm-slider')!;
    this.wpmValue = this.container.querySelector('.wpm-value')!;
    this.progressBar = this.container.querySelector('.progress-bar')!;
    this.progressText = this.container.querySelector('.progress-position')!;
    this.chapterSelect = this.container.querySelector('.chapter-select')!;
  }

  private bindControls(): void {
    // Back to library
    this.container.querySelector('.back-btn')!
      .addEventListener('click', () => this.showLibrary());

    // Settings
    this.container.querySelector('.settings-btn')!
      .addEventListener('click', () => this.showSettingsModal());

    // Play/Pause
    this.playPauseBtn.addEventListener('click', () => this.engine.toggle());

    // Navigation
    this.container.querySelector('.prev-word')!
      .addEventListener('click', () => this.engine.prevWord());
    this.container.querySelector('.next-word')!
      .addEventListener('click', () => this.engine.nextWord());
    this.container.querySelector('.restart-para')!
      .addEventListener('click', () => this.engine.restartParagraph());

    // WPM slider
    this.wpmSlider.addEventListener('input', () => {
      const wpm = parseInt(this.wpmSlider.value);
      this.engine.setWPM(wpm);
      this.wpmValue.textContent = String(wpm);
    });

    // Chapter select
    this.chapterSelect.addEventListener('change', () => {
      const index = parseInt(this.chapterSelect.value);
      this.engine.goToChapter(index);
      this.savePosition();
    });

    // Mobile controls
    this.container.querySelector('.mobile-prev-word')
      ?.addEventListener('click', () => this.engine.prevWord());
    this.container.querySelector('.mobile-next-word')
      ?.addEventListener('click', () => this.engine.nextWord());
    this.container.querySelector('.mobile-restart')
      ?.addEventListener('click', () => this.engine.restartParagraph());
    this.container.querySelector('.mobile-view-toggle')
      ?.addEventListener('click', () => this.engine.toggleViewMode());
  }

  private bindKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      // Escape to go back to library
      if (e.code === 'Escape' && this.currentBookHash) {
        e.preventDefault();
        this.showLibrary();
        return;
      }

      // Only handle other keys if we're in the reader
      if (!this.currentBookHash) return;

      const inParagraphMode = this.engine.getViewMode() === 'paragraph';

      // V key always works to toggle view
      if (e.code === 'KeyV') {
        e.preventDefault();
        this.engine.toggleViewMode();
        return;
      }

      // All other shortcuts only work in RSVP mode
      if (inParagraphMode) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.engine.toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.engine.prevWord();
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.engine.nextWord();
          break;
        case 'KeyR':
          e.preventDefault();
          this.engine.restartParagraph();
          break;
        case 'BracketLeft':
          e.preventDefault();
          this.adjustWPM(-WPM_STEP);
          break;
        case 'BracketRight':
          e.preventDefault();
          this.adjustWPM(WPM_STEP);
          break;
        case 'PageUp':
          e.preventDefault();
          this.engine.prevChapter();
          break;
        case 'PageDown':
          e.preventDefault();
          this.engine.nextChapter();
          break;
      }
    });
  }

  private adjustWPM(delta: number): void {
    const current = this.engine.getWPM();
    const newWPM = Math.max(MIN_WPM, Math.min(MAX_WPM, current + delta));
    this.engine.setWPM(newWPM);
    if (this.wpmSlider) {
      this.wpmSlider.value = String(newWPM);
      this.wpmValue.textContent = String(newWPM);
    }
  }

  private setupEngineListeners(): void {
    // Clear any existing listeners first
    this.cleanupEngineListeners();

    this.engineCleanup.push(
      this.engine.onWordChange((info) => this.updateWordDisplay(info))
    );
    this.engineCleanup.push(
      this.engine.onStatusChange((status) => {
        this.isPlaying = status === 'playing';
        this.updatePlayPauseButton(status);

        // Re-render display to show/hide sentence context
        const info = this.engine.getCurrentWordInfo();
        if (info) this.updateWordDisplay(info);

        // Save position when pausing
        if (status === 'paused') {
          this.savePosition();
        }
      })
    );
    this.engineCleanup.push(
      this.engine.onViewModeChange((mode) => {
        this.updateViewMode(mode);
        this.savePosition();
      })
    );
  }

  private cleanupEngineListeners(): void {
    this.engineCleanup.forEach(cleanup => cleanup());
    this.engineCleanup = [];
  }

  private updateWordDisplay(info: CurrentWordInfo | null): void {
    // Guard against stale DOM references
    if (!this.wordDisplay) return;

    if (!info) {
      this.wordDisplay.innerHTML = '<span class="word-placeholder">End of book</span>';
      return;
    }

    // Handle paragraph view - re-render when position changes (e.g., chapter selector)
    if (this.engine.getViewMode() === 'paragraph') {
      this.renderParagraphView();
      this.updateProgress(info);
      // Update chapter select if changed
      if (this.chapterSelect && parseInt(this.chapterSelect.value) !== info.position.chapterIndex) {
        this.chapterSelect.value = String(info.position.chapterIndex);
      }
      return;
    }

    if (this.isPlaying) {
      this.renderWord(info.word);
    } else {
      this.renderSentenceContext(info);
    }
    this.updateProgress(info);

    // Update chapter select if changed
    if (this.chapterSelect && parseInt(this.chapterSelect.value) !== info.position.chapterIndex) {
      this.chapterSelect.value = String(info.position.chapterIndex);
    }
  }

  private renderWord(word: ProcessedWord): void {
    const { text, orpIndex } = word;
    const before = text.slice(0, orpIndex);
    const orp = text[orpIndex] || '';
    const after = text.slice(orpIndex + 1);

    this.wordDisplay.innerHTML = `
      <span class="word-before">${this.escapeHtml(before)}</span>
      <span class="word-orp">${this.escapeHtml(orp)}</span>
      <span class="word-after">${this.escapeHtml(after)}</span>
    `;

    // Remove sentence context when playing
    const wordDisplayWrapper = this.container.querySelector('.word-display');
    const contextEl = wordDisplayWrapper?.querySelector('.sentence-context');
    if (contextEl) contextEl.remove();
  }

  private renderSentenceContext(info: CurrentWordInfo): void {
    const book = this.engine.getBook();
    if (!book) return;

    const chapter = book.chapters[info.position.chapterIndex];
    if (!chapter) return;

    const paragraph = chapter.paragraphs[info.position.paragraphIndex];
    if (!paragraph) return;

    const words = paragraph.words;
    const currentIdx = info.position.wordIndex;

    // Show limited context: up to 5 words before and after
    const contextSize = 5;
    const startIdx = Math.max(0, currentIdx - contextSize);
    const endIdx = Math.min(words.length - 1, currentIdx + contextSize);

    // Build the current word with ORP highlighting (same as playing mode)
    const currentWord = words[currentIdx];
    const { text, orpIndex } = currentWord;
    const wordBefore = text.slice(0, orpIndex);
    const orp = text[orpIndex] || '';
    const wordAfter = text.slice(orpIndex + 1);

    // Build context sentence for display below
    const contextParts: string[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      if (i === currentIdx) {
        contextParts.push(`<span class="context-current">${this.escapeHtml(words[i].text)}</span>`);
      } else {
        contextParts.push(this.escapeHtml(words[i].text));
      }
    }

    const beforeEllipsis = startIdx > 0 ? '… ' : '';
    const afterEllipsis = endIdx < words.length - 1 ? ' …' : '';
    const contextHtml = beforeEllipsis + contextParts.join(' ') + afterEllipsis;

    // Render: main word centered (unchanged), context below
    this.wordDisplay.innerHTML = `
      <span class="word-before">${this.escapeHtml(wordBefore)}</span>
      <span class="word-orp">${this.escapeHtml(orp)}</span>
      <span class="word-after">${this.escapeHtml(wordAfter)}</span>
    `;

    // Add context line below the word display
    const wordDisplayWrapper = this.container.querySelector('.word-display') as HTMLElement;
    if (!wordDisplayWrapper) return;
    let contextEl = wordDisplayWrapper.querySelector('.sentence-context') as HTMLElement;
    if (!contextEl) {
      contextEl = document.createElement('div');
      contextEl.className = 'sentence-context';
      wordDisplayWrapper.appendChild(contextEl);
    }
    contextEl.innerHTML = contextHtml;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private updateProgress(info: CurrentWordInfo): void {
    // Guard against stale DOM references
    if (!this.progressBar || !this.progressText) return;

    const book = this.engine.getBook();
    if (!book) return;

    // Calculate total words and current position
    let totalWords = 0;
    let currentWordIndex = 0;

    for (let c = 0; c < book.chapters.length; c++) {
      const chapter = book.chapters[c];
      for (let p = 0; p < chapter.paragraphs.length; p++) {
        const para = chapter.paragraphs[p];
        if (c < info.position.chapterIndex ||
            (c === info.position.chapterIndex && p < info.position.paragraphIndex) ||
            (c === info.position.chapterIndex && p === info.position.paragraphIndex)) {
          if (c === info.position.chapterIndex && p === info.position.paragraphIndex) {
            currentWordIndex = totalWords + info.position.wordIndex;
          }
        }
        totalWords += para.words.length;
      }
    }

    const percent = totalWords > 0 ? (currentWordIndex / totalWords) * 100 : 0;
    this.progressBar.style.width = `${percent}%`;
    this.progressText.textContent = `${info.chapterTitle} - Word ${info.position.wordIndex + 1}/${info.totalWordsInParagraph}`;

    const percentText = this.container.querySelector('.progress-percent');
    if (percentText) {
      percentText.textContent = `${Math.round(percent)}%`;
    }
  }

  private updatePlayPauseButton(status: string): void {
    if (!this.playPauseBtn) return;
    this.playPauseBtn.innerHTML = status === 'playing' ? '&#10074;&#10074;' : '&#9654;';
  }

  private updateViewMode(mode: ViewMode): void {
    const wordDisplayWrapper = this.container.querySelector('.word-display') as HTMLElement;
    const controls = this.container.querySelector('.controls') as HTMLElement;
    const keyboardHints = this.container.querySelector('.keyboard-hints') as HTMLElement;

    if (!wordDisplayWrapper || !this.paragraphView) return;

    if (mode === 'paragraph') {
      wordDisplayWrapper.style.display = 'none';
      this.paragraphView.style.display = 'block';
      if (controls) controls.style.display = 'none';
      if (keyboardHints) {
        keyboardHints.innerHTML = `
          <span class="keyboard-hint"><kbd>V</kbd> Back to RSVP</span>
          <span class="keyboard-hint"><kbd>Click</kbd> Jump to word</span>
        `;
      }
      this.renderParagraphView();
    } else {
      wordDisplayWrapper.style.display = 'flex';
      this.paragraphView.style.display = 'none';
      if (controls) controls.style.display = 'flex';
      if (keyboardHints) {
        keyboardHints.innerHTML = `
          <span class="keyboard-hint"><kbd>Space</kbd> Play/Pause</span>
          <span class="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> Navigate</span>
          <span class="keyboard-hint"><kbd>R</kbd> Restart para</span>
          <span class="keyboard-hint"><kbd>[</kbd><kbd>]</kbd> Speed</span>
          <span class="keyboard-hint"><kbd>V</kbd> Paragraph view</span>
        `;
      }
      // Update word display to show current position
      const info = this.engine.getCurrentWordInfo();
      if (info) {
        this.renderSentenceContext(info);
        this.updateProgress(info);
      }
    }
  }

  private renderParagraphView(): void {
    const book = this.engine.getBook();
    const position = this.engine.getPosition();
    if (!book) return;

    const chapter = book.chapters[position.chapterIndex];
    if (!chapter) return;

    // Build paragraph HTML with clickable words
    let html = `<div class="paragraph-view-content">`;

    chapter.paragraphs.forEach((para, pIdx) => {
      const isCurrent = pIdx === position.paragraphIndex;
      const paraClass = isCurrent ? 'paragraph current' : 'paragraph';

      html += `<p class="${paraClass}" data-para="${pIdx}">`;

      para.words.forEach((word, wIdx) => {
        const isCurrentWord = isCurrent && wIdx === position.wordIndex;
        const wordClass = isCurrentWord ? 'word current-word' : 'word';
        html += `<span class="${wordClass}" data-para="${pIdx}" data-word="${wIdx}">${this.escapeHtml(word.text)}</span> `;
      });

      html += `</p>`;
    });

    html += `</div>`;
    this.paragraphView.innerHTML = html;

    // Bind click handlers to words
    this.paragraphView.querySelectorAll('.word').forEach((el) => {
      el.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const paraIdx = parseInt(target.dataset.para || '0');
        const wordIdx = parseInt(target.dataset.word || '0');

        this.engine.setPosition({
          chapterIndex: position.chapterIndex,
          paragraphIndex: paraIdx,
          wordIndex: wordIdx,
        });

        // Re-render to update highlighting
        this.renderParagraphView();

        // Save position
        this.savePosition();
      });
    });

    // Scroll current paragraph into view
    const currentPara = this.paragraphView.querySelector('.paragraph.current');
    if (currentPara) {
      currentPara.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private updateBookInfo(): void {
    const book = this.engine.getBook();
    if (!book) return;

    const titleEl = this.container.querySelector('.book-title');
    if (titleEl) {
      titleEl.textContent = `${book.title} by ${book.author}`;
    }

    // Populate chapter select
    this.chapterSelect.innerHTML = book.chapters
      .map((ch, i) => `<option value="${i}">${ch.title}</option>`)
      .join('');
  }

  private async openBook(bookInfo: BookInfo): Promise<void> {
    this.showLoading();

    try {
      // Fetch the EPUB file from API
      const arrayBuffer = await api.getBookFile(bookInfo.hash);

      // Load and process the EPUB
      const epubBook = await this.loader.loadFromArrayBuffer(arrayBuffer);
      const processedBook = await this.extractor.extractBook(epubBook);

      if (processedBook.chapters.length === 0) {
        throw new Error('No readable content found in this EPUB');
      }

      // Update metadata in database if we extracted better info
      if (processedBook.title !== 'Untitled' || processedBook.author !== 'Unknown') {
        api.updateBookMetadata(bookInfo.hash, processedBook.title, processedBook.author).catch(() => {
          // Ignore errors updating metadata
        });
      }

      // Load book into engine (sets position to 0,0,0)
      this.engine.loadBook(processedBook);
      this.currentBookHash = bookInfo.hash;

      // Show reader FIRST so listeners are set up
      this.showReader();

      // NOW restore position - this will trigger UI update via listeners
      if (bookInfo.position) {
        this.engine.setWPM(bookInfo.position.wpm);
        this.wpmSlider.value = String(bookInfo.position.wpm);
        this.wpmValue.textContent = String(bookInfo.position.wpm);

        // Validate and clamp position to book bounds
        const savedPos = bookInfo.position;
        const clampedPos = this.clampPosition(processedBook, savedPos);

        const positionWasClamped =
          clampedPos.chapterIndex !== savedPos.chapterIndex ||
          clampedPos.paragraphIndex !== savedPos.paragraphIndex ||
          clampedPos.wordIndex !== savedPos.wordIndex;

        if (positionWasClamped) {
          console.warn('Saved position was out of bounds:', savedPos);
          console.warn('Book has', processedBook.chapters.length, 'chapters');
          console.warn('Clamped to:', clampedPos);

          // Show user a notification
          setTimeout(() => {
            alert(`Your saved position (Chapter ${savedPos.chapterIndex + 1}) was out of bounds.\n\nThe book only has ${processedBook.chapters.length} chapters. Restored to Chapter ${clampedPos.chapterIndex + 1} instead.\n\nThis can happen if the book's structure changed.`);
          }, 100);
        }

        this.engine.setPosition(clampedPos);
      } else {
        // No saved position - still show the first word
        this.updateWordDisplay(this.engine.getCurrentWordInfo());
      }
    } catch (err) {
      console.error('Failed to load EPUB:', err);
      alert(`Failed to load EPUB: ${err instanceof Error ? err.message : 'Unknown error'}`);
      this.showLibrary();
    }
  }

  private clampPosition(
    book: ProcessedBook,
    pos: { chapterIndex: number; paragraphIndex: number; wordIndex: number }
  ): ReadingPosition {
    // Clamp chapter
    let chapterIndex = Math.max(0, Math.min(pos.chapterIndex, book.chapters.length - 1));
    let chapter = book.chapters[chapterIndex];

    // If chapter has no paragraphs, find one that does
    while (chapter.paragraphs.length === 0 && chapterIndex > 0) {
      chapterIndex--;
      chapter = book.chapters[chapterIndex];
    }

    // Clamp paragraph
    const paragraphIndex = Math.max(0, Math.min(pos.paragraphIndex, Math.max(0, chapter.paragraphs.length - 1)));
    const paragraph = chapter.paragraphs[paragraphIndex];

    // Clamp word (handle empty paragraph edge case)
    const wordIndex = paragraph
      ? Math.max(0, Math.min(pos.wordIndex, Math.max(0, paragraph.words.length - 1)))
      : 0;

    return { chapterIndex, paragraphIndex, wordIndex };
  }

  private async savePosition(): Promise<void> {
    if (!this.currentBookHash) return;

    const position = this.engine.getPosition();
    const wpm = this.engine.getWPM();
    const book = this.engine.getBook();
    const chapterTitle = book?.chapters[position.chapterIndex]?.title;

    try {
      await api.savePosition(this.currentBookHash, position, wpm, chapterTitle);
    } catch (err) {
      console.error('Failed to save position:', err);
    }
  }

  // Font size settings
  private readonly FONT_SIZE_KEY = 'rsvp-font-size';
  private readonly DEFAULT_FONT_SIZE = 3;

  private getFontSize(): number {
    const stored = localStorage.getItem(this.FONT_SIZE_KEY);
    return stored ? parseFloat(stored) : this.DEFAULT_FONT_SIZE;
  }

  private setFontSize(size: number): void {
    const clamped = Math.max(1.5, Math.min(5, size));
    localStorage.setItem(this.FONT_SIZE_KEY, String(clamped));
    document.documentElement.style.setProperty('--font-size-word', `${clamped}rem`);
  }

  private applyStoredFontSize(): void {
    const size = this.getFontSize();
    document.documentElement.style.setProperty('--font-size-word', `${size}rem`);
  }

  // Timing settings
  private readonly LENGTH_DELAY_ENABLED_KEY = 'rsvp-length-delay-enabled';
  private readonly LENGTH_DELAY_FACTOR_KEY = 'rsvp-length-delay-factor';
  private readonly FREQUENCY_DELAY_ENABLED_KEY = 'rsvp-frequency-delay-enabled';
  private readonly FREQUENCY_DELAY_FACTOR_KEY = 'rsvp-frequency-delay-factor';

  private getTimingSettings(): TimingSettings {
    const lengthEnabled = localStorage.getItem(this.LENGTH_DELAY_ENABLED_KEY);
    const lengthFactor = localStorage.getItem(this.LENGTH_DELAY_FACTOR_KEY);
    const freqEnabled = localStorage.getItem(this.FREQUENCY_DELAY_ENABLED_KEY);
    const freqFactor = localStorage.getItem(this.FREQUENCY_DELAY_FACTOR_KEY);

    return {
      lengthDelayEnabled: lengthEnabled === 'true',
      lengthDelayFactor: lengthFactor ? parseFloat(lengthFactor) : DEFAULT_TIMING_SETTINGS.lengthDelayFactor,
      frequencyDelayEnabled: freqEnabled === 'true',
      frequencyDelayFactor: freqFactor ? parseFloat(freqFactor) : DEFAULT_TIMING_SETTINGS.frequencyDelayFactor,
    };
  }

  private setTimingSetting(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  private showSettingsModal(): void {
    const currentFontSize = this.getFontSize();
    const timingSettings = this.getTimingSettings();

    const modal = document.createElement('div');
    modal.className = 'settings-modal-overlay';
    modal.innerHTML = `
      <div class="settings-modal">
        <div class="settings-header">
          <h2>Settings</h2>
          <button class="settings-close">×</button>
        </div>
        <div class="settings-content">
          <div class="setting-group">
            <label class="setting-label">Font Size</label>
            <div class="font-size-control">
              <button class="font-btn font-decrease">A-</button>
              <span class="font-size-value">${currentFontSize}rem</span>
              <button class="font-btn font-increase">A+</button>
            </div>
            <input type="range" class="font-slider"
              min="1.5" max="5" step="0.25" value="${currentFontSize}">
          </div>

          <div class="setting-divider"></div>

          <div class="setting-group">
            <label class="setting-label">Word Timing</label>

            <div class="setting-row">
              <label class="toggle-label">
                <input type="checkbox" class="length-delay-toggle"
                  ${timingSettings.lengthDelayEnabled ? 'checked' : ''}>
                <span>Longer words show longer</span>
              </label>
            </div>
            <div class="setting-slider-row ${timingSettings.lengthDelayEnabled ? '' : 'disabled'}">
              <span class="slider-label">Factor:</span>
              <input type="range" class="timing-slider length-factor-slider"
                min="0" max="0.5" step="0.05" value="${timingSettings.lengthDelayFactor}">
              <span class="slider-value length-factor-value">${timingSettings.lengthDelayFactor.toFixed(2)}</span>
            </div>

            <div class="setting-row">
              <label class="toggle-label">
                <input type="checkbox" class="frequency-delay-toggle"
                  ${timingSettings.frequencyDelayEnabled ? 'checked' : ''}>
                <span>Uncommon words show longer</span>
              </label>
            </div>
            <div class="setting-slider-row ${timingSettings.frequencyDelayEnabled ? '' : 'disabled'}">
              <span class="slider-label">Factor:</span>
              <input type="range" class="timing-slider frequency-factor-slider"
                min="0" max="1" step="0.1" value="${timingSettings.frequencyDelayFactor}">
              <span class="slider-value frequency-factor-value">${timingSettings.frequencyDelayFactor.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.bindSettingsEvents(modal);
  }

  private bindSettingsEvents(modal: HTMLElement): void {
    const close = () => modal.remove();

    modal.querySelector('.settings-close')!.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    // Font size controls
    const fontSlider = modal.querySelector('.font-slider') as HTMLInputElement;
    const fontValue = modal.querySelector('.font-size-value')!;

    const updateFontSize = (size: number) => {
      const clamped = Math.max(1.5, Math.min(5, size));
      this.setFontSize(clamped);
      fontValue.textContent = `${clamped}rem`;
      fontSlider.value = String(clamped);
    };

    fontSlider.addEventListener('input', () => updateFontSize(parseFloat(fontSlider.value)));
    modal.querySelector('.font-decrease')!.addEventListener('click', () =>
      updateFontSize(this.getFontSize() - 0.25));
    modal.querySelector('.font-increase')!.addEventListener('click', () =>
      updateFontSize(this.getFontSize() + 0.25));

    // Timing controls
    const lengthToggle = modal.querySelector('.length-delay-toggle') as HTMLInputElement;
    const lengthSlider = modal.querySelector('.length-factor-slider') as HTMLInputElement;
    const lengthValue = modal.querySelector('.length-factor-value')!;
    const lengthSliderRow = lengthSlider.closest('.setting-slider-row')!;

    const freqToggle = modal.querySelector('.frequency-delay-toggle') as HTMLInputElement;
    const freqSlider = modal.querySelector('.frequency-factor-slider') as HTMLInputElement;
    const freqValue = modal.querySelector('.frequency-factor-value')!;
    const freqSliderRow = freqSlider.closest('.setting-slider-row')!;

    // Length delay toggle
    lengthToggle.addEventListener('change', () => {
      this.setTimingSetting(this.LENGTH_DELAY_ENABLED_KEY, String(lengthToggle.checked));
      lengthSliderRow.classList.toggle('disabled', !lengthToggle.checked);
    });

    // Length delay factor slider
    lengthSlider.addEventListener('input', () => {
      const factor = parseFloat(lengthSlider.value);
      this.setTimingSetting(this.LENGTH_DELAY_FACTOR_KEY, String(factor));
      lengthValue.textContent = factor.toFixed(2);
    });

    // Frequency delay toggle
    freqToggle.addEventListener('change', () => {
      this.setTimingSetting(this.FREQUENCY_DELAY_ENABLED_KEY, String(freqToggle.checked));
      freqSliderRow.classList.toggle('disabled', !freqToggle.checked);
    });

    // Frequency delay factor slider
    freqSlider.addEventListener('input', () => {
      const factor = parseFloat(freqSlider.value);
      this.setTimingSetting(this.FREQUENCY_DELAY_FACTOR_KEY, String(factor));
      freqValue.textContent = factor.toFixed(1);
    });
  }
}
