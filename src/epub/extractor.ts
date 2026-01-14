import type { Book } from 'epubjs';
import type { ProcessedBook, Chapter, Paragraph } from '../types';
import { processParagraph } from '../rsvp/word-processor';

export class TextExtractor {
  async extractBook(book: Book): Promise<ProcessedBook> {
    const metadata = await book.loaded.metadata;
    const chapters: Chapter[] = [];

    const spine = book.spine as any;
    const spineLength = spine.spineItems?.length || 0;

    for (let i = 0; i < spineLength; i++) {
      try {
        const section = book.spine.get(i);
        if (section) {
          const chapter = await this.extractChapter(section, i, book);
          if (chapter.paragraphs.length > 0) {
            chapters.push(chapter);
          }
        }
      } catch (err) {
        console.warn(`Failed to extract chapter ${i}:`, err);
      }
    }

    return {
      title: metadata.title || 'Untitled',
      author: metadata.creator || 'Unknown',
      chapters,
    };
  }

  private async extractChapter(
    section: any,
    index: number,
    book: Book
  ): Promise<Chapter> {
    try {
      const href = section.href;

      // Use book.load to fetch content from the archive
      const result = await book.load(href);

      let html: string | undefined;
      if (typeof result === 'string') {
        html = result;
      } else if (result && typeof result === 'object') {
        html = (result as any).documentElement?.outerHTML ||
               (result as any).outerHTML ||
               (result as any).innerHTML;
      }

      if (!html || typeof html !== 'string') {
        return { index, title: `Chapter ${index + 1}`, paragraphs: [] };
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const paragraphs: Paragraph[] = [];
      const elements = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6');

      elements.forEach((el: Element) => {
        // Skip elements that contain other block elements (avoid duplicates)
        if (el.querySelector('p, h1, h2, h3, h4, h5, h6')) {
          return;
        }

        const text = el.textContent?.trim();
        if (text && text.length > 0) {
          const paragraph = processParagraph(text, el.tagName.toLowerCase());
          if (paragraph.words.length > 0) {
            paragraphs.push(paragraph);
          }
        }
      });

      const title = this.findChapterTitle(doc, index);

      return { index, title, paragraphs };
    } catch (err) {
      console.error(`Error loading chapter ${index}:`, err);
      return { index, title: `Chapter ${index + 1}`, paragraphs: [] };
    }
  }

  private findChapterTitle(doc: Document, index: number): string {
    const heading = doc.querySelector('h1, h2, h3');
    const text = heading?.textContent?.trim();
    if (text && text.length > 0 && text.length < 100) {
      return text;
    }
    return `Chapter ${index + 1}`;
  }
}
