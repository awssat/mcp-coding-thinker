/**
 * Configuration management
 * All hardcoded values now configurable via environment variables
 */

export const config = {
  // Directories
  sessionDir: process.env.MCP_SESSION_DIR || '.mcp-sessions',
  backupDir: process.env.MCP_BACKUP_DIR || '.mcp-backups',

  // Session management
  sessionTTL: parseInt(process.env.MCP_SESSION_TTL || '3600000'), // 1 hour default
  sessionCleanupInterval: parseInt(process.env.MCP_SESSION_CLEANUP || '600000'), // 10 min default

  // Diff limits
  maxDiffSize: parseInt(process.env.MCP_MAX_DIFF_SIZE || '50000'), // 50k default (increased from 10k)
  maxFileSize: parseInt(process.env.MCP_MAX_FILE_SIZE || '1048576'), // 1MB default

  // Fuzzy matching
  fuzzyMatchTolerance: parseInt(process.env.MCP_FUZZY_TOLERANCE || '2'), // ±2 lines
  similarityThreshold: parseFloat(process.env.MCP_SIMILARITY_THRESHOLD || '0.6'), // 60% (lowered from 80%)

  // Lock configuration
  lockRetries: parseInt(process.env.MCP_LOCK_RETRIES || '3'),
  lockStale: parseInt(process.env.MCP_LOCK_STALE || '500'), // 500ms

  // Caching
  sessionCacheSize: parseInt(process.env.MCP_SESSION_CACHE_SIZE || '100'),
  sessionCacheTTL: parseInt(process.env.MCP_SESSION_CACHE_TTL || '60000'), // 1 minute
  diffCacheTTL: parseInt(process.env.MCP_DIFF_CACHE_TTL || '30000'), // 30 seconds

  // Logging
  logLevel: process.env.MCP_LOG_LEVEL || 'info',

  // Confidence scoring (scientific defaults)
  confidence: {
    base: parseInt(process.env.MCP_CONFIDENCE_BASE || '70'),
    max: parseInt(process.env.MCP_CONFIDENCE_MAX || '95'),
    penaltyPerHighIssue: parseInt(process.env.MCP_CONFIDENCE_PENALTY_HIGH || '8'),
    penaltyPerCriticalIssue: parseInt(process.env.MCP_CONFIDENCE_PENALTY_CRITICAL || '15'),
    bonusPerPattern: parseInt(process.env.MCP_CONFIDENCE_BONUS_PATTERN || '2'),
    bonusPerThought: parseInt(process.env.MCP_CONFIDENCE_BONUS_THOUGHT || '2'),
  },

  // Safety scoring
  safety: {
    base: parseInt(process.env.MCP_SAFETY_BASE || '95'),
    min: parseInt(process.env.MCP_SAFETY_MIN || '40'),
    penaltyPerCriticalIssue: parseInt(process.env.MCP_SAFETY_PENALTY_CRITICAL || '25'),
    penaltyPerHighIssue: parseInt(process.env.MCP_SAFETY_PENALTY_HIGH || '10'),
  },
} as const;
