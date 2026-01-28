/**
 * Session manager with file locking and LRU cache (OPTIMIZED v2.0)
 * Handles session lifecycle, persistence, and cleanup
 * Performance: Added LRU cache to avoid repeated disk I/O
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { promises as fs } from 'fs';
import { resolve, join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { lock } from 'proper-lockfile';
import { LRUCache } from 'lru-cache';
import type { SessionState, CodeFile, Diff } from '../types/index.js';
import { SessionNotFoundError, SessionExpiredError, ConcurrencyError } from '../types/index.js';
import { config } from '../config/index.js';

const SESSION_TTL = config.sessionTTL;
const SESSION_CLEANUP_INTERVAL = config.sessionCleanupInterval;
const LOCK_RETRIES = config.lockRetries;
const LOCK_STALE = config.lockStale;

export interface SessionManagerOptions {
  disableLocking?: boolean; // For testing purposes
}

export class SessionManager {
  private sessionDir: string;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private options: SessionManagerOptions;
  private cache: LRUCache<string, SessionState>;

  constructor(sessionDir: string = '.mcp-sessions', options: SessionManagerOptions = {}) {
    this.sessionDir = resolve(sessionDir);
    this.options = options;

    // Initialize LRU cache for performance
    this.cache = new LRUCache<string, SessionState>({
      max: config.sessionCacheSize,
      ttl: config.sessionCacheTTL,
      updateAgeOnGet: true, // Extend TTL on access
    });

    this.ensureSessionDir();
  }

  /**
   * Ensure session directory exists
   */
  private ensureSessionDir(): void {
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  /**
   * Get session file path
   */
  private getSessionPath(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.json`);
  }

  /**
   * Create a new session
   */
  async createSession(files: CodeFile[], request: string): Promise<string> {
    const id = randomUUID();
    const now = Date.now();

    const session: SessionState = {
      id,
      files,
      request,
      issues: [],
      thoughts: [],
      diffs: [],
      createdAt: now,
      expiresAt: now + SESSION_TTL,
    };

    await this.saveSession(session);
    return id;
  }

  /**
   * Get session by ID (with caching)
   */
  async getSession(id: string): Promise<SessionState> {
    // Check cache first (performance optimization)
    const cached = this.cache.get(id);
    if (cached) {
      // Verify session hasn't expired
      if (Date.now() <= cached.expiresAt) {
        return cached;
      }
      // Session expired, remove from cache
      this.cache.delete(id);
    }

    const sessionPath = this.getSessionPath(id);

    if (!existsSync(sessionPath)) {
      throw new SessionNotFoundError(id);
    }

    // Acquire lock for reading
    const release = await this.acquireLock(sessionPath);
    try {
      const content = readFileSync(sessionPath, 'utf-8');
      const session = JSON.parse(content) as SessionState;

      // Check if session expired
      if (Date.now() > session.expiresAt) {
        // Release lock before deleting
        await release();
        // Delete without acquiring lock again (we already have it)
        try {
          unlinkSync(sessionPath);
        } catch {
          // Ignore errors
        }
        throw new SessionExpiredError(id);
      }

      // Cache the session
      this.cache.set(id, session);

      return session;
    } finally {
      await release();
    }
  }

  /**
   * Save session with file locking (and cache update)
   */
  async saveSession(session: SessionState): Promise<void> {
    const sessionPath = this.getSessionPath(session.id);

    // Acquire lock for writing
    const release = await this.acquireLock(sessionPath);
    try {
      writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');

      // Update cache
      this.cache.set(session.id, session);
    } finally {
      await release();
    }
  }

  /**
   * Update session (partial update)
   */
  async updateSession(
    id: string,
    updates: Partial<Omit<SessionState, 'id' | 'createdAt' | 'files' | 'request'>>
  ): Promise<void> {
    const session = await this.getSession(id);
    Object.assign(session, updates);
    await this.saveSession(session);
  }

  /**
   * Add thought to session
   */
  async addThought(sessionId: string, thought: string, step: number): Promise<void> {
    const session = await this.getSession(sessionId);
    session.thoughts.push(`[Step ${step}] ${thought}`);
    await this.saveSession(session);
  }

  /**
   * Add diffs to session
   */
  async addDiffs(sessionId: string, diffs: Diff[]): Promise<void> {
    const session = await this.getSession(sessionId);
    session.diffs = diffs;
    await this.saveSession(session);
  }

  /**
   * Delete session (and remove from cache)
   */
  async deleteSession(id: string): Promise<void> {
    const sessionPath = this.getSessionPath(id);

    // Acquire lock before deleting
    const release = await this.acquireLock(sessionPath);
    try {
      if (existsSync(sessionPath)) {
        unlinkSync(sessionPath);
      }

      // Remove from cache
      this.cache.delete(id);
    } finally {
      await release();
    }
  }

  /**
   * Check if session exists
   */
  sessionExists(id: string): boolean {
    return existsSync(this.getSessionPath(id));
  }

  /**
   * Acquire lock on session file
   */
  private async acquireLock(filePath: string): Promise<() => Promise<void>> {
    // If locking is disabled (for testing), return a no-op release function
    if (this.options.disableLocking) {
      return async () => {
        // No-op
      };
    }

    try {
      const release = await lock(filePath, {
        retries: LOCK_RETRIES,
        stale: LOCK_STALE,
      });

      return async () => {
        try {
          await release();
        } catch {
          // Ignore unlock errors
        }
      };
    } catch (error) {
      throw new ConcurrencyError(filePath);
    }
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const now = Date.now();
    let cleanedCount = 0;

    try {
      const files = readdirSync(this.sessionDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const sessionPath = join(this.sessionDir, file);

        try {
          const release = await this.acquireLock(sessionPath);

          try {
            const content = readFileSync(sessionPath, 'utf-8');
            const session = JSON.parse(content) as SessionState;

            if (now > session.expiresAt) {
              unlinkSync(sessionPath);
              cleanedCount++;
            }
          } catch (parseError) {
            // Invalid session file, delete it
            unlinkSync(sessionPath);
            cleanedCount++;
          } finally {
            await release();
          }
        } catch (lockError) {
          // Skip if can't acquire lock (file in use)
          continue;
        }
      }
    } catch (error) {
      // Directory doesn't exist or empty
      return 0;
    }

    return cleanedCount;
  }

  /**
   * Start automatic cleanup interval
   */
  startAutoCleanup(): void {
    if (this.cleanupInterval) {
      return; // Already running
    }

    this.cleanupInterval = setInterval(async () => {
      await this.cleanupExpiredSessions();
    }, SESSION_CLEANUP_INTERVAL);
  }

  /**
   * Stop automatic cleanup interval
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get all active session IDs
   */
  async getActiveSessions(): Promise<string[]> {
    const now = Date.now();
    const activeIds: string[] = [];

    try {
      const files = readdirSync(this.sessionDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const sessionPath = join(this.sessionDir, file);

        try {
          const content = readFileSync(sessionPath, 'utf-8');
          const session = JSON.parse(content) as SessionState;

          if (now <= session.expiresAt) {
            activeIds.push(session.id);
          }
        } catch {
          // Skip invalid files
          continue;
        }
      }
    } catch {
      // Directory doesn't exist
      return [];
    }

    return activeIds;
  }

  /**
   * Get session count
   */
  async getSessionCount(): Promise<number> {
    const activeSessions = await this.getActiveSessions();
    return activeSessions.length;
  }

  /**
   * Extend session TTL
   */
  async extendSession(id: string, additionalMs: number = SESSION_TTL): Promise<void> {
    const session = await this.getSession(id);
    session.expiresAt = Date.now() + additionalMs;
    await this.saveSession(session);
  }

  /**
   * Cleanup and destroy session manager
   */
  async destroy(): Promise<void> {
    this.stopAutoCleanup();
    // Note: We don't delete session files here as they may be needed later
  }
}

/**
 * Helper function to unlock a file
 */
async function unlock(filePath: string, release: () => Promise<void>): Promise<void> {
  try {
    await release();
  } catch {
    // Ignore unlock errors
  }
}
