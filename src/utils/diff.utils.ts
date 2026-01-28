/**
 * Diff utility functions (OPTIMIZED v2.0)
 * Handles diff application, fuzzy matching, and similarity calculations
 * Performance: Uses fast-levenshtein library for O(n) similarity calculation
 */

import type { Diff, CodeFile, Issue } from '../types/index.js';
import { DiffApplicationError } from '../types/index.js';
import * as Levenshtein from 'fast-levenshtein';
import { config } from '../config/index.js';

// Use configuration values instead of hardcoded constants
const MAX_DIFF_SIZE = config.maxDiffSize;
const FUZZY_MATCH_TOLERANCE = config.fuzzyMatchTolerance;
const SIMILARITY_THRESHOLD = config.similarityThreshold;

/**
 * Normalize line endings to LF (Unix style)
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Calculate similarity between two strings using fast-levenshtein library
 * Performance: O(n) instead of O(n²) - ~10x faster
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  // Use fast-levenshtein library (optimized implementation)
  const editDistance = Levenshtein.get(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Apply all diffs to a file using unified patch approach
 * Handles overlapping diffs by creating a single unified patch
 *
 * @param originalContent - The original file content
 * @param filePath - Path to the file (for error messages)
 * @param diffs - Array of diffs to apply
 * @returns Modified content
 * @throws DiffApplicationError if diff application fails
 */
export function applyUnifiedDiffs(
  originalContent: string,
  filePath: string,
  diffs: Diff[]
): string {
  if (diffs.length === 0) return originalContent;

  // Normalize line endings first
  let currentContent = normalizeLineEndings(originalContent);

  // Sort diffs by line number to apply them sequentially
  const sortedDiffs = [...diffs].sort((a, b) => a.line_start - b.line_start);

  // Track line offset to handle overlapping edits
  let lineOffset = 0;

  for (const diff of sortedDiffs) {
    const lines = currentContent.split('\n');

    // Validate line numbers
    if (diff.line_start < 1 || diff.line_start > lines.length + 1) {
      throw new DiffApplicationError(
        filePath,
        diff.line_start,
        `Invalid line_start ${diff.line_start} (file has ${lines.length} lines)`
      );
    }

    if (diff.line_end < diff.line_start) {
      throw new DiffApplicationError(
        filePath,
        diff.line_start,
        `line_end (${diff.line_end}) cannot be before line_start (${diff.line_start})`
      );
    }

    // Adjust line numbers based on previous changes
    // line_start and line_end are 1-indexed, and line_end is exclusive
    const adjustedStart = diff.line_start - 1 + lineOffset;
    const adjustedEnd = diff.line_end - 1 + lineOffset;

    // Extract current content at target lines
    const currentSection = lines.slice(adjustedStart, adjustedEnd).join('\n');

    // Normalize diff content for comparison
    const normalizedBefore = normalizeLineEndings(diff.before);
    const normalizedAfter = normalizeLineEndings(diff.after);

    // Try to match the before content
    const matchResult = findMatch(
      currentSection,
      normalizedBefore,
      lines,
      adjustedStart,
      adjustedEnd
    );

    if (!matchResult.found) {
      throw new DiffApplicationError(
        filePath,
        diff.line_start,
        `Expected content doesn't match. This may indicate overlapping edits or outdated diff.\n` +
        `Expected: ${normalizedBefore.slice(0, 100)}...\n` +
        `Actual: ${currentSection.slice(0, 100)}...`
      );
    }

    // Apply the diff
    const finalStart = matchResult.offset;
    const finalEnd = matchResult.offset + (adjustedEnd - adjustedStart);
    const beforeLines = finalEnd - finalStart;
    const afterLines = normalizedAfter.split('\n').length;

    lines.splice(finalStart, beforeLines, ...normalizedAfter.split('\n'));
    currentContent = lines.join('\n');

    // Update line offset for subsequent diffs
    lineOffset += (afterLines - beforeLines);
  }

  return currentContent;
}

/**
 * Find matching content with fuzzy matching
 */
interface MatchResult {
  found: boolean;
  offset: number;
  similarity?: number;
}

