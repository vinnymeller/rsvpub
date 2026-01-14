// Word frequency list loader and bucket lookup
// Returns bucket multipliers for uncommon word delays

// Bucket multipliers based on word rank
const BUCKET_THRESHOLDS = [
  { maxRank: 1000, multiplier: 0 },      // Common - no extra delay
  { maxRank: 3000, multiplier: 0.25 },   // Familiar
  { maxRank: 5000, multiplier: 0.5 },    // Less common
  { maxRank: 10000, multiplier: 0.75 },  // Uncommon
];
const NOT_IN_LIST_MULTIPLIER = 1.0;      // Rare - full extra delay

let wordRanks: Map<string, number> | null = null;
let loadPromise: Promise<void> | null = null;

export async function loadWordlist(): Promise<void> {
  if (wordRanks !== null) return;
  if (loadPromise !== null) return loadPromise;

  loadPromise = (async () => {
    try {
      const response = await fetch('/wordlist.txt');
      if (!response.ok) {
        console.warn('Wordlist not found, frequency delays disabled');
        wordRanks = new Map();
        return;
      }

      const text = await response.text();
      const words = text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);

      wordRanks = new Map();
      words.forEach((word, index) => {
        wordRanks!.set(word, index + 1); // 1-indexed rank
      });

      console.log(`Loaded ${wordRanks.size} words from frequency list`);
    } catch (err) {
      console.warn('Failed to load wordlist:', err);
      wordRanks = new Map();
    }
  })();

  return loadPromise;
}

export function getWordBucketMultiplier(word: string): number {
  if (!wordRanks || wordRanks.size === 0) return 0;

  // Normalize: lowercase, strip punctuation
  const normalized = word.toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.length === 0) return 0;

  const rank = wordRanks.get(normalized);

  if (rank === undefined) {
    return NOT_IN_LIST_MULTIPLIER;
  }

  for (const bucket of BUCKET_THRESHOLDS) {
    if (rank <= bucket.maxRank) {
      return bucket.multiplier;
    }
  }

  return NOT_IN_LIST_MULTIPLIER;
}

export function isWordlistLoaded(): boolean {
  return wordRanks !== null && wordRanks.size > 0;
}
