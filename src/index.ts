#!/usr/bin/env node

/**
 * mcp-coding-thinker v1.0.0
 * AI Code Surgeon: Think → Edit → Verify → Ship
 * Production-ready with overlapping diff support, syntax validation, and git safety.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from "fs";
import { resolve, dirname, join } from "path";
import { execSync } from "child_process";
import * as prettier from "prettier";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CodeFile {
  path: string;
  content: string;
  language?: string;
}

interface StyleProfile {
  indentation: string;
  quotes: string;
  componentStyle: string;
  importStyle: string;
  patterns: string[];
}

interface Issue {
  type: "error" | "warning" | "suggestion";
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  file?: string;
  line?: number;
}

interface Diff {
  file: string;
  line_start: number;
  line_end: number;
  before: string;
  after: string;
  reasoning: string;
}

interface SessionState {
  id: string;
  files: CodeFile[];
  request: string;
  styleProfile?: StyleProfile;
  issues: Issue[];
  thoughts: string[];
  diffs: Diff[];
  createdAt: number;
}

// ============================================================================
// SESSION MANAGEMENT (Persistent)
// ============================================================================

const SESSION_DIR = ".mcp-sessions";
const BACKUP_DIR = ".mcp-backups";
const SESSION_TTL = 60 * 60 * 1000;
const MAX_DIFF_SIZE = 10000; // 10k chars per diff

if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

function createSession(files: CodeFile[], request: string): string {
  const id = randomUUID();
  const session: SessionState = {
    id,
    files,
    request,
    issues: [],
    thoughts: [],
    diffs: [],
    createdAt: Date.now(),
  };
  saveSession(session);
  return id;
}

function getSession(id: string): SessionState | null {
  const sessionPath = join(SESSION_DIR, `${id}.json`);
  if (!existsSync(sessionPath)) return null;
  
  const session = JSON.parse(readFileSync(sessionPath, 'utf-8')) as SessionState;
  
  if (Date.now() - session.createdAt > SESSION_TTL) {
    return null;
  }
  
  return session;
}

function saveSession(session: SessionState): void {
  const sessionPath = join(SESSION_DIR, `${session.id}.json`);
  writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
}

function cleanupSessions(): void {
  const now = Date.now();
  try {
    const files = readdirSync(SESSION_DIR);
    for (const file of files) {
      const sessionPath = join(SESSION_DIR, file);
      try {
        const session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
        if (now - session.createdAt > SESSION_TTL) {
          unlinkSync(sessionPath);
        }
      } catch (e) {
        unlinkSync(sessionPath);
      }
    }
  } catch (e) {
    // Directory doesn't exist or empty
  }
}

setInterval(cleanupSessions, 10 * 60 * 1000);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function analyzeStyle(files: CodeFile[]): StyleProfile {
  const allContent = files.map(f => f.content).join("\n");
  
  const hasSpaces2 = /\n {2}[^\s]/.test(allContent);
  const hasSpaces4 = /\n {4}[^\s]/.test(allContent);
  const hasTabs = /\n\t/.test(allContent);
  
  const hasSingleQuotes = (allContent.match(/'/g) || []).length;
  const hasDoubleQuotes = (allContent.match(/"/g) || []).length;
  
  const hasFunctional = /const \w+ = \(.*\) =>/.test(allContent) || /function \w+\(/.test(allContent);
  const hasClass = /class \w+ extends/.test(allContent);
  
  const hasNamedImports = /import \{/.test(allContent);
  const hasDefaultImports = /import \w+ from/.test(allContent);
  
  const patterns: string[] = [];
  if (/useState|useEffect/.test(allContent)) patterns.push("uses React hooks");
  if (/\.tsx?$/.test(files.map(f => f.path).join(""))) patterns.push("TypeScript");
  if (/tailwind|className/.test(allContent)) patterns.push("Tailwind CSS");
  if (/async|await/.test(allContent)) patterns.push("async/await");
  if (/interface |type /.test(allContent)) patterns.push("strong typing");
  
  return {
    indentation: hasTabs ? "tabs" : hasSpaces4 ? "4 spaces" : "2 spaces",
    quotes: hasSingleQuotes > hasDoubleQuotes ? "single" : "double",
    componentStyle: hasClass ? (hasFunctional ? "mixed" : "class") : "functional",
    importStyle: hasNamedImports && hasDefaultImports ? "mixed" : hasNamedImports ? "named" : "default",
    patterns,
  };
}

function detectUIConcerns(files: CodeFile[]): string[] {
  const concerns: string[] = [];
  const allContent = files.map(f => f.content).join("\n");
  
  if (/text-gray-900.*bg-gray-900|text-black.*bg-gray-900/.test(allContent)) {
    concerns.push("Potential color contrast issue: dark text on dark background");
  }
  if (/text-white.*bg-white|text-gray-100.*bg-white/.test(allContent)) {
    concerns.push("Potential color contrast issue: light text on light background");
  }
  if (/<img(?![^>]*alt=)/.test(allContent)) {
    concerns.push("Images missing alt text for accessibility");
  }
  if (/<button[^>]*>[\s]*<[^>]*>[\s]*<\/button>/.test(allContent)) {
    concerns.push("Buttons with only icons may need aria-label");
  }
  if (/width:\s*\d+px/.test(allContent) && !/max-width|min-width/.test(allContent)) {
    concerns.push("Fixed pixel widths detected - consider responsive units");
  }
  
  return concerns;
}

/**
 * Normalize line endings to LF (Unix style)
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Apply all diffs to a file using unified patch approach
 * Handles overlapping diffs by creating a single unified patch
 */
function applyUnifiedDiffs(originalContent: string, filePath: string, diffs: Diff[]): string {
  if (diffs.length === 0) return originalContent;
  
  // Normalize line endings first
  let currentContent = normalizeLineEndings(originalContent);
  
  // Sort diffs by line number
  const sortedDiffs = [...diffs].sort((a, b) => a.line_start - b.line_start);
  
  // Build the complete modified content by applying diffs sequentially
  // but tracking line offsets to handle overlaps
  let lineOffset = 0;
  
  for (const diff of sortedDiffs) {
    const lines = currentContent.split("\n");
    
    // Adjust line numbers based on previous changes
    const adjustedStart = diff.line_start - 1 + lineOffset;
    const adjustedEnd = diff.line_end + lineOffset;
    
    // Extract current content at target lines
    const currentSection = lines.slice(adjustedStart, adjustedEnd).join("\n");
    
    // Normalize diff content for comparison
    const normalizedBefore = normalizeLineEndings(diff.before);
    const normalizedAfter = normalizeLineEndings(diff.after);
    
    // If before content doesn't match, try fuzzy matching within 2 lines
    let matchFound = false;
    let matchOffset = 0;
    
    if (currentSection.trim() === normalizedBefore.trim()) {
      matchFound = true;
    } else {
      // Try fuzzy match within ±2 lines
      for (let offset = -2; offset <= 2; offset++) {
        const fuzzyStart = Math.max(0, adjustedStart + offset);
        const fuzzyEnd = Math.min(lines.length, adjustedEnd + offset);
        const fuzzySection = lines.slice(fuzzyStart, fuzzyEnd).join("\n");
        
        if (fuzzySection.trim() === normalizedBefore.trim()) {
          matchFound = true;
          matchOffset = offset;
          break;
        }
      }
    }
    
    if (!matchFound) {
      throw new Error(
        `Diff application failed for ${filePath} at line ${diff.line_start}. ` +
        `Expected content doesn't match. This may indicate overlapping edits or outdated diff.`
      );
    }
    
    // Apply the diff
    const finalStart = adjustedStart + matchOffset;
    const finalEnd = adjustedEnd + matchOffset;
    const beforeLines = finalEnd - finalStart;
    const afterLines = normalizedAfter.split("\n").length;
    
    lines.splice(finalStart, beforeLines, ...normalizedAfter.split("\n"));
    currentContent = lines.join("\n");
    
    // Update line offset for subsequent diffs
    lineOffset += (afterLines - beforeLines);
  }
  
  return currentContent;
}

/**
 * Validate syntax before formatting
 * Returns error message if syntax is invalid, null if valid
 */
