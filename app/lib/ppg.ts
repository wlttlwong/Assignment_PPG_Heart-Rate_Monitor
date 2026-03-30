// app/lib/ppg.ts — pure signal helpers (no React, no DOM)
import type { Valley, HeartRateResult, HRVResult } from '../types';

export const FPS = 30;
/** 10 seconds at 30 fps. Use consistently for chart, valley detection, save, and inference. */
export const SAMPLES_TO_KEEP = 300;
/** Minimum samples before running valley detection (2 seconds). */
export const MIN_SAMPLES_FOR_DETECTION = 60;
export const MIN_RR_S = 0.4;
export const MAX_RR_S = 2.0;

export function normalizeSignal(signal: number[]): number[] {
  const min = Math.min(...signal);
  const max = Math.max(...signal);
  if (max === min) return signal;
  return signal.map((v) => (v - min) / (max - min));
}

export function isLocalMinimum(
  signal: number[],
  index: number,
  windowSize: number,
): boolean {
  const left = signal.slice(Math.max(0, index - windowSize), index);
  const right = signal.slice(
    index + 1,
    Math.min(signal.length, index + windowSize + 1),
  );
  return (
    (left.length === 0 || Math.min(...left) >= signal[index]) &&
    (right.length === 0 || Math.min(...right) > signal[index])
  );
}

export function detectValleys(signal: number[], fps: number): Valley[] {
  const minDist = Math.floor(fps * 0.4);
  const windowSize = Math.floor(fps * 0.5);
  const norm = normalizeSignal(signal);
  const valleys: Valley[] = [];
  for (let i = windowSize; i < norm.length - windowSize; i++) {
    if (isLocalMinimum(norm, i, windowSize)) {
      if (
        valleys.length === 0 ||
        i - valleys[valleys.length - 1].index >= minDist
      ) {
        valleys.push({ index: i, value: signal[i] });
      }
    }
  }
  return valleys;
}

export function heartRateFromValleys(
  valleys: Valley[],
  fps: number,
): HeartRateResult {
  if (valleys.length < 2) return { bpm: 0, confidence: 0 };
  const intervals = valleys
    .slice(1)
    .map((_, i) => (valleys[i + 1].index - valleys[i].index) / fps);
  const valid = intervals.filter((s) => s >= MIN_RR_S && s <= MAX_RR_S);
  if (valid.length === 0) return { bpm: 0, confidence: 0 };
  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance =
    valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length;
  const cv = (Math.sqrt(variance) / mean) * 100;
  const confidence = Math.max(0, Math.min(100, 100 - cv));
  return { bpm: Math.round(60 / median), confidence };
}

export function hrvFromValleys(
  valleys: Valley[],
  fps: number,
): HRVResult {
  if (valleys.length < 2) return { sdnn: 0, confidence: 0 };
  const intervalsMs = valleys
    .slice(1)
    .map((_, i) => ((valleys[i + 1].index - valleys[i].index) / fps) * 1000);
  const valid = intervalsMs.filter(
    (ms) => ms >= MIN_RR_S * 1000 && ms <= MAX_RR_S * 1000,
  );
  if (valid.length === 0) return { sdnn: 0, confidence: 0 };
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance =
    valid.reduce((s, v) => s + (v - mean) ** 2, 0) / (valid.length - 1) || 0;
  const sdnn = Math.sqrt(variance);
  const cv = (sdnn / mean) * 100;
  const consistencyConfidence = Math.max(0, 100 - cv);
  const intervalConfidence = Math.min(100, (valid.length / 5) * 100);
  const confidence = Math.round(
    Math.min(100, (intervalConfidence + consistencyConfidence) / 2),
  );
  return { sdnn: Math.round(sdnn), confidence };
}

export type SignalComputationMode = 'default' | 'redOnly' | 'greenOnly' | '2xG-R-B' | 'blueOnly';
export function computePPGFromRGB(
  rSum: number,
  gSum: number,
  bSum: number,
  pixelCount: number,
  mode: SignalComputationMode | string,
): number {
  if (pixelCount === 0) return 0;
  const R =rSum / pixelCount;
  const G = gSum / pixelCount;
  const B = bSum / pixelCount;
  switch (mode) {
    case 'redOnly':
      return R;
    case 'greenOnly':
      return G;
    case 'blueOnly':
      return B;
    case '2xG-R-B':
      return 2 * G - R - B;
    case 'default':
    default:
      return 2 * R - G - B;
  }
}