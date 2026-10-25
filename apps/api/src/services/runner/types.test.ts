import { describe, expect, it } from 'vitest';
import { normalizeOutput, outputsMatch } from './types.js';

describe('output comparison', () => {
  it('ignores trailing whitespace and trailing newlines', () => {
    expect(outputsMatch('1 6  \n8 10\n\n', '1 6\n8 10')).toBe(true);
    expect(outputsMatch('a\r\nb\r\n', 'a\nb\n')).toBe(true);
  });
  it('is sensitive to content and leading whitespace', () => {
    expect(outputsMatch('42', '43')).toBe(false);
    expect(outputsMatch(' 42', '42')).toBe(false);
    expect(normalizeOutput('x\n\n\n')).toBe('x');
  });
});
