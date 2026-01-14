import JSZip from 'jszip';

export interface EpubMetadata {
  title: string | null;
  author: string | null;
}

export async function extractEpubMetadata(buffer: Buffer): Promise<EpubMetadata> {
  try {
    const zip = await JSZip.loadAsync(buffer);

    // Find the OPF file path from container.xml
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) {
      return { title: null, author: null };
    }

    // Extract rootfile path (simple regex, works for standard EPUBs)
    const rootfileMatch = containerXml.match(/full-path="([^"]+)"/);
    if (!rootfileMatch) {
      return { title: null, author: null };
    }

    const opfPath = rootfileMatch[1];
    const opfContent = await zip.file(opfPath)?.async('string');
    if (!opfContent) {
      return { title: null, author: null };
    }

    // Extract title - look for <dc:title> or <title>
    const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)
      || opfContent.match(/<title[^>]*>([^<]+)<\/title>/i);

    // Extract author - look for <dc:creator> or <creator>
    const authorMatch = opfContent.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i)
      || opfContent.match(/<creator[^>]*>([^<]+)<\/creator>/i);

    return {
      title: titleMatch ? decodeXmlEntities(titleMatch[1].trim()) : null,
      author: authorMatch ? decodeXmlEntities(authorMatch[1].trim()) : null,
    };
  } catch (err) {
    console.error('Failed to extract EPUB metadata:', err);
    return { title: null, author: null };
  }
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