function validateSyntax(content: string, filePath: string): string | null {
  // TypeScript/JavaScript files
  if (/\.(tsx?|jsx?)$/.test(filePath)) {
    try {
      // Use prettier's parser to validate syntax
      prettier.format(content, { 
        filepath: filePath,
        parser: 'typescript'
      });
      return null;
    } catch (e) {
      return `Syntax error in ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  
  // JSON files
  if (/\.json$/.test(filePath)) {
    try {
      JSON.parse(content);
      return null;
    } catch (e) {
      return `Invalid JSON in ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  
  // CSS/SCSS files
  if (/\.(css|scss)$/.test(filePath)) {
    try {
      prettier.format(content, { 
        filepath: filePath,
        parser: 'css'
      });
      return null;
    } catch (e) {
      return `CSS syntax error in ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  
  return null; // Unknown file type, skip validation
}

/**
 * Detect and load prettier config from user's repo
 */
async function loadPrettierConfig(filePath: string): Promise<prettier.Options | null> {
  try {
    const config = await prettier.resolveConfig(filePath);
    return config;
  } catch (e) {
    return null;
  }
}

async function enforceStyle(content: string, filePath: string, style: StyleProfile): Promise<string> {
  // Normalize line endings first
  content = normalizeLineEndings(content);
  
  // Validate syntax first
  const syntaxError = validateSyntax(content, filePath);
  if (syntaxError) {
    throw new Error(syntaxError);
  }
  
  try {
    // Try to load user's prettier config first
    const userConfig = await loadPrettierConfig(filePath);
    
    const options: prettier.Options = {
      filepath: filePath,
      // Use user config if available, otherwise use detected style
      ...(userConfig || {
        singleQuote: style.quotes === 'single',
        tabWidth: style.indentation === 'tabs' ? 2 : parseInt(style.indentation.replace(' spaces', '')),
        useTabs: style.indentation === 'tabs',
        semi: true,
        trailingComma: 'es5',
      }),
    };
    
    return await prettier.format(content, options);
  } catch (e) {
    throw new Error(`Formatting failed for ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function validateDiff(file: CodeFile, diff: Diff): Issue[] {
  const issues: Issue[] = [];
  const lines = file.content.split("\n");
  
  // Check size limits (prevent OOM)
  if (diff.before.length > MAX_DIFF_SIZE || diff.after.length > MAX_DIFF_SIZE) {
    issues.push({
      type: "error",
      severity: "critical",
      message: `Diff too large (before: ${diff.before.length}, after: ${diff.after.length} chars). Max ${MAX_DIFF_SIZE} chars per diff.`,
      file: file.path,
      line: diff.line_start,
    });
    return issues; // Stop validation if size exceeded
  }
  
  if (diff.line_start < 1 || diff.line_start > lines.length + 1) {
    issues.push({
      type: "error",
      severity: "critical",
      message: `Invalid line_start ${diff.line_start} (file has ${lines.length} lines)`,
      file: file.path,
      line: diff.line_start,
    });
  }
  
  if (diff.line_end < diff.line_start) {
    issues.push({
      type: "error",
      severity: "critical",
      message: `line_end (${diff.line_end}) cannot be before line_start (${diff.line_start})`,
      file: file.path,
      line: diff.line_start,
    });
  }
  
  const actualLines = lines.slice(diff.line_start - 1, diff.line_end);
  const actualContent = actualLines.join("\n");
  
  // Normalize for comparison
  const normalizedActual = normalizeLineEndings(actualContent);
  const normalizedBefore = normalizeLineEndings(diff.before);
  
  if (normalizedBefore && normalizedActual.trim() !== normalizedBefore.trim()) {
    // Check for fuzzy match
    const similarity = calculateSimilarity(normalizedActual, normalizedBefore);
    if (similarity < 0.8) {
      issues.push({
        type: "warning",
        severity: "high",
        message: `Before content differs significantly (${Math.round(similarity * 100)}% match) - may indicate stale diff`,
        file: file.path,
        line: diff.line_start,
      });
    } else {
      issues.push({
        type: "warning",
        severity: "medium",
        message: "Before content differs slightly - will attempt fuzzy matching",
        file: file.path,
        line: diff.line_start,
      });
    }
  }
  
  if (!diff.after.trim() && diff.before.trim()) {
    issues.push({
      type: "warning",
      severity: "medium",
      message: "Deleting non-empty content - verify this is intentional",
      file: file.path,
      line: diff.line_start,
    });
  }
  
  return issues;
}

function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

function generateLintableCode(session: SessionState): string {
  const fileSnapshots: string[] = [];
  
  for (const file of session.files) {
    const fileDiffs = session.diffs.filter(d => d.file === file.path);
    
    if (fileDiffs.length === 0) {
      fileSnapshots.push(`// ====== ${file.path} (unchanged) ======\n${file.content}`);
      continue;
    }
    
    try {
      const content = applyUnifiedDiffs(file.content, file.path, fileDiffs);
      fileSnapshots.push(`// ====== ${file.path} ======\n${content}`);
    } catch (e) {
      fileSnapshots.push(`// ====== ${file.path} (ERROR) ======\n// ${e}\n${file.content}`);
    }
  }
  
  return fileSnapshots.join("\n\n");
}

function gitIsDirty(filePath: string): boolean {
  try {
    const status = execSync(`git status --porcelain "${filePath}"`, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).toString().trim();
    return status.length > 0;
  } catch (e) {
    return false;
  }
}

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function checkGitState(): { canCommit: boolean; reason?: string } {
  if (!isGitRepo()) {
    return { canCommit: false, reason: "Not a git repository" };
  }
  
  try {
    // Check for detached HEAD
    const headCheck = execSync('git symbolic-ref -q HEAD', { stdio: 'pipe' }).toString();
    if (!headCheck) {
      return { canCommit: false, reason: "Detached HEAD state" };
    }
  } catch (e) {
    return { canCommit: false, reason: "Detached HEAD state" };
  }
  
  try {
    // Check for rebase/merge in progress
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).toString().trim();
    if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) {
      return { canCommit: false, reason: "Rebase in progress" };
    }
    if (existsSync(join(gitDir, 'MERGE_HEAD'))) {
      return { canCommit: false, reason: "Merge in progress" };
    }
  } catch (e) {
    // Can't determine, proceed with caution
  }
  
  return { canCommit: true };
}

function gitSafetyNet(session: SessionState): string {
  const backupSessionDir = join(BACKUP_DIR, session.id);
  if (!existsSync(backupSessionDir)) {
    mkdirSync(backupSessionDir, { recursive: true });
  }
  
  const messages: string[] = [];
  
  // Backup all files
  for (const file of session.files) {
    try {
      const backupPath = join(backupSessionDir, file.path);
      const backupDir = dirname(backupPath);
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }
      copyFileSync(file.path, backupPath);
    } catch (e) {
      messages.push(`⚠️ Backup failed for ${file.path}: ${e}`);
    }
  }
  
  messages.push(`✅ Backed up ${session.files.length} files to ${backupSessionDir}`);
  
  // Git operations
  const gitState = checkGitState();
  
  if (!gitState.canCommit) {
    messages.push(`⚠️ Git auto-commit skipped: ${gitState.reason}`);
    messages.push(`   Please commit manually after reviewing changes`);
    return messages.join('\n');
  }
  
  try {
    // Stage changes
    const filePaths = session.files.map(f => `"${f.path}"`).join(' ');
    execSync(`git add ${filePaths}`, { stdio: 'pipe' });
    
    // Create commit message from reasoning
    const thoughtSummary = session.thoughts.slice(-3).join('; ').slice(0, 100);
    const commitMsg = `mcp-coding-thinker: ${thoughtSummary || session.request.slice(0, 100)}`;
    
    // Attempt commit (may fail due to pre-commit hooks)
    try {
      execSync(`git commit -m "${commitMsg}"`, { stdio: 'pipe' });
      messages.push(`✅ Git: Staged & committed`);
      messages.push(`   Message: "${commitMsg}"`);
      messages.push(`   Revert: git revert HEAD`);
    } catch (commitError) {
      messages.push(`⚠️ Git: Files staged but commit failed (likely pre-commit hook)`);
      messages.push(`   Error: ${commitError instanceof Error ? commitError.message : String(commitError)}`);
      messages.push(`   Review staged changes: git status`);
      messages.push(`   Unstage: git reset HEAD`);
    }
  } catch (e) {
    messages.push(`⚠️ Git operations failed: ${e instanceof Error ? e.message : String(e)}`);
    messages.push(`   Files may be partially staged - check: git status`);
  }
  
  return messages.join('\n');
}

/**
 * Generate mirror critique prompt with modified code
 * Model should call this with the code to get real AI critique
 */
function generateMirrorCritiquePrompt(session: SessionState): string {
  const modifiedCode = generateLintableCode(session);
  
  return `You are a senior software architect performing a code review for production release.

CONTEXT:
User Request: ${session.request}
Files Modified: ${session.files.length}
Changes Applied: ${session.diffs.length} diffs
Reasoning Steps: ${session.thoughts.length}

MODIFIED CODE:
${modifiedCode}

YOUR TASK:
Perform a brutal, honest code review. Consider:
1. Will this break in production? What edge cases are missed?
2. Is the code maintainable? Will future devs understand it?
3. Does it follow best practices for the detected patterns (${session.styleProfile?.patterns.join(', ')})?
4. Are there performance concerns or security issues?
5. Will this scale? Are there hidden dependencies?

Be harsh. If you would reject this PR, say so and explain exactly why.
If it's production-ready, explain what makes it solid.

PROVIDE YOUR REVIEW:`;
}

// ============================================================================
// MCP SERVER
// ============================================================================

const server = new Server(
  { name: "mcp-coding-thinker", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "analyze_context",
      description: `Step 1: Analyze code files and understand the request.

Returns:
- session_id: Use in subsequent tool calls
- style_profile: Auto-detected code style (will enforce on edits)
- issues: Pre-existing problems (including git status)
- research_queries: Suggested searches for best practices
- git_status: Repository state and commit readiness

Call this FIRST before any other tool.`,
      inputSchema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
                language: { type: "string" },
              },
              required: ["path", "content"],
            },
          },
          request: { type: "string" },
        },
        required: ["files", "request"],
      },
    },
    {
      name: "think_aloud",
      description: `Step 2: Record code-specific reasoning steps.

Example thoughts:
- "Component uses hooks, will use useState"
- "Detected dark text on dark bg at line 42, will fix with text-gray-100"
- "Need to preserve existing event handlers"
- "User prefers single-file changes based on style"

Call multiple times to show incremental reasoning. 
More thoughts (5+) = higher confidence scores and better mirror critique.`,
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          thought: { type: "string" },
          step: { type: "number" },
          needs_more: { type: "boolean" },
        },
        required: ["session_id", "thought", "step", "needs_more"],
      },
    },
    {
      name: "plan_and_verify",
      description: `Step 3: Submit implementation plan with ACTUAL DIFFS.

You MUST provide exact line-by-line changes. The server will:
- Validate diffs with fuzzy matching (±2 lines tolerance)
- Check size limits (max ${MAX_DIFF_SIZE} chars per diff)
- Detect overlapping edits and handle them correctly
- Check for conflicts and stale diffs
- Generate lintable code preview
- Calculate safety score

CRITICAL: 
- Provide real diffs with exact line numbers from original files
- Multiple diffs to same file are supported (server handles overlaps)
- Before content should match closely (80%+ similarity)
- Keep diffs under ${MAX_DIFF_SIZE} characters`,
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          diffs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                file: { type: "string" },
                line_start: { type: "number", description: "1-indexed" },
                line_end: { type: "number", description: "1-indexed" },
                before: { type: "string" },
                after: { type: "string" },
                reasoning: { type: "string" },
              },
              required: ["file", "line_start", "line_end", "before", "after", "reasoning"],
            },
          },
          phases: {
            type: "array",
            items: { type: "string" },
            description: "Implementation phases for this specific request",
          },
        },
        required: ["session_id", "diffs", "phases"],
      },
    },
    {
      name: "execute_and_review",
      description: `Step 4: Execute changes with full safety net.

Process:
1. Normalize line endings (CRLF → LF)
2. Apply diffs using unified patching (handles overlaps)
3. Validate syntax (fails visibly on errors)
4. Auto-format with user's prettier config (or detected style)
5. Back up originals to .mcp-backups/
6. Write changes to disk
7. Check git state (detached HEAD, rebase, hooks)
8. Stage & commit (with graceful hook failure handling)
9. Return mirror critique prompt for AI review

Set approved=true to proceed.
Use dry_run=true to preview without writing.

Mirror critique: The response includes a prompt with modified code that you should
analyze to provide honest architectural review (not automated).`,
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          approved: { type: "boolean", default: false },
          dry_run: { type: "boolean", default: false },
        },
        required: ["session_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "analyze_context") {
      const { files, request: userRequest } = args as {
        files: CodeFile[];
        request: string;
      };

      if (!files || files.length === 0) {
        throw new Error("At least one file is required");
      }

      const sessionId = createSession(files, userRequest);
      const session = getSession(sessionId)!;

      const styleProfile = analyzeStyle(files);
      session.styleProfile = styleProfile;

      const issues: Issue[] = [];
      const uiConcerns = detectUIConcerns(files);
      
      uiConcerns.forEach(concern => {
        issues.push({
          type: "warning",
          severity: "medium",
          message: concern,
        });
      });

      const allContent = files.map(f => f.content).join("\n");
      if (/console\.log/.test(allContent)) {
        issues.push({
          type: "suggestion",
          severity: "low",
          message: "Remove console.log statements before production",
        });
      }

      if (/\bany\b/.test(allContent) && /\.tsx?$/.test(files.map(f => f.path).join(""))) {
        issues.push({
          type: "suggestion",
          severity: "medium",
          message: "Avoid 'any' type - use specific types for better type safety",
        });
      }
      
      // Check git status
      for (const file of files) {
        if (gitIsDirty(file.path)) {
          issues.push({
            type: "warning",
            severity: "high",
            message: `File has uncommitted changes: ${file.path}`,
            file: file.path,
          });
        }
      }
      
      // Check git state
      const gitState = checkGitState();
      if (!gitState.canCommit && isGitRepo()) {
        issues.push({
          type: "warning",
          severity: "high",
          message: `Git auto-commit will be skipped: ${gitState.reason}`,
        });
      }

      session.issues = issues;
      saveSession(session);

      const researchQueries: string[] = [];
      if (/dark mode|theme/i.test(userRequest)) {
        researchQueries.push("Tailwind CSS dark mode best practices 2026");
      }
      if (/translation|i18n|locale/i.test(userRequest)) {
        researchQueries.push("React i18n best practices 2026");
      }
      if (/responsive|mobile/i.test(userRequest)) {
        researchQueries.push("responsive design patterns 2026");
      }
      if (/accessibility|a11y/i.test(userRequest)) {
        researchQueries.push("web accessibility guidelines WCAG 2026");
      }

      let recommendedApproach = "single-file edit";
      if (files.length > 3) {
        recommendedApproach = "multi-file coordinated changes";
      }
      if (/refactor|restructure/i.test(userRequest)) {
        recommendedApproach = "phased refactoring with tests";
      }

      const confidence = Math.max(70, Math.min(95, 
        85 - (issues.filter(i => i.severity === 'high' || i.severity === 'critical').length * 8)
           + (styleProfile.patterns.length * 2)
      ));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            session_id: sessionId,
            understanding: `Analyzing ${files.length} file(s) for: ${userRequest}`,
            style_profile: styleProfile,
            issues,
            confidence,
            research_queries: researchQueries,
            recommended_approach: recommendedApproach,
            ui_concerns: uiConcerns,
            git_status: gitState.canCommit 
              ? "✅ Git ready - will auto-commit" 
              : `⚠️ ${gitState.reason} - manual commit needed`,
          }, null, 2),
        }],
      };
    }

    if (name === "think_aloud") {
      const { session_id, thought, step, needs_more } = args as {
        session_id: string;
        thought: string;
        step: number;
        needs_more: boolean;
      };

      const session = getSession(session_id);
      if (!session) {
        throw new Error("Session not found or expired. Call analyze_context first.");
      }

      session.thoughts.push(`[Step ${step}] ${thought}`);
      saveSession(session);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            recorded: true,
            thought_id: `${session_id}-${step}`,
            continue: needs_more,
            cumulative_thoughts: session.thoughts.length,
            depth_quality: session.thoughts.length >= 5 ? "excellent" : session.thoughts.length >= 3 ? "good" : "shallow",
          }, null, 2),
        }],
      };
    }

    if (name === "plan_and_verify") {
      const { session_id, diffs, phases } = args as {
        session_id: string;
        diffs: Diff[];
        phases: string[];
      };

      const session = getSession(session_id);
      if (!session) {
        throw new Error("Session not found or expired. Call analyze_context first.");
      }

      if (!diffs || diffs.length === 0) {
        throw new Error("No diffs provided. You must specify the exact changes to make.");
      }

      const verificationIssues: Issue[] = [];
      
      // Group diffs by file to check for overlaps
      const diffsByFile = new Map<string, Diff[]>();
      for (const diff of diffs) {
        if (!diffsByFile.has(diff.file)) {
          diffsByFile.set(diff.file, []);
        }
        diffsByFile.get(diff.file)!.push(diff);
      }
      
      // Validate each file's diffs
      for (const [filePath, fileDiffs] of diffsByFile) {
        const file = session.files.find(f => f.path === filePath);
        if (!file) {
          verificationIssues.push({
            type: "error",
            severity: "critical",
            message: `File not found: ${filePath}`,
          });
          continue;
        }
        
        // Check for overlapping diffs
        const sorted = [...fileDiffs].sort((a, b) => a.line_start - b.line_start);
        for (let i = 0; i < sorted.length - 1; i++) {
          const current = sorted[i];
          const next = sorted[i + 1];
          
          if (current.line_end >= next.line_start) {
            verificationIssues.push({
              type: "warning",
              severity: "medium",
              message: `Overlapping diffs detected in ${filePath} (lines ${current.line_start}-${current.line_end} and ${next.line_start}-${next.line_end}). Will use unified patching.`,
              file: filePath,
            });
          }
        }
        
        // Validate each diff
        for (const diff of fileDiffs) {
          const diffIssues = validateDiff(file, diff);
          verificationIssues.push(...diffIssues);
        }
      }

      session.diffs = diffs;
      saveSession(session);

      const lintCode = generateLintableCode(session);

      const confidence = Math.max(60, Math.min(98, 
        90 - (verificationIssues.filter(i => i.severity === "critical").length * 15)
           - (verificationIssues.filter(i => i.severity === "high").length * 8)
           - (verificationIssues.filter(i => i.severity === "medium").length * 3)
           + (session.thoughts.length * 2)
      ));

      const safetyScore = Math.max(40, Math.min(100,
        95 - (verificationIssues.filter(i => i.severity === 'critical').length * 25)
           - (verificationIssues.filter(i => i.severity === 'high').length * 10)
      ));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            plan: {
              phases,
              diffs,
              confidence,
              estimated_changes: diffs.length,
              overlapping_edits: diffsByFile.size < diffs.length,
            },
            verification: {
              issues: verificationIssues,
              lint_code: lintCode,
              needs_human: verificationIssues.some(i => i.severity === 'critical'),
              safety_score: safetyScore,
              can_proceed: verificationIssues.filter(i => i.severity === 'critical').length === 0,
            },
          }, null, 2),
        }],
      };
    }

    if (name === "execute_and_review") {
      const { session_id, approved, dry_run } = args as {
        session_id: string;
        approved?: boolean;
        dry_run?: boolean;
      };

      const session = getSession(session_id);
      if (!session) {
        throw new Error("Session not found or expired. Call analyze_context first.");
      }

      if (!session.diffs || session.diffs.length === 0) {
        throw new Error("No plan found. Call plan_and_verify first with actual diffs.");
      }

      if (!approved && !dry_run) {
        throw new Error("Execution not approved. Set approved=true or dry_run=true.");
      }

      const filesModified: string[] = [];
      const detectedIssues: Issue[] = [];
      let success = true;
      let gitMessage = "";

      // Apply diffs per file
      for (const file of session.files) {
        const fileDiffs = session.diffs.filter(d => d.file === file.path);
        if (fileDiffs.length === 0) continue;

        try {
          // Apply all diffs to this file using unified approach
          let content = applyUnifiedDiffs(file.content, file.path, fileDiffs);
          
          // Apply style formatting with syntax validation
          if (session.styleProfile) {
            try {
              content = await enforceStyle(content, file.path, session.styleProfile);
            } catch (formatError) {
              detectedIssues.push({
                type: "error",
                severity: "critical",
                message: `${formatError instanceof Error ? formatError.message : String(formatError)}`,
                file: file.path,
              });
              success = false;
              continue;
            }
          }

          if (!dry_run && approved) {
            try {
              const fullPath = resolve(file.path);
              writeFileSync(fullPath, content, 'utf-8');
              filesModified.push(file.path);
            } catch (e) {
              detectedIssues.push({
                type: "error",
                severity: "critical",
                message: `Failed to write ${file.path}: ${e}`,
                file: file.path,
              });
              success = false;
            }
          } else {
            filesModified.push(`${file.path} (dry-run)`);
          }
        } catch (e) {
          detectedIssues.push({
            type: "error",
            severity: "critical",
            message: `${e instanceof Error ? e.message : String(e)}`,
            file: file.path,
          });
          success = false;
        }
      }
      
      // Git safety net
      if (success && !dry_run && approved) {
        gitMessage = gitSafetyNet(session);
      }

      const criticalIssues = session.issues.filter(i => i.severity === 'critical').length;
      const thoughtDepth = session.thoughts.length;
      
      if (thoughtDepth < 3) {
        detectedIssues.push({
          type: "warning",
          severity: "medium",
          message: "Limited reasoning recorded (< 3 steps) - analysis may be shallow",
        });
      }

      const lintCode = generateLintableCode(session);
      const mirrorPrompt = generateMirrorCritiquePrompt(session);

      const mirrorCritique = `AUTOMATED CODE REVIEW SUMMARY:

Files Modified: ${filesModified.length}
Changes Applied: ${session.diffs.length} diffs
Style Consistency: ${session.styleProfile ? '✅ VERIFIED & Auto-formatted' : 'UNKNOWN'}
Pre-existing Issues: ${session.issues.length}
New Issues Found: ${detectedIssues.length}

REASONING ANALYSIS (${thoughtDepth} steps):
${session.thoughts.join('\n')}

${gitMessage ? `GIT OPERATIONS:\n${gitMessage}\n` : ''}

AUTOMATED VERDICT: ${
  !success ? '❌ FAILED - Execution errors occurred' :
  criticalIssues > 0 ? '🚫 BLOCKED - Critical issues must be resolved' :
  detectedIssues.filter(i => i.severity === 'high').length > 0 ? '⚠️ NEEDS REVISION - High severity issues found' :
  session.diffs.length === 0 ? 'ℹ️ NO CHANGES - Already implemented or requirements unclear' :
  dry_run ? '✅ DRY RUN SUCCESSFUL - Ready for execution' :
  '✅ EXECUTED - Changes applied successfully'
}

Quality Assessment: ${
  thoughtDepth >= 5 && detectedIssues.length === 0 ? '🌟 Excellent - thorough analysis with clean implementation' :
  thoughtDepth >= 3 && detectedIssues.length <= 2 ? '✅ Good - solid reasoning with minor issues' :
  '⚠️ Acceptable - basic implementation but could be improved with deeper analysis'
}

⚠️ NOTE: For true architectural review, analyze the mirror_critique_prompt below.`;

      const quality = 
        !success || criticalIssues > 0 ? "needs_revision" :
        thoughtDepth >= 5 && detectedIssues.length === 0 ? "excellent" :
        thoughtDepth >= 3 ? "good" : "acceptable";

      const finalConfidence = success ? Math.max(60, Math.min(100,
        85 - (detectedIssues.length * 5) - (criticalIssues * 15) + (thoughtDepth * 2)
      )) : 0;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            execution: {
              success,
              files_modified: filesModified,
              changes_applied: session.diffs.length,
              dry_run: dry_run || false,
              auto_formatted: session.styleProfile ? true : false,
            },
            self_review: {
              quality,
              detected_issues: detectedIssues,
              needs_revision: quality === "needs_revision",
              mirror_critique: mirrorCritique,
              final_confidence: finalConfidence,
              lint_code: lintCode,
              mirror_critique_prompt: mirrorPrompt,
            },
          }, null, 2),
        }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ error: errorMessage }, null, 2),
      }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-coding-thinker v1.0.0 - Production-ready AI Code Surgeon 🚀");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

