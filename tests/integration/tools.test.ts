/**
 * Integration tests for MCP tools
 * Tests the full workflow: analyze → think → plan → execute
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { SessionManager } from '../../src/managers/session.manager.js';
import { GitManager } from '../../src/managers/git.manager.js';
import { CodeValidator } from '../../src/managers/validator.js';
import { analyzeStyle, detectUIConcerns } from '../../src/utils/style.utils.js';
import {
  applyUnifiedDiffs,
  validateDiff,
  detectOverlappingDiffs,
  checkForOverlaps,
} from '../../src/utils/diff.utils.js';
import type { CodeFile, Diff } from '../../src/types/index.js';

describe('MCP Tools Integration', () => {
  let tempDir: string;
  let testFilePath: string;
  let sessionManager: SessionManager;
  let gitManager: GitManager;
  let validator: CodeValidator;

  beforeAll(async () => {
    // Create temporary directory
    tempDir = await mkdtemp('mcp-test-');
    testFilePath = join(tempDir, 'test.ts');

    // Initialize managers (disable locking for tests)
    sessionManager = new SessionManager(join(tempDir, '.sessions'), { disableLocking: true });
    gitManager = new GitManager(tempDir);
    validator = new CodeValidator();

    // Initialize git repo
    await import('child_process').then((cp) =>
      cp.execSync('git init', { cwd: tempDir, stdio: 'ignore' })
    );
    await import('child_process').then((cp) =>
      cp.execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' })
    );
    await import('child_process').then((cp) =>
      cp.execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' })
    );

    // Create initial file
    const initialContent = `function hello() {
  console.log("Hello, world!");
  return "hello";
}`;
    await writeFile(testFilePath, initialContent, 'utf-8');

    // Stage and commit the initial file
    await import('child_process').then((cp) =>
      cp.execSync('git add test.ts', { cwd: tempDir, stdio: 'ignore' })
    );
    await import('child_process').then((cp) =>
      cp.execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' })
    );
  });

  afterAll(async () => {
    await sessionManager.destroy();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Full Workflow Test', () => {
    it('should complete analyze → think → plan → execute workflow', async () => {
      // Step 1: Analyze context
      const fileContent = await readFile(testFilePath, 'utf-8');
      const files: CodeFile[] = [
        {
          path: testFilePath,
          content: fileContent,
          language: 'typescript',
        },
      ];

      const sessionId = await sessionManager.createSession(files, 'Change greeting to goodbye');
      const session = await sessionManager.getSession(sessionId);

      // Analyze style
      const styleProfile = analyzeStyle(files);
      expect(styleProfile.indentation).toBe('2 spaces');
      expect(styleProfile.patterns).toContain('TypeScript/JSX');

      // Check for UI concerns (should be none in this file)
      const uiConcerns = detectUIConcerns(files);
      expect(uiConcerns.length).toBe(0);

      // Step 2: Think aloud
      await sessionManager.addThought(sessionId, 'Function uses console.log, should change message', 1);
      await sessionManager.addThought(sessionId, 'Return value should also change to "goodbye"', 2);
      await sessionManager.addThought(sessionId, 'Need to maintain 2-space indentation', 3);

      const updatedSession = await sessionManager.getSession(sessionId);
      expect(updatedSession.thoughts).toHaveLength(3);

      // Step 3: Plan and verify
      const diffs: Diff[] = [
        {
          file: testFilePath,
          line_start: 2,
          line_end: 3,
          before: '  console.log("Hello, world!");',
          after: '  console.log("Goodbye, world!");',
          reasoning: 'Change greeting message',
        },
        {
          file: testFilePath,
          line_start: 3,
          line_end: 4,
          before: '  return "hello";',
          after: '  return "goodbye";',
          reasoning: 'Change return value',
        },
      ];

      // Validate diffs
      let allIssues: any[] = [];
      for (const diff of diffs) {
        const file = session.files.find((f) => f.path === diff.file)!;
        const issues = validateDiff(file, diff);
        allIssues.push(...issues);
      }

      // Should have no critical errors
      const criticalIssues = allIssues.filter((i) => i.severity === 'critical');
      expect(criticalIssues.length).toBe(0);

      // Check for overlaps
      const diffsByFile = detectOverlappingDiffs(diffs);
      expect(diffsByFile.size).toBe(1);

      const fileDiffs = diffsByFile.get(testFilePath)!;
      const overlapCheck = checkForOverlaps(fileDiffs);
      expect(overlapCheck.hasOverlaps).toBe(false);

      // Save diffs to session
      await sessionManager.addDiffs(sessionId, diffs);

      // Step 4: Execute (dry run first)
      let modifiedContent = fileContent;
      for (const file of session.files) {
        const fileDiffs = diffs.filter((d) => d.file === file.path);
        if (fileDiffs.length > 0) {
          modifiedContent = applyUnifiedDiffs(file.content, file.path, fileDiffs);
        }
      }

      expect(modifiedContent).toContain('Goodbye, world!');
      expect(modifiedContent).toContain('return "goodbye"');

      // Format with validator
      const formatted = await validator.formatCode(modifiedContent, testFilePath, styleProfile);
      expect(formatted).toBeTruthy();

      // Verify syntax
      const syntaxError = await validator.validateSyntax(formatted, testFilePath);
      expect(syntaxError).toBeNull();
    });
  });

  describe('Git Operations', () => {
    it('should detect file changes', async () => {
      // Create a new temporary file for this test to avoid conflicts
      const testFile2 = join(tempDir, 'test2.ts');
      await writeFile(testFile2, 'original content', 'utf-8');

      // Stage the file
      await gitManager.stageFiles(['test2.ts']);

      // Commit
      const commitResult = await gitManager.commit('Add test2.ts');
      expect(commitResult.success).toBe(true);

      // After commit, file should not be in files list at all (or working_dir is 'M')
      const status2 = await gitManager.getStatus();
      const test2File = status2.files.find(f => f.path.endsWith('test2.ts'));

      // File should either not be in files, or have working_dir == ' ' (not modified)
      if (test2File) {
        expect(test2File.working_dir).toBe(' '); // Clean
      }

      // Now modify the file
      await writeFile(testFile2, 'modified content', 'utf-8');

      const status3 = await gitManager.getStatus();
      const test2File2 = status3.files.find(f => f.path.endsWith('test2.ts'));

      // Should show as modified
      expect(test2File2).toBeDefined();
      if (test2File2) {
        expect(test2File2.working_dir).not.toBe(' ');
      }

      // Clean up
      await import('fs/promises').then((fs) => fs.unlink(testFile2));
    });

    it('should detect uncommitted changes', async () => {
      // Create a new file for this test
      const testFile3 = join(tempDir, 'test3.ts');
      await writeFile(testFile3, 'content', 'utf-8');

      await gitManager.stageFiles(['test3.ts']);
      await gitManager.commit('Add test3.ts');

      // Should be clean (no modifications)
      const hasChanges = await gitManager.isFileDirty('test3.ts');
      expect(hasChanges).toBe(false);

      // Modify the file
      await writeFile(testFile3, 'modified', 'utf-8');

      const hasChanges2 = await gitManager.isFileDirty('test3.ts');
      expect(hasChanges2).toBe(true);

      // Clean up
      await import('fs/promises').then((fs) => fs.unlink(testFile3));
    });

    it('should get current branch', async () => {
      const branch = await gitManager.getCurrentBranch();
      expect(branch).toBe('main');
    });

    it('should get latest commit', async () => {
      const commit = await gitManager.getLatestCommit();
      expect(commit).toBeTruthy();
      expect(commit?.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session ID gracefully', async () => {
      await expect(sessionManager.getSession('invalid-session-id')).rejects.toThrow();
    });

    it('should handle invalid diffs', async () => {
      const fileContent = await readFile(testFilePath, 'utf-8');
      const files: CodeFile[] = [{ path: testFilePath, content: fileContent }];

      const invalidDiff: Diff = {
        file: testFilePath,
        line_start: 999,
        line_end: 1000,
        before: 'nonexistent',
        after: 'replacement',
        reasoning: 'test',
      };

      const issues = validateDiff(files[0], invalidDiff);
      expect(issues.some((i) => i.severity === 'critical')).toBe(true);
    });

    it('should handle overlapping diffs with warnings', async () => {
      const fileContent = await readFile(testFilePath, 'utf-8');
      const files: CodeFile[] = [{ path: testFilePath, content: fileContent }];

      const overlappingDiffs: Diff[] = [
        {
          file: testFilePath,
          line_start: 1,
          line_end: 3,
          before: 'line1\nline2',
          after: 'new1\nnew2',
          reasoning: 'test1',
        },
        {
          file: testFilePath,
          line_start: 2,
          line_end: 4,
          before: 'line2\nline3',
          after: 'new2\nnew3',
          reasoning: 'test2',
        },
      ];

      const diffsByFile = detectOverlappingDiffs(overlappingDiffs);
      const fileDiffs = diffsByFile.get(testFilePath)!;
      const overlapCheck = checkForOverlaps(fileDiffs);

      expect(overlapCheck.hasOverlaps).toBe(true);
      expect(overlapCheck.overlaps.length).toBeGreaterThan(0);
    });
  });

  describe('Style Detection', () => {
    it('should detect tabs indentation', async () => {
      const files: CodeFile[] = [
        {
          path: 'test.ts',
          content: 'function test() {\n\treturn true;\n}',
        },
      ];

      const style = analyzeStyle(files);
      expect(style.indentation).toBe('tabs');
    });

    it('should detect 4-space indentation', async () => {
      const files: CodeFile[] = [
        {
          path: 'test.ts',
          content: 'function test() {\n    return true;\n}',
        },
      ];

      const style = analyzeStyle(files);
      expect(style.indentation).toBe('4 spaces');
    });

    it('should detect single vs double quotes', async () => {
      const singleQuoteFiles: CodeFile[] = [
        {
          path: 'test.ts',
          content: "const x = 'single';\nconst y = 'quotes';",
        },
      ];

      const doubleQuoteFiles: CodeFile[] = [
        {
          path: 'test.ts',
          content: 'const x = "double";\nconst y = "quotes";',
        },
      ];

      const singleStyle = analyzeStyle(singleQuoteFiles);
      const doubleStyle = analyzeStyle(doubleQuoteFiles);

      expect(singleStyle.quotes).toBe('single');
      expect(doubleStyle.quotes).toBe('double');
    });

    it('should detect React patterns', async () => {
      const files: CodeFile[] = [
        {
          path: 'test.tsx',
          content: `
import { useState } from 'react';

function Component() {
  const [count, setCount] = useState(0);
  return <div className="container">{count}</div>;
}
          `,
        },
      ];

      const style = analyzeStyle(files);
      expect(style.patterns).toContain('React hooks');
      expect(style.patterns).toContain('React');
    });
  });

  describe('Session Persistence', () => {
    it('should persist session data across retrievals', async () => {
      const files: CodeFile[] = [{ path: 'test.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test request');

      // Add data
      await sessionManager.addThought(sessionId, 'thought 1', 1);
      await sessionManager.addThought(sessionId, 'thought 2', 2);

      const diffs: Diff[] = [
        {
          file: 'test.ts',
          line_start: 1,
          line_end: 2,
          before: 'test',
          after: 'modified',
          reasoning: 'test',
        },
      ];
      await sessionManager.addDiffs(sessionId, diffs);

      // Retrieve and verify
      const session = await sessionManager.getSession(sessionId);
      expect(session.thoughts).toHaveLength(2);
      expect(session.diffs).toHaveLength(1);
      expect(session.diffs[0].after).toBe('modified');
    });

    it('should handle session expiration', async () => {
      const files: CodeFile[] = [{ path: 'test.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      // Manually expire session
      const session = await sessionManager.getSession(sessionId);
      session.expiresAt = Date.now() - 1000;
      await sessionManager.saveSession(session);

      // Should throw expired error
      await expect(sessionManager.getSession(sessionId)).rejects.toThrow();
    });
  });
});
