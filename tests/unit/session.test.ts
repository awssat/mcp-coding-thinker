/**
 * Unit tests for session manager
 * Note: These tests run sequentially to avoid lock conflicts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { readdirSync } from 'fs';
import { join } from 'path';
import { SessionManager } from '../../src/managers/session.manager.js';
import { SessionNotFoundError, SessionExpiredError } from '../../src/types/index.js';
import type { CodeFile } from '../../src/types/index.js';
import { randomUUID } from 'crypto';

// Helper to wait for lock files to be released
async function waitForLockRelease(sessionDir: string, maxWait = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const files = readdirSync(sessionDir);
    const lockFiles = files.filter(f => f.endsWith('.lock'));
    if (lockFiles.length === 0) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe.sequential('SessionManager', () => {
  let sessionManager: SessionManager;
  const testSessionDir = `.test-sessions-${randomUUID()}`;

  beforeEach(async () => {
    // Disable locking for tests to avoid filesystem delays
    sessionManager = new SessionManager(testSessionDir, { disableLocking: true });
  });

  afterEach(async () => {
    await sessionManager.destroy();
    try {
      rmSync(testSessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createSession', () => {
    it('should create a new session', async () => {
      const files: CodeFile[] = [
        { path: '/test/file.ts', content: 'console.log("test");' },
      ];
      const request = 'Test request';

      const sessionId = await sessionManager.createSession(files, request);
      expect(sessionId).toBeTruthy();

      const session = await sessionManager.getSession(sessionId);
      expect(session.id).toBe(sessionId);
      expect(session.request).toBe(request);
      expect(session.files).toHaveLength(1);
      expect(session.thoughts).toHaveLength(0);
      expect(session.diffs).toHaveLength(0);
    });

    it('should set expiration time', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      const session = await sessionManager.getSession(sessionId);
      expect(session.expiresAt).toBeGreaterThan(Date.now());
      expect(session.expiresAt).toBeLessThan(Date.now() + 60 * 60 * 1000 + 1000);
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      const session = await sessionManager.getSession(sessionId);
      expect(session).toBeTruthy();
      expect(session.id).toBe(sessionId);
    });

    it('should throw SessionNotFoundError for non-existent session', async () => {
      await expect(sessionManager.getSession('nonexistent')).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe('saveSession', () => {
    it('should save session changes', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      const session = await sessionManager.getSession(sessionId);
      session.thoughts.push('thought 1');
      await sessionManager.saveSession(session);

      const retrieved = await sessionManager.getSession(sessionId);
      expect(retrieved.thoughts).toHaveLength(1);
      expect(retrieved.thoughts[0]).toBe('thought 1');
    });
  });

  describe('addThought', () => {
    it('should add thought to session', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      await sessionManager.addThought(sessionId, 'test thought', 1);

      const session = await sessionManager.getSession(sessionId);
      expect(session.thoughts).toHaveLength(1);
      expect(session.thoughts[0]).toContain('[Step 1]');
      expect(session.thoughts[0]).toContain('test thought');
    });

    it('should append multiple thoughts', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      await sessionManager.addThought(sessionId, 'thought 1', 1);
      await sessionManager.addThought(sessionId, 'thought 2', 2);

      const session = await sessionManager.getSession(sessionId);
      expect(session.thoughts).toHaveLength(2);
    });
  });

  describe('addDiffs', () => {
    it('should add diffs to session', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      const diffs = [
        {
          file: '/test/file.ts',
          line_start: 1,
          line_end: 2,
          before: 'test',
          after: 'modified',
          reasoning: 'test',
        },
      ];

      await sessionManager.addDiffs(sessionId, diffs);

      const session = await sessionManager.getSession(sessionId);
      expect(session.diffs).toHaveLength(1);
      expect(session.diffs[0].after).toBe('modified');
    });
  });

  describe('updateSession', () => {
    it('should update session fields', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      await sessionManager.updateSession(sessionId, {
        thoughts: ['updated'],
      });

      const session = await sessionManager.getSession(sessionId);
      expect(session.thoughts).toEqual(['updated']);
    });
  });

  describe('deleteSession', () => {
    it('should delete session', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      await sessionManager.deleteSession(sessionId);

      await expect(sessionManager.getSession(sessionId)).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe('sessionExists', () => {
    it('should return true for existing session', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      expect(sessionManager.sessionExists(sessionId)).toBe(true);
    });

    it('should return false for non-existent session', () => {
      expect(sessionManager.sessionExists('nonexistent')).toBe(false);
    });
  });

  describe('getActiveSessions', () => {
    it('should return active session IDs', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId1 = await sessionManager.createSession(files, 'test1');
      const sessionId2 = await sessionManager.createSession(files, 'test2');

      const activeIds = await sessionManager.getActiveSessions();
      expect(activeIds).toContain(sessionId1);
      expect(activeIds).toContain(sessionId2);
    });

    it('should not include expired sessions', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      // Manually expire the session
      const session = await sessionManager.getSession(sessionId);
      session.expiresAt = Date.now() - 1000;
      await sessionManager.saveSession(session);

      const activeIds = await sessionManager.getActiveSessions();
      expect(activeIds).not.toContain(sessionId);
    });
  });

  describe('getSessionCount', () => {
    it('should return correct count', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      await sessionManager.createSession(files, 'test1');
      await sessionManager.createSession(files, 'test2');
      await sessionManager.createSession(files, 'test3');

      const count = await sessionManager.getSessionCount();
      expect(count).toBe(3);
    });
  });

  describe('extendSession', () => {
    it('should extend session TTL', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId = await sessionManager.createSession(files, 'test');

      const session = await sessionManager.getSession(sessionId);
      const originalExpiry = session.expiresAt;

      // Extend by 2 hours (should be greater than original 1 hour TTL)
      await sessionManager.extendSession(sessionId, 2 * 60 * 60 * 1000);

      const extended = await sessionManager.getSession(sessionId);
      expect(extended.expiresAt).toBeGreaterThan(originalExpiry);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should remove expired sessions', async () => {
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      const sessionId1 = await sessionManager.createSession(files, 'test1');
      const sessionId2 = await sessionManager.createSession(files, 'test2');

      // Expire first session
      const session1 = await sessionManager.getSession(sessionId1);
      session1.expiresAt = Date.now() - 1000;
      await sessionManager.saveSession(session1);

      const cleaned = await sessionManager.cleanupExpiredSessions();
      expect(cleaned).toBe(1);

      expect(sessionManager.sessionExists(sessionId1)).toBe(false);
      expect(sessionManager.sessionExists(sessionId2)).toBe(true);
    });
  });

  describe('startAutoCleanup', () => {
    it('should start cleanup interval', () => {
      expect(() => sessionManager.startAutoCleanup()).not.toThrow();
      sessionManager.stopAutoCleanup();
    });
  });

  describe('stopAutoCleanup', () => {
    it('should stop cleanup interval', () => {
      sessionManager.startAutoCleanup();
      expect(() => sessionManager.stopAutoCleanup()).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should stop cleanup interval', async () => {
      sessionManager.startAutoCleanup();
      await sessionManager.destroy();
      // Should not throw when creating a new session after destroy
      const files: CodeFile[] = [{ path: '/test/file.ts', content: 'test' }];
      await expect(sessionManager.createSession(files, 'test')).resolves.toBeTruthy();
    });
  });
});
