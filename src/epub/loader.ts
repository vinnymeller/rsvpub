import ePub, { Book } from 'epubjs';

export class EPUBLoader {
  private book: Book | null = null;

  async loadFromArrayBuffer(data: ArrayBuffer): Promise<Book> {
    this.book = ePub(data);
    await this.book.ready;
    return this.book;
  }

  async loadFromFile(file: File): Promise<Book> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = e.target?.result as ArrayBuffer;
          const book = await this.loadFromArrayBuffer(data);
          resolve(book);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  getBook(): Book | null {
    return this.book;
  }
}
