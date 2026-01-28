/**
 * Style analysis utilities
 * Detects code style patterns from files
 */

import type { CodeFile, StyleProfile } from '../types/index.js';

/**
 * Analyze code style from files
 */
export function analyzeStyle(files: CodeFile[]): StyleProfile {
  const allContent = files.map((f) => f.content).join('\n');

  // Detect indentation
  const hasSpaces2 = /\n {2}[^\s]/.test(allContent);
  const hasSpaces4 = /\n {4}[^\s]/.test(allContent);
  const hasTabs = /\n\t/.test(allContent);

  // Detect quote style
  const singleQuoteCount = (allContent.match(/'/g) || []).length;
  const doubleQuoteCount = (allContent.match(/"/g) || []).length;

  // Detect component style
  const hasFunctional = /\bconst \w+ = \(.*\) =>/.test(allContent) || /\bfunction \w+\(/.test(allContent);
  const hasClass = /\bclass \w+ extends/.test(allContent);

  // Detect import style
  const hasNamedImports = /import \{/.test(allContent);
  const hasDefaultImports = /import \w+ from/.test(allContent);

  // Detect patterns
  const patterns: string[] = [];
  if (/\buseState|\buseEffect|\buseCallback|\buseMemo/.test(allContent)) {
    patterns.push('React hooks');
  }
  if (/\.(tsx?|jsx?)$/.test(files.map((f) => f.path).join(''))) {
    patterns.push('TypeScript/JSX');
  }
  if (/\bclassName=/.test(allContent)) {
    patterns.push('React');
  }
  if (/\btailwind|className: ["\']/.test(allContent)) {
    patterns.push('Tailwind CSS');
  }
  if (/\basync|\bawait/.test(allContent)) {
    patterns.push('async/await');
  }
  if (/\binterface |\btype \w+ =/.test(allContent)) {
    patterns.push('strong typing');
  }
  if (/\bimport.*\.scss|\.css/.test(allContent)) {
    patterns.push('CSS modules');
  }

  return {
    indentation: hasTabs ? 'tabs' : hasSpaces4 ? '4 spaces' : '2 spaces',
    quotes: singleQuoteCount > doubleQuoteCount ? 'single' : 'double',
    componentStyle: hasClass
      ? hasFunctional
        ? 'mixed'
        : 'class'
      : 'functional',
    importStyle: hasNamedImports && hasDefaultImports ? 'mixed' : hasNamedImports ? 'named' : 'default',
    patterns,
  };
}

/**
 * Detect UI concerns in code
 */
export function detectUIConcerns(files: CodeFile[]): string[] {
  const concerns: string[] = [];
  const allContent = files.map((f) => f.content).join('\n');

  // Color contrast issues
  if (/text-gray-900.*bg-gray-900|text-black.*bg-gray-900/.test(allContent)) {
    concerns.push('Potential color contrast issue: dark text on dark background');
  }
  if (/text-white.*bg-white|text-gray-100.*bg-white/.test(allContent)) {
    concerns.push('Potential color contrast issue: light text on light background');
  }

  // Accessibility issues
  if (/<img(?![^>]*alt=)/.test(allContent)) {
    concerns.push('Images missing alt text for accessibility');
  }
  if (/<button[^>]*>[\s]*<[^>]*>[\s]*<\/button>/.test(allContent)) {
    concerns.push('Buttons with only icons may need aria-label');
  }

  // Responsive design issues
  if (/width:\s*\d+px/.test(allContent) && !/max-width|min-width/.test(allContent)) {
    concerns.push('Fixed pixel widths detected - consider responsive units');
  }

  return concerns;
}
