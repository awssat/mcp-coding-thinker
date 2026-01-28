/**
 * Type definitions for mcp-coding-thinker
 */

export interface CodeFile {
  path: string;
  content: string;
  language?: string;
}

export interface StyleProfile {
  indentation: string;
  quotes: string;
  componentStyle: string;
  importStyle: string;
  patterns: string[];
}

export interface Issue {
  type: "error" | "warning" | "suggestion";
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  ruleId?: string;
}

export interface Diff {
  file: string;
  line_start: number;
  line_end: number;
  before: string;
  after: string;
  reasoning: string;
}

export interface SessionState {
  id: string;
  files: CodeFile[];
  request: string;
  styleProfile?: StyleProfile;
  issues: Issue[];
  thoughts: string[];
  diffs: Diff[];
  createdAt: number;
  expiresAt: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: Issue[];
  formatted?: string;
}

export interface GitStatus {
  isRepo: boolean;
  isDirty: boolean;
  currentBranch?: string;
  canCommit: boolean;
  reason?: string;
  state: 'normal' | 'detached' | 'rebase' | 'merge' | 'conflict';
  files: Array<{ path: string; working_dir: string }>;
}

export interface GitCommitResult {
  success: boolean;
  commitHash?: string;
  message: string;
  needsManualAction: boolean;
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

export class McpCodingThinkerError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SessionNotFoundError extends McpCodingThinkerError {
  constructor(sessionId: string) {
    super(`Session not found or expired: ${sessionId}`, 'SESSION_NOT_FOUND');
  }
}

export class SessionExpiredError extends McpCodingThinkerError {
  constructor(sessionId: string) {
    super(`Session expired: ${sessionId}`, 'SESSION_EXPIRED');
  }
}

export class DiffApplicationError extends McpCodingThinkerError {
  constructor(
    file: string,
    lineStart: number,
    public reason: string
  ) {
    super(`Failed to apply diff to ${file} at line ${lineStart}: ${reason}`, 'DIFF_APPLY_FAILED');
  }
}

export class GitOperationError extends McpCodingThinkerError {
  constructor(
    public operation: string,
    message: string
  ) {
    super(`Git operation '${operation}' failed: ${message}`, 'GIT_OPERATION_FAILED');
  }
}

export class ValidationError extends McpCodingThinkerError {
  constructor(
    file: string,
    public issues: Issue[]
  ) {
    const message = `Validation failed for ${file}:\n${issues.map(i => `- [${i.severity}] ${i.message}`).join('\n')}`;
    super(message, 'VALIDATION_FAILED');
  }
}

export class ConcurrencyError extends McpCodingThinkerError {
  constructor(resource: string) {
    super(`Resource is locked by another operation: ${resource}`, 'CONCURRENCY_ERROR');
  }
}
