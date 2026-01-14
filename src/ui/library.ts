import { api, type BookInfo } from '../api/client';

type BookSelectedCallback = (book: BookInfo) => void;

export class Library {
  private container: HTMLElement;
  private books: BookInfo[] = [];
  private searchQuery = '';
  private onBookSelected: BookSelectedCallback;

  constructor(container: HTMLElement, onBookSelected: BookSelectedCallback) {
    this.container = container;
    this.onBookSelected = onBookSelected;
  }

  async show(): Promise<void> {
    this.render();
    await this.loadBooks();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="library">
        <div class="library-header">
          <h1>Library</h1>
          <div class="library-actions">
            <input type="text" class="library-search" placeholder="Search books...">
            <button class="upload-btn">Upload EPUB</button>
            <input type="file" class="upload-input" accept=".epub" multiple style="display: none;">
          </div>
        </div>
        <div class="library-content">
          <div class="library-loading">Loading books...</div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const uploadBtn = this.container.querySelector('.upload-btn')!;
    const uploadInput = this.container.querySelector('.upload-input') as HTMLInputElement;
    const searchInput = this.container.querySelector('.library-search') as HTMLInputElement;

    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', () => this.handleUpload(uploadInput));

    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.renderBooks();
    });
  }

  private async loadBooks(): Promise<void> {
    try {
      this.books = await api.getBooks();
      this.renderBooks();
    } catch (err) {
      console.error('Failed to load books:', err);
      this.showError('Failed to load library');
    }
  }

  private renderBooks(): void {
    const content = this.container.querySelector('.library-content')!;

    const filtered = this.books.filter((book) => {
      if (!this.searchQuery) return true;
      const title = (book.title || book.filename).toLowerCase();
      const author = (book.author || '').toLowerCase();
      return title.includes(this.searchQuery) || author.includes(this.searchQuery);
    });

    if (filtered.length === 0) {
      content.innerHTML = `
        <div class="library-empty">
          ${this.books.length === 0
            ? 'No books yet. Upload an EPUB to get started.'
            : 'No books match your search.'}
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="book-grid">
        ${filtered.map((book) => this.renderBookCard(book)).join('')}
      </div>
    `;

    // Bind click events
    content.querySelectorAll('.book-card').forEach((card) => {
      const hash = (card as HTMLElement).dataset.hash!;
      card.addEventListener('click', (e) => {
        // Don't trigger if clicking delete button
        if ((e.target as HTMLElement).closest('.book-delete')) return;
        const book = this.books.find((b) => b.hash === hash);
        if (book) this.onBookSelected(book);
      });
    });

    // Bind delete events
    content.querySelectorAll('.book-delete').forEach((btn) => {
      const hash = (btn as HTMLElement).dataset.hash!;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleDelete(hash);
      });
    });
  }

  private renderBookCard(book: BookInfo): string {
    const title = book.title || book.filename.replace('.epub', '');
    const author = book.author || 'Unknown Author';
    const lastRead = book.last_read_at
      ? this.formatDate(book.last_read_at)
      : 'Never read';

    let progressHtml = '';
    if (book.position) {
      // Show the actual chapter title from the book
      const chapterDisplay = book.position.chapterTitle || `Ch. ${book.position.chapterIndex + 1}`;
      progressHtml = `<div class="book-progress">${this.escapeHtml(chapterDisplay)}</div>`;
    }

    return `
      <div class="book-card" data-hash="${book.hash}">
        <div class="book-cover">
          <span class="book-icon">📖</span>
        </div>
        <div class="book-info">
          <div class="book-title" title="${this.escapeHtml(title)}">${this.escapeHtml(title)}</div>
          <div class="book-author">${this.escapeHtml(author)}</div>
          <div class="book-meta">
            <span class="book-last-read">${lastRead}</span>
            ${progressHtml}
          </div>
        </div>
        <button class="book-delete" data-hash="${book.hash}" title="Delete book">×</button>
      </div>
    `;
  }

  private async handleUpload(input: HTMLInputElement): Promise<void> {
    const files = input.files;
    if (!files || files.length === 0) return;

    const uploadBtn = this.container.querySelector('.upload-btn') as HTMLButtonElement;
    const originalText = uploadBtn.textContent;
    uploadBtn.disabled = true;

    const fileArray = Array.from(files);
    const isSingleFile = fileArray.length === 1;

    try {
      let lastResult: (BookInfo & { alreadyExists?: boolean }) | null = null;
      let successCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        uploadBtn.textContent = isSingleFile
          ? 'Uploading...'
          : `Uploading ${i + 1}/${fileArray.length}...`;

        try {
          lastResult = await api.uploadBook(file);
          successCount++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          errors.push(`${file.name}: ${msg}`);
        }
      }

      // Refresh the library
      await this.loadBooks();

      // If single file uploaded successfully, open it
      if (isSingleFile && lastResult) {
        this.onBookSelected(lastResult);
      } else if (errors.length > 0) {
        // Show errors for multi-file upload
        alert(`Uploaded ${successCount}/${fileArray.length} books.\n\nErrors:\n${errors.join('\n')}`);
      }
    } finally {
      uploadBtn.textContent = originalText;
      uploadBtn.disabled = false;
      input.value = '';
    }
  }

  private async handleDelete(hash: string): Promise<void> {
    const book = this.books.find((b) => b.hash === hash);
    if (!book) return;

    const title = book.title || book.filename;
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

    try {
      await api.deleteBook(hash);
      this.books = this.books.filter((b) => b.hash !== hash);
      this.renderBooks();
    } catch (err) {
      console.error('Failed to delete book:', err);
      alert('Failed to delete book');
    }
  }

  private showError(message: string): void {
    const content = this.container.querySelector('.library-content')!;
    content.innerHTML = `<div class="library-error">${this.escapeHtml(message)}</div>`;
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
