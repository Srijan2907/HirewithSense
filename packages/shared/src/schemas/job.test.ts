import { describe, expect, it } from 'vitest';
import { CreateJobBody, UpdateJobBody, UpdateQuestionBody, UpdateCodingProblemBody } from './job.js';

describe('job schemas', () => {
  it('applies defaults on create only', () => {
    const created = CreateJobBody.parse({ title: 'Engineer', description: 'A long enough description.' });
    expect(created.competencies.length).toBeGreaterThan(0);
    expect(created.skills).toEqual([]);
    expect(created.minimumScore).toBe(65);
  });
  it('does not inject defaults on update (Zod 4 partial semantics)', () => {
    const updated = UpdateJobBody.parse({ status: 'open' });
    expect(updated).toEqual({ status: 'open' });
    expect(UpdateQuestionBody.parse({ prompt: 'A valid prompt' })).toEqual({ prompt: 'A valid prompt' });
    expect(UpdateCodingProblemBody.parse({ title: 'New title' })).toEqual({ title: 'New title' });
  });
  it('rejects weights not totalling 100', () => {
    expect(() => CreateJobBody.parse({ title: 'x1', description: 'A long enough description.', competencies: [{ key: 'a', label: 'A', weight: 10 }] })).toThrow(/total 100/);
  });
});
