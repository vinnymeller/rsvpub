import type { ProcessedWord, Paragraph } from '../types';
import { calculateWordDelay } from './timing';

export function calculateORP(word: string): number {
  // Strip trailing punctuation for length calculation
  let len = word.length;
  while (len > 0 && /[.,!?;:'"—\-]/.test(word[len - 1])) {
    len--;
  }

  if (len <= 1) return 0;
  if (len <= 3) return 1;
  return Math.floor(len / 2) - 1;
}

export function processWord(text: string): ProcessedWord {
  return {
    text,
    orpIndex: calculateORP(text),
    delay: calculateWordDelay(text),
  };
}

export function processText(text: string): ProcessedWord[] {
  return text
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(processWord);
}

export function processParagraph(text: string, sourceElement: string): Paragraph {
  return {
    words: processText(text),
    sourceElement,
  };
}
