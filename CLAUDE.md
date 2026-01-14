# CLAUDE.md - AI Assistant Guide for RSVPub

## Architecture Overview

```
Client (TypeScript + Vite)          Server (Express + sql.js)
┌─────────────────────────┐         ┌─────────────────────────┐
│  App (src/ui/app.ts)    │         │  Routes                 │
│    ├── Library View     │  HTTP   │    ├── /api/books       │
│    ├── Reader View      │◄───────►│    ├── /api/checkpoints │
│    └── RSVP Engine      │         │    └── /api/stats       │
│                         │         │                         │
│  EPUB Processing        │         │  sql.js Database        │
│    ├── loader.ts        │         │    └── books/checkpoints│
│    └── extractor.ts     │         │                         │
└─────────────────────────┘         │  File Storage           │
                                    │    └── {hash}.epub      │
                                    └─────────────────────────┘
```

## Critical Pattern: Event Listener Cleanup

**This is the most important pattern in the codebase.** The RSVP engine uses a pub-sub pattern where listeners return cleanup functions. These MUST be called when switching views to avoid stale DOM references.

```typescript
// CORRECT: Store and call cleanup functions
private engineCleanup: (() => void)[] = [];

private setupEngineListeners(): void {
  this.cleanupEngineListeners();  // Always clear first
  this.engineCleanup.push(
    this.engine.onWordChange((info) => this.updateWordDisplay(info))
  );
}

private cleanupEngineListeners(): void {
  this.engineCleanup.forEach(cleanup => cleanup());
  this.engineCleanup = [];
}

// Call cleanup when leaving reader view
private showLibrary(): void {
  this.cleanupEngineListeners();  // REQUIRED
  // ...
}
```

**Why:** Without cleanup, old listeners fire after DOM is cleared, causing `querySelector` to return null and crash.

## Key Files

| File | Purpose |
|------|---------|
| `src/ui/app.ts` | Main orchestrator - manages Library/Reader views, event listeners, checkpoint saving |
| `src/rsvp/engine.ts` | Core playback - state management, word timing, position tracking |
| `src/epub/extractor.ts` | EPUB parsing - extracts chapters/paragraphs from spine sections |
| `src/api/client.ts` | HTTP client - singleton `api` export used throughout frontend |
| `server/db.ts` | sql.js wrapper - debounced saves, prepared statements |
| `server/routes/books.ts` | Book CRUD - upload, list, download, delete |

## Data Flow: EPUB to Word Display

1. Upload: `Library.handleUpload()` → `api.uploadBook()` → server hashes file, saves to disk
2. Open: `App.openBook()` → `api.getBookFile()` → server streams EPUB
3. Parse: `EPUBLoader.loadFromArrayBuffer()` → `TextExtractor.extractBook()`
4. Load: `RSVPEngine.loadBook(processedBook)` → sets position (0,0,0)
5. Display: Engine fires `onWordChange` → `App.updateWordDisplay()` renders ORP-highlighted word

## State Structure

```typescript
// RSVPEngine maintains this state
interface RSVPState {
  status: 'idle' | 'loading' | 'ready' | 'playing' | 'paused';
  position: { chapterIndex, paragraphIndex, wordIndex };
  wpm: number;
  book: ProcessedBook | null;
  viewMode: 'rsvp' | 'paragraph';
}

// ProcessedBook structure from extractor
interface ProcessedBook {
  title: string;
  author: string;
  chapters: Array<{
    index: number;      // Spine index (may skip numbers if empty chapters filtered)
    title: string;
    paragraphs: Array<{
      words: Array<{ text, orpIndex, delay }>;
      sourceElement: string;
    }>;
  }>;
}
```

## Gotchas

### 1. Chapter Index vs Array Position
Empty EPUB spine items (cover, TOC) are filtered out. A chapter's `index` field is the original spine index, but its position in `book.chapters[]` array may differ. Always use array position for navigation.

### 2. DOM Reference Staleness
Always guard against null when accessing cached DOM elements or using querySelector:
```typescript
if (!this.wordDisplay) return;  // Guard at method start
const el = this.container.querySelector('.word-display');
if (!el) return;  // Guard after querySelector
```

### 3. Checkpoint Saves on Pause Only
Checkpoints are saved via the `onStatusChange` listener when status becomes `'paused'`. Not auto-saved on idle or navigation.

### 4. ORP (Optimal Recognition Point) Calculation
The red-highlighted letter where eyes focus:
- 1 char: index 0
- 2-3 chars: index 1
- 4+ chars: `Math.floor(length/2) - 1`

Located in `src/rsvp/word-processor.ts`.

### 5. Database Debouncing
`server/db.ts` batches writes with 100ms debounce. Multiple rapid operations = single disk write.

### 6. Books Identified by Content Hash
Same file uploaded twice = detected as duplicate (returns existing book with `alreadyExists: true`).

## Database Schema

```sql
books (id, hash UNIQUE, filename, title, author, added_at, last_read_at)
checkpoints (id, book_hash FK, chapter_index, paragraph_index, word_index, wpm, chapter_title, created_at)
stats (id, book_hash FK, session_start, session_end, words_read, avg_wpm)
```

## Testing Changes

1. **Switching books:** Open Book A → pause → Library → Open Book B (repeat rapidly)
2. **Position restore:** Pause at specific word → refresh page → should restore exact position
3. **Chapter navigation:** Use dropdown, prev/next buttons, keyboard (PageUp/PageDown)
4. **View modes:** Toggle V between RSVP and paragraph view, click words to jump

## Common Tasks

### Adding a new API endpoint
1. Add route in `server/routes/*.ts`
2. Add method to `src/api/client.ts`
3. Update TypeScript interfaces if needed

### Modifying word display
Look at `renderWord()` and `renderSentenceContext()` in `app.ts`. The word display uses three spans: `.word-before`, `.word-orp`, `.word-after`.

### Changing timing/delays
See `src/rsvp/timing.ts` for WPM calculation and `src/rsvp/word-processor.ts` for punctuation delays.

### Adding database fields
1. Update interface in `server/db.ts`
2. Add column to schema string
3. Add migration in `init()`: `try { db.run('ALTER TABLE...') } catch {}`
