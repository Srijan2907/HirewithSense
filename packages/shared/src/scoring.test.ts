import { describe, expect, it } from 'vitest';
import { codingScore, levelFromScore, recommend, weightedScore } from './scoring.js';

describe('weightedScore', () => {
  it('weights assessed competencies and reports coverage', () => {
    const r = weightedScore([
      { weight: 50, score: 80 },
      { weight: 30, score: 60 },
      { weight: 20, score: null },
    ]);
    expect(r.score).toBe(72.5);
    expect(r.coverage).toBe(0.8);
  });
  it('returns null when nothing assessed', () => {
    expect(weightedScore([{ weight: 100, score: null }])).toEqual({ score: null, coverage: 0 });
  });
});

describe('recommend', () => {
  it('requires coverage', () => {
    expect(recommend(90, 0.4, 65)).toBe('insufficient_evidence');
  });
  it('maps bands', () => {
    expect(recommend(90, 1, 65)).toBe('strong_hire');
    expect(recommend(70, 1, 65)).toBe('hire');
    expect(recommend(58, 1, 65)).toBe('borderline');
    expect(recommend(40, 1, 65)).toBe('no_hire');
  });
});

describe('levels and coding score', () => {
  it('maps levels', () => {
    expect(levelFromScore(90)).toBe(5);
    expect(levelFromScore(10)).toBe(1);
    expect(levelFromScore(null)).toBeNull();
  });
  it('computes coding score', () => {
    expect(codingScore([{ passedWeight: 3, totalWeight: 4 }, { passedWeight: 1, totalWeight: 1 }])).toBe(80);
    expect(codingScore([])).toBeNull();
  });
});
