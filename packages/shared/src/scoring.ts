import type { Recommendation } from './enums.js';

export interface WeightedInput {
  weight: number;
  score: number | null;
}

/**
 * Weighted mean over assessed competencies only. Returns the score (0–100, two decimals) and
 * the coverage: share of total weight that had a score. Unassessed weight is never imputed.
 */
export function weightedScore(items: WeightedInput[]): { score: number | null; coverage: number } {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (totalWeight <= 0) return { score: null, coverage: 0 };
  let assessedWeight = 0;
  let acc = 0;
  for (const i of items) {
    if (i.score === null || Number.isNaN(i.score)) continue;
    const s = Math.max(0, Math.min(100, i.score));
    acc += s * i.weight;
    assessedWeight += i.weight;
  }
  if (assessedWeight === 0) return { score: null, coverage: 0 };
  return {
    score: Math.round((acc / assessedWeight) * 100) / 100,
    coverage: Math.round((assessedWeight / totalWeight) * 1000) / 1000,
  };
}

/** Map a 0–100 score to an anchored 1–5 level. */
export function levelFromScore(score: number | null): number | null {
  if (score === null) return null;
  if (score >= 85) return 5;
  if (score >= 70) return 4;
  if (score >= 55) return 3;
  if (score >= 40) return 2;
  return 1;
}

/**
 * Derive a recommendation from the weighted score, coverage and the job's minimum. Low coverage
 * (< 50 % of weight assessed) always yields `insufficient_evidence` so recruiters are never shown a
 * confident verdict built on a partial interview.
 */
export function recommend(
  score: number | null,
  coverage: number,
  minimumScore: number,
): Recommendation {
  if (score === null || coverage < 0.5) return 'insufficient_evidence';
  if (score >= Math.max(minimumScore + 15, 85)) return 'strong_hire';
  if (score >= minimumScore) return 'hire';
  if (score >= minimumScore - 10) return 'borderline';
  return 'no_hire';
}

/** Deterministic coding score: weighted share of passed cases across the best submission per problem. */
export function codingScore(
  perProblem: { passedWeight: number; totalWeight: number }[],
): number | null {
  const total = perProblem.reduce((s, p) => s + p.totalWeight, 0);
  if (total <= 0) return null;
  const passed = perProblem.reduce((s, p) => s + p.passedWeight, 0);
  return Math.round((passed / total) * 10000) / 100;
}
