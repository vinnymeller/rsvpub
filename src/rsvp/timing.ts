import { getWordBucketMultiplier } from '../wordlist';

// Punctuation delay multipliers (of base interval, not fixed ms)
// This scales naturally with WPM
const PUNCTUATION_MULTIPLIERS: Record<string, number> = {
  ',': 0.75,
  ';': 0.75,
  ':': 0.75,
  '.': 1.5,
  '!': 1.5,
  '?': 1.5,
  '—': 1.0,
  '-': 0.25,
};

export interface TimingSettings {
  lengthDelayEnabled: boolean;
  lengthDelayFactor: number;      // 0.0 - 0.5
  frequencyDelayEnabled: boolean;
  frequencyDelayFactor: number;   // 0.0 - 1.0
}

export const DEFAULT_TIMING_SETTINGS: TimingSettings = {
  lengthDelayEnabled: false,
  lengthDelayFactor: 0.1,
  frequencyDelayEnabled: false,
  frequencyDelayFactor: 0.3,
};

export function calculateBaseInterval(wpm: number): number {
  return 60000 / wpm;
}

// Punctuation delay (now scales with WPM)
export function calculatePunctuationDelay(word: string, baseInterval: number): number {
  const lastChar = word.slice(-1);
  const multiplier = PUNCTUATION_MULTIPLIERS[lastChar] ?? 0;
  return baseInterval * multiplier;
}

// Length delay: longer words show longer
// Formula: max(0, (length - 5) * factor * baseInterval)
export function calculateLengthDelay(
  word: string,
  baseInterval: number,
  factor: number
): number {
  // Strip punctuation for length calculation
  const stripped = word.replace(/[^a-zA-Z0-9]/g, '');
  const extraChars = stripped.length - 5;
  if (extraChars <= 0) return 0;
  return extraChars * factor * baseInterval;
}

// Frequency delay: uncommon words show longer
// Uses bucket multipliers from wordlist
export function calculateFrequencyDelay(
  word: string,
  baseInterval: number,
  factor: number
): number {
  const bucketMultiplier = getWordBucketMultiplier(word);
  return bucketMultiplier * factor * baseInterval;
}

// Calculate total delay for a word
export function calculateTotalDelay(
  word: string,
  wpm: number,
  settings: TimingSettings
): number {
  const baseInterval = calculateBaseInterval(wpm);

  let totalDelay = baseInterval;

  // Punctuation delay (always applied, scales with WPM)
  totalDelay += calculatePunctuationDelay(word, baseInterval);

  // Length delay (if enabled)
  if (settings.lengthDelayEnabled) {
    totalDelay += calculateLengthDelay(word, baseInterval, settings.lengthDelayFactor);
  }

  // Frequency delay (if enabled)
  if (settings.frequencyDelayEnabled) {
    totalDelay += calculateFrequencyDelay(word, baseInterval, settings.frequencyDelayFactor);
  }

  return totalDelay;
}

// Legacy function for backwards compatibility (used in word-processor.ts)
export function calculateWordDelay(word: string): number {
  // This returns the old fixed delay - will be removed once engine uses new system
  const LEGACY_DELAYS: Record<string, number> = {
    ',': 150,
    ';': 150,
    ':': 150,
    '.': 300,
    '!': 300,
    '?': 300,
    '—': 200,
    '-': 50,
  };
  const lastChar = word.slice(-1);
  return LEGACY_DELAYS[lastChar] ?? 0;
}

export const DEFAULT_WPM = 300;
export const MIN_WPM = 100;
export const MAX_WPM = 1000;
export const WPM_STEP = 25;
