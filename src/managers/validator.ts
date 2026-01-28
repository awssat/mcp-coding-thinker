/**
 * Code validation manager
 * Handles syntax validation, linting, and type checking
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import * as prettier from 'prettier';
import type { Issue, ValidationResult, StyleProfile } from '../types/index.js';
import { normalizeLineEndings } from '../utils/diff.utils.js';

/**
 * Check if ESLint is available in the project
 */
async function hasEslint(): Promise<boolean> {
  try {
    const packageJsonPath = resolve(process.cwd(), 'package.json');
    if (!existsSync(packageJsonPath)) return false;

    // Check if eslint is in dependencies or devDependencies
    const packageJson = JSON.parse(await import('fs').then((fs) => fs.readFileSync(packageJsonPath, 'utf-8')));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    return 'eslint' in deps;
  } catch {
    return false;
  }
}

/**
 * Check if TypeScript is available
 */
async function hasTypeScript(): Promise<boolean> {
  try {
    const packageJsonPath = resolve(process.cwd(), 'package.json');
    if (!existsSync(packageJsonPath)) return false;

    const packageJson = JSON.parse(await import('fs').then((fs) => fs.readFileSync(packageJsonPath, 'utf-8')));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    return 'typescript' in deps;
  } catch {
    return false;
  }
}

/**
 * Check if tsconfig.json exists
 */
function hasTsConfig(): boolean {
  const tsConfigPath = resolve(process.cwd(), 'tsconfig.json');
  return existsSync(tsConfigPath);
}

/**
 * Run ESLint on content
 */
async function runEslint(content: string, filePath: string): Promise<Issue[]> {
  const issues: Issue[] = [];

  try {
    // Create temporary file for ESLint
    const { mkdtemp, writeFile, unlink, rmdir } = await import('fs/promises');
    const { tmpdir } = await import('os');

    const tempDir = await mkdtemp(resolve(tmpdir(), 'eslint-'));
    const tempFilePath = resolve(tempDir, filePath.split('/').pop()!);

    await writeFile(tempFilePath, content, 'utf-8');

    try {
      // Run ESLint with JSON formatter
      const eslintResult = execSync(
        `npx eslint "${tempFilePath}" --format json`,
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }
      );

      const eslintOutput = JSON.parse(eslintResult);

      for (const fileResult of eslintOutput) {
        for (const message of fileResult.messages) {
          issues.push({
            type: message.severity === 2 ? 'error' : 'warning',
            severity: message.severity === 2 ? 'high' : 'medium',
            message: message.message,
            file: filePath,
            line: message.line,
            column: message.column,
            ruleId: message.ruleId,
          });
        }
      }
    } finally {
      // Cleanup temp file
      await unlink(tempFilePath).catch(() => {});
      await rmdir(tempDir).catch(() => {});
    }
  } catch (error) {
    // ESLint not found or failed to run
    // Return empty issues array - don't fail hard
  }

  return issues;
}

/**
 * Run TypeScript compiler on content
 */