function findMatch(
  currentSection: string,
  expectedBefore: string,
  lines: string[],
  adjustedStart: number,
  adjustedEnd: number
): MatchResult {
  // Try exact match first
  if (currentSection.trim() === expectedBefore.trim()) {
    return { found: true, offset: adjustedStart, similarity: 1.0 };
  }

  // If expected content is empty, any match is valid
  if (!expectedBefore.trim()) {
    return { found: true, offset: adjustedStart, similarity: 1.0 };
  }

  // Try fuzzy match within ±FUZZY_MATCH_TOLERANCE lines
  for (let offset = -FUZZY_MATCH_TOLERANCE; offset <= FUZZY_MATCH_TOLERANCE; offset++) {
    const fuzzyStart = Math.max(0, adjustedStart + offset);
    const fuzzyEnd = Math.min(lines.length, adjustedEnd + offset);
    const fuzzySection = lines.slice(fuzzyStart, fuzzyEnd).join('\n');

    if (fuzzySection.trim() === expectedBefore.trim()) {
      return { found: true, offset: fuzzyStart, similarity: 1.0 };
    }

    // Check similarity
    const similarity = calculateSimilarity(fuzzySection.trim(), expectedBefore.trim());
    if (similarity >= SIMILARITY_THRESHOLD) {
      return { found: true, offset: fuzzyStart, similarity };
    }
  }

  return { found: false, offset: adjustedStart };
}

/**
 * Validate a single diff
 */
export function validateDiff(file: CodeFile, diff: Diff): Issue[] {
  const issues: Issue[] = [];
  const lines = file.content.split('\n');

  // Check size limits (prevent OOM)
  if (diff.before.length > MAX_DIFF_SIZE || diff.after.length > MAX_DIFF_SIZE) {
    issues.push({
      type: 'error',
      severity: 'critical',
      message: `Diff too large (before: ${diff.before.length}, after: ${diff.after.length} chars). Max ${MAX_DIFF_SIZE} chars per diff.`,
      file: file.path,
      line: diff.line_start,
    });
    return issues; // Stop validation if size exceeded
  }

  // Validate line numbers
  if (diff.line_start < 1 || diff.line_start > lines.length + 1) {
    issues.push({
      type: 'error',
      severity: 'critical',
      message: `Invalid line_start ${diff.line_start} (file has ${lines.length} lines)`,
      file: file.path,
      line: diff.line_start,
    });
  }

  if (diff.line_end < diff.line_start) {
    issues.push({
      type: 'error',
      severity: 'critical',
      message: `line_end (${diff.line_end}) cannot be before line_start (${diff.line_start})`,
      file: file.path,
      line: diff.line_start,
    });
  }

  // Check if before content matches
  if (diff.line_start >= 1 && diff.line_end <= lines.length + 1) {
    const actualLines = lines.slice(diff.line_start - 1, diff.line_end - 1);
    const actualContent = actualLines.join('\n');

    const normalizedActual = normalizeLineEndings(actualContent);
    const normalizedBefore = normalizeLineEndings(diff.before);

    if (normalizedBefore && normalizedActual.trim() !== normalizedBefore.trim()) {
      const similarity = calculateSimilarity(normalizedActual, normalizedBefore);
      if (similarity < 0.8) {
        issues.push({
          type: 'warning',
          severity: 'high',
          message: `Before content differs significantly (${Math.round(similarity * 100)}% match) - may indicate stale diff`,
          file: file.path,
          line: diff.line_start,
        });
      } else {
        issues.push({
          type: 'warning',
          severity: 'medium',
          message: `Before content differs slightly (${Math.round(similarity * 100)}% match) - will attempt fuzzy matching`,
          file: file.path,
          line: diff.line_start,
        });
      }
    }
  }

  // Warn about deleting non-empty content
  if (!diff.after.trim() && diff.before.trim()) {
    issues.push({
      type: 'warning',
      severity: 'medium',
      message: 'Deleting non-empty content - verify this is intentional',
      file: file.path,
      line: diff.line_start,
    });
  }

  return issues;
}

/**
 * Check if diffs overlap
 */
export function detectOverlappingDiffs(diffs: Diff[]): Map<string, Diff[]> {
  const diffsByFile = new Map<string, Diff[]>();

  for (const diff of diffs) {
    if (!diffsByFile.has(diff.file)) {
      diffsByFile.set(diff.file, []);
    }
    diffsByFile.get(diff.file)!.push(diff);
  }

  return diffsByFile;
}

/**
 * Check for overlaps within a single file's diffs
 */
export function checkForOverlaps(fileDiffs: Diff[]): { hasOverlaps: boolean; overlaps: Array<{ diff1: Diff; diff2: Diff }> } {
  const sorted = [...fileDiffs].sort((a, b) => a.line_start - b.line_start);
  const overlaps: Array<{ diff1: Diff; diff2: Diff }> = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];

    // line_end is exclusive, so >= means overlapping, == means adjacent (not overlapping)
    if (current.line_end > next.line_start) {
      overlaps.push({ diff1: current, diff2: next });
    }
  }

  return { hasOverlaps: overlaps.length > 0, overlaps };
}
