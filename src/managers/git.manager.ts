/**
 * Git operations manager
 * Handles all git operations safely using simple-git
 */

import { simpleGit, SimpleGit, ResetMode } from 'simple-git';
import { existsSync } from 'fs';
import { join } from 'path';
import type { GitStatus, GitCommitResult } from '../types/index.js';
import { GitOperationError } from '../types/index.js';

export class GitManager {
  private git: SimpleGit;
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.git = simpleGit({ baseDir });
  }

  /**
   * Check if current directory is a git repository
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.checkIsRepo();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get comprehensive git status
   */
  async getStatus(): Promise<GitStatus> {
    const isRepo = await this.isGitRepo();

    if (!isRepo) {
      return {
        isRepo: false,
        isDirty: false,
        canCommit: false,
        reason: 'Not a git repository',
        state: 'normal',
        files: [],
      };
    }

    try {
      const status = await this.git.status();

      // Check for detached HEAD
      if (status.detached) {
        return {
          isRepo: true,
          isDirty: status.files.length > 0,
          currentBranch: status.current || undefined,
          canCommit: false,
          reason: 'Detached HEAD state',
          state: 'detached',
          files: status.files,
        };
      }

      // Check for rebase/merge in progress
      const gitDir = await this.git.revparse('--git-dir');
      const gitDirPath = join(this.baseDir, gitDir.trim());

      if (existsSync(join(gitDirPath, 'rebase-merge')) || existsSync(join(gitDirPath, 'rebase-apply'))) {
        return {
          isRepo: true,
          isDirty: status.files.length > 0,
          currentBranch: status.current || undefined,
          canCommit: false,
          reason: 'Rebase in progress',
          state: 'rebase',
          files: status.files,
        };
      }

      if (existsSync(join(gitDirPath, 'MERGE_HEAD'))) {
        return {
          isRepo: true,
          isDirty: status.files.length > 0,
          currentBranch: status.current || undefined,
          canCommit: false,
          reason: 'Merge in progress',
          state: 'merge',
          files: status.files,
        };
      }

      // Check for conflicts
      if (status.conflicted.length > 0) {
        return {
          isRepo: true,
          isDirty: true,
          currentBranch: status.current || undefined,
          canCommit: false,
          reason: `Merge conflicts in ${status.conflicted.length} file(s)`,
          state: 'conflict',
          files: status.files,
        };
      }

      return {
        isRepo: true,
        isDirty: status.files.length > 0,
        currentBranch: status.current || undefined,
        canCommit: true,
        state: 'normal',
        files: status.files,
      };
    } catch (error) {
      throw new GitOperationError(
        'status',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Check if specific file has uncommitted changes
   */
  async isFileDirty(filePath: string): Promise<boolean> {
    try {
      const isRepo = await this.isGitRepo();
      if (!isRepo) return false;

      const status = await this.git.status();
      return status.files.some((f) => f.path === filePath);
    } catch {
      return false;
    }
  }

  /**
   * Stage files for commit
   */
  async stageFiles(filePaths: string[]): Promise<void> {
    try {
      await this.git.add(filePaths);
    } catch (error) {
      throw new GitOperationError(
        'add',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Create a commit with message
   */
  async commit(message: string, allowEmpty: boolean = false): Promise<GitCommitResult> {
    try {
      const commitResult = allowEmpty
        ? await this.git.commit(message, [], { '--allow-empty': null as any })
        : await this.git.commit(message);

      return {
        success: true,
        commitHash: commitResult.commit,
        message: `Committed: ${commitResult.commit}`,
        needsManualAction: false,
      };
    } catch (error) {
      // Check if it's a pre-commit hook failure
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('pre-commit hook') || errorMessage.includes('hook')) {
        return {
          success: false,
          message: 'Files staged but commit failed due to pre-commit hook',
          needsManualAction: true,
        };
      }

      throw new GitOperationError('commit', errorMessage);
    }
  }

  /**
   * Get the latest commit hash
   */
  async getLatestCommit(): Promise<string | null> {
    try {
      const log = await this.git.log({ maxCount: 1 });
      return log.latest?.hash || null;
    } catch {
      return null;
    }
  }

  /**
   * Stage and commit in one operation
   */
  async stageAndCommit(
    filePaths: string[],
    message: string
  ): Promise<GitCommitResult> {
    await this.stageFiles(filePaths);
    return await this.commit(message);
  }

  /**
   * Revert the last commit
   */
  async revertLastCommit(): Promise<GitCommitResult> {
    try {
      const latestCommit = await this.getLatestCommit();
      if (!latestCommit) {
        throw new GitOperationError('revert', 'No commits to revert');
      }

      await this.git.reset(['--hard', 'HEAD~1']);

      return {
        success: true,
        commitHash: latestCommit,
        message: `Reverted commit ${latestCommit}`,
        needsManualAction: false,
      };
    } catch (error) {
      throw new GitOperationError(
        'revert',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Unstage files (reset)
   */
  async unstageFiles(filePaths?: string[]): Promise<void> {
    try {
      if (filePaths && filePaths.length > 0) {
        await this.git.reset(ResetMode.MIXED, filePaths);
      } else {
        await this.git.reset(ResetMode.MIXED);
      }
    } catch (error) {
      throw new GitOperationError(
        'reset',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string | null> {
    try {
      const status = await this.git.status();
      return status.current || null;
    } catch {
      return null;
    }
  }

  /**
   * Get list of changed files
   */
  async getChangedFiles(): Promise<string[]> {
    try {
      const status = await this.git.status();
      return status.files.map((f) => f.path);
    } catch {
      return [];
    }
  }

  /**
   * Check if file exists in git
   */
  async fileExistsInGit(filePath: string): Promise<boolean> {
    try {
      await this.git.catFile(['-e', `HEAD:${filePath}`]);
      return true;
    } catch {
      return false;
    }
  }
}