async function runTypeScriptCheck(content: string, filePath: string): Promise<Issue[]> {
  const issues: Issue[] = [];

  // Only run for .ts, .tsx files
  if (!/\.(tsx?)$/.test(filePath)) {
    return issues;
  }

  try {
    const { mkdtemp, writeFile, unlink, rmdir } = await import('fs/promises');
    const { tmpdir } = await import('os');

    const tempDir = await mkdtemp(resolve(tmpdir(), 'tsc-'));
    const tempFilePath = resolve(tempDir, filePath.split('/').pop()!);

    await writeFile(tempFilePath, content, 'utf-8');

    try {
      // Run tsc with noEmit to check types
      execSync(`npx tsc --noEmit "${tempFilePath}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (tscError) {
      // Parse TypeScript errors
      const errorOutput = tscError instanceof Error ? tscError.message : String(tscError);
      const lines = errorOutput.split('\n');

      for (const line of lines) {
        // Parse TypeScript error format: file.ts(line,column): error TScode: message
        const match = line.match(/\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)/);
        if (match) {
          issues.push({
            type: 'error',
            severity: 'high',
            message: match[3],
            file: filePath,
            line: parseInt(match[1]),
            column: parseInt(match[2]),
          });
        }
      }
    } finally {
      await unlink(tempFilePath).catch(() => {});
      await rmdir(tempDir).catch(() => {});
    }
  } catch {
    // TypeScript not found or failed to run
  }

  return issues;
}

export class CodeValidator {
  private useEslint: boolean = false;
  private useTypeScript: boolean = false;

  constructor() {
    // Initialize async checks
    this.initializeTools();
  }

  private async initializeTools(): Promise<void> {
    this.useEslint = await hasEslint();
    this.useTypeScript = await hasTypeScript() && hasTsConfig();
  }

  /**
   * Validate syntax using Prettier parser
   */
  async validateSyntax(content: string, filePath: string): Promise<Issue | null> {
    // Normalize line endings first
    content = normalizeLineEndings(content);

    // TypeScript/JavaScript files
    if (/\.(tsx?|jsx?)$/.test(filePath)) {
      try {
        await prettier.format(content, {
          filepath: filePath,
          parser: 'typescript',
        });
        return null;
      } catch (e) {
        return {
          type: 'error',
          severity: 'critical',
          message: `Syntax error: ${e instanceof Error ? e.message : String(e)}`,
          file: filePath,
        };
      }
    }

    // JSON files
    if (/\.json$/.test(filePath)) {
      try {
        JSON.parse(content);
        return null;
      } catch (e) {
        return {
          type: 'error',
          severity: 'critical',
          message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
          file: filePath,
        };
      }
    }

    // CSS/SCSS files
    if (/\.(css|scss|sass)$/.test(filePath)) {
      try {
        await prettier.format(content, {
          filepath: filePath,
          parser: 'css',
        });
        return null;
      } catch (e) {
        return {
          type: 'error',
          severity: 'critical',
          message: `CSS syntax error: ${e instanceof Error ? e.message : String(e)}`,
          file: filePath,
        };
      }
    }

    // HTML files
    if (/\.html?$/.test(filePath)) {
      try {
        await prettier.format(content, {
          filepath: filePath,
          parser: 'html',
        });
        return null;
      } catch (e) {
        return {
          type: 'error',
          severity: 'critical',
          message: `HTML syntax error: ${e instanceof Error ? e.message : String(e)}`,
          file: filePath,
        };
      }
    }

    // Unknown file type - skip syntax validation
    return null;
  }

  /**
   * Format code with Prettier
   */
  async formatCode(content: string, filePath: string, style?: StyleProfile): Promise<string> {
    // Normalize line endings first
    content = normalizeLineEndings(content);

    // Validate syntax before formatting
    const syntaxError = await this.validateSyntax(content, filePath);
    if (syntaxError) {
      throw new Error(syntaxError.message);
    }

    try {
      // Try to load user's prettier config
      const userConfig = await prettier.resolveConfig(filePath);

      const options: prettier.Options = {
        filepath: filePath,
        // Use user config if available, otherwise use detected style
        ...(userConfig || {
          singleQuote: style?.quotes === 'single',
          tabWidth: style?.indentation === 'tabs' ? 2 : parseInt(style?.indentation.replace(' spaces', '') || '2'),
          useTabs: style?.indentation === 'tabs',
          semi: true,
          trailingComma: 'es5',
        }),
      };

      return await prettier.format(content, options);
    } catch (e) {
      throw new Error(`Formatting failed for ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Validate code with full checks
   */
  async validate(content: string, filePath: string): Promise<ValidationResult> {
    const issues: Issue[] = [];

    // Always check syntax first
    const syntaxError = await this.validateSyntax(content, filePath);
    if (syntaxError) {
      issues.push(syntaxError);
      return { valid: false, issues };
    }

    // Run ESLint if available
    if (this.useEslint) {
      const eslintIssues = await runEslint(content, filePath);
      issues.push(...eslintIssues);
    }

    // Run TypeScript check if available
    if (this.useTypeScript) {
      const tsIssues = await runTypeScriptCheck(content, filePath);
      issues.push(...tsIssues);
    }

    const hasErrors = issues.some((i) => i.type === 'error');

    return {
      valid: !hasErrors,
      issues,
    };
  }

  /**
   * Validate and format in one operation
   */
  async validateAndFormat(
    content: string,
    filePath: string,
    style?: StyleProfile
  ): Promise<{ valid: boolean; issues: Issue[]; formatted: string }> {
    const validation = await this.validate(content, filePath);

    let formatted = content;
    try {
      formatted = await this.formatCode(content, filePath, style);
    } catch (formatError) {
      validation.issues.push({
        type: 'error',
        severity: 'critical',
        message: formatError instanceof Error ? formatError.message : String(formatError),
        file: filePath,
      });
      validation.valid = false;
    }

    return {
      valid: validation.valid,
      issues: validation.issues,
      formatted,
    };
  }
}
