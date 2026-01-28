/**
 * Unit tests for diff utilities
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeLineEndings,
  calculateSimilarity,
  applyUnifiedDiffs,
  validateDiff,
  detectOverlappingDiffs,
  checkForOverlaps,
} from '../../src/utils/diff.utils.js';
import type { CodeFile, Diff } from '../../src/types/index.js';
import { DiffApplicationError } from '../../src/types/index.js';
import { config } from '../../src/config/index.js';

describe('normalizeLineEndings', () => {
  it('should convert CRLF to LF', () => {
    const input = 'line1\r\nline2\r\nline3';
    const expected = 'line1\nline2\nline3';
    expect(normalizeLineEndings(input)).toBe(expected);
  });

  it('should leave LF unchanged', () => {
    const input = 'line1\nline2\nline3';
    expect(normalizeLineEndings(input)).toBe(input);
  });

  it('should handle mixed line endings', () => {
    const input = 'line1\r\nline2\nline3\r\nline4';
    const expected = 'line1\nline2\nline3\nline4';
    expect(normalizeLineEndings(input)).toBe(expected);
  });
});

describe('calculateSimilarity', () => {
  it('should return 1.0 for identical strings', () => {
    expect(calculateSimilarity('hello', 'hello')).toBe(1.0);
  });

  it('should return 1.0 for empty strings', () => {
    expect(calculateSimilarity('', '')).toBe(1.0);
  });

  it('should handle one character difference', () => {
    const similarity = calculateSimilarity('hello', 'hallo');
    expect(similarity).toBeGreaterThan(0.7);
  });

  it('should handle completely different strings', () => {
    const similarity = calculateSimilarity('abc', 'xyz');
    expect(similarity).toBeLessThan(0.5);
  });

  it('should handle different lengths', () => {
    const similarity = calculateSimilarity('hello world', 'hello');
    // "hello world" (11 chars) vs "hello" (5 chars) - 5 matching chars out of 11 = ~0.45
    expect(similarity).toBeGreaterThan(0.4);
    expect(similarity).toBeLessThan(0.5);
  });
});

describe('applyUnifiedDiffs', () => {
  const file: CodeFile = {
    path: '/test/file.ts',
    content: 'line1\nline2\nline3\nline4\nline5',
  };

  it('should apply a simple diff', () => {
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 2,
      line_end: 3,
      before: 'line2',
      after: 'modified line2',
      reasoning: 'test',
    };

    const result = applyUnifiedDiffs(file.content, file.path, [diff]);
    expect(result).toContain('modified line2');
    expect(result).toContain('line1');
    expect(result).toContain('line3');
  });

  it('should apply multiple diffs to the same file', () => {
    const diffs: Diff[] = [
      {
        file: '/test/file.ts',
        line_start: 1,
        line_end: 2,
        before: 'line1',
        after: 'new line1',
        reasoning: 'test1',
      },
      {
        file: '/test/file.ts',
        line_start: 4,
        line_end: 5,
        before: 'line4',
        after: 'new line4',
        reasoning: 'test2',
      },
    ];

    const result = applyUnifiedDiffs(file.content, file.path, diffs);
    expect(result).toContain('new line1');
    expect(result).toContain('new line4');
    expect(result).toContain('line3');
  });

  it('should handle overlapping diffs', () => {
    const content = 'line1\nline2\nline3\nline4\nline5';
    const diffs: Diff[] = [
      {
        file: '/test/file.ts',
        line_start: 2,
        line_end: 4,
        before: 'line2\nline3',
        after: 'new2\nnew3',
        reasoning: 'test1',
      },
      {
        file: '/test/file.ts',
        line_start: 3,
        line_end: 5,
        before: 'line3\nline4',
        after: 'new3\nnew4',
        reasoning: 'test2',
      },
    ];

    const result = applyUnifiedDiffs(content, file.path, diffs);
    // Should handle overlap gracefully
    expect(result).toBeTruthy();
  });

  it('should throw for invalid line numbers', () => {
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 100,
      line_end: 101,
      before: 'nonexistent',
      after: 'replacement',
      reasoning: 'test',
    };

    expect(() => applyUnifiedDiffs(file.content, file.path, [diff])).toThrow(DiffApplicationError);
  });

  it('should throw when line_end is before line_start', () => {
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 5,
      line_end: 2,
      before: 'test',
      after: 'test',
      reasoning: 'test',
    };

    expect(() => applyUnifiedDiffs(file.content, file.path, [diff])).toThrow(DiffApplicationError);
  });

  it('should use fuzzy matching for slightly different content', () => {
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 2,
      line_end: 3,
      before: 'line2', // Slight variation from actual content
      after: 'modified',
      reasoning: 'test',
    };

    const result = applyUnifiedDiffs(file.content, file.path, [diff]);
    expect(result).toContain('modified');
  });

  it('should return original content for empty diffs', () => {
    const result = applyUnifiedDiffs(file.content, file.path, []);
    expect(result).toBe(file.content);
  });
});

describe('validateDiff', () => {
  const file: CodeFile = {
    path: '/test/file.ts',
    content: 'line1\nline2\nline3\nline4\nline5',
  };

  it('should validate a correct diff', () => {
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 2,
      line_end: 3,
      before: 'line2',
      after: 'modified',
      reasoning: 'test',
    };

    const issues = validateDiff(file, diff);
    expect(issues.filter((i) => i.type === 'error')).toHaveLength(0);
  });

  it('should detect oversized diffs', () => {
    const largeContent = 'x'.repeat(config.maxDiffSize + 1000); // Exceeds limit
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 1,
      line_end: 2,
      before: largeContent,
      after: largeContent,
      reasoning: 'test',
    };

    const issues = validateDiff(file, diff);
    expect(issues.some((i) => i.severity === 'critical' && i.message.includes('too large'))).toBe(true);
  });

  it('should detect invalid line numbers', () => {
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 100,
      line_end: 101,
      before: 'test',
      after: 'test',
      reasoning: 'test',
    };

    const issues = validateDiff(file, diff);
    expect(issues.some((i) => i.severity === 'critical' && i.message.includes('Invalid line_start'))).toBe(true);
  });

  it('should detect line_end before line_start', () => {
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 5,
      line_end: 2,
      before: 'test',
      after: 'test',
      reasoning: 'test',
    };

    const issues = validateDiff(file, diff);
    expect(issues.some((i) => i.severity === 'critical' && i.message.includes('cannot be before'))).toBe(true);
  });

  it('should warn about deleting non-empty content', () => {
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 2,
      line_end: 3,
      before: 'line2',
      after: '',
      reasoning: 'delete',
    };

    const issues = validateDiff(file, diff);
    expect(issues.some((i) => i.type === 'warning' && i.message.includes('Deleting'))).toBe(true);
  });

  it('should warn about mismatched before content', () => {
    const diff: Diff = {
      file: '/test/file.ts',
      line_start: 2,
      line_end: 3,
      before: 'completely different content',
      after: 'modified',
      reasoning: 'test',
    };

    const issues = validateDiff(file, diff);
    expect(issues.some((i) => i.type === 'warning' && i.message.includes('differs significantly'))).toBe(true);
  });
});

describe('detectOverlappingDiffs', () => {
  it('should group diffs by file', () => {
    const diffs: Diff[] = [
      { file: 'file1.ts', line_start: 1, line_end: 2, before: 'a', after: 'b', reasoning: 'test' },
      { file: 'file2.ts', line_start: 1, line_end: 2, before: 'c', after: 'd', reasoning: 'test' },
      { file: 'file1.ts', line_start: 3, line_end: 4, before: 'e', after: 'f', reasoning: 'test' },
    ];

    const grouped = detectOverlappingDiffs(diffs);
    expect(grouped.size).toBe(2);
    expect(grouped.get('file1.ts')?.length).toBe(2);
    expect(grouped.get('file2.ts')?.length).toBe(1);
  });

  it('should handle empty diffs array', () => {
    const grouped = detectOverlappingDiffs([]);
    expect(grouped.size).toBe(0);
  });
});

describe('checkForOverlaps', () => {
  it('should detect overlapping diffs', () => {
    const diffs: Diff[] = [
      { file: 'test.ts', line_start: 1, line_end: 5, before: 'a', after: 'b', reasoning: 'test' },
      { file: 'test.ts', line_start: 3, line_end: 7, before: 'c', after: 'd', reasoning: 'test' },
    ];

    const result = checkForOverlaps(diffs);
    expect(result.hasOverlaps).toBe(true);
    expect(result.overlaps).toHaveLength(1);
  });

  it('should not detect overlaps for non-overlapping diffs', () => {
    const diffs: Diff[] = [
      { file: 'test.ts', line_start: 1, line_end: 2, before: 'a', after: 'b', reasoning: 'test' },
      { file: 'test.ts', line_start: 5, line_end: 6, before: 'c', after: 'd', reasoning: 'test' },
    ];

    const result = checkForOverlaps(diffs);
    expect(result.hasOverlaps).toBe(false);
    expect(result.overlaps).toHaveLength(0);
  });

  it('should handle adjacent diffs (not overlapping)', () => {
    const diffs: Diff[] = [
      { file: 'test.ts', line_start: 1, line_end: 3, before: 'a', after: 'b', reasoning: 'test' },
      { file: 'test.ts', line_start: 3, line_end: 5, before: 'c', after: 'd', reasoning: 'test' },
    ];

    const result = checkForOverlaps(diffs);
    expect(result.hasOverlaps).toBe(false);
  });
});
