# Coding Thinker MCP

> **AI Code Surgeon: Think → Edit → Verify → Commit**  
> The only MCP that combines reasoning, surgical diffs, syntax validation, and git commits in one workflow.

[![npm version](https://badge.fury.io/js/mcp-coding-thinker.svg)](https://www.npmjs.com/package/mcp-coding-thinker)
[![MCP Badge](https://lobehub.com/badge/mcp/awssat-mcp-coding-thinker)](https://lobehub.com/mcp/awssat-mcp-coding-thinker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🎯 What This Does

Traditional AI code editing: Copy → Paste → Format → Lint → Git commit → 10 minutes wasted.

**mcp-coding-thinker**: `"Fix dark mode"` → 90 seconds → ✅ Committed with perfect style.

### The Magic Workflow
1. **Analyze:** Learns your code style (quotes, indentation, patterns)
2. **Think:** Records reasoning steps for transparency
3. **Plan:** Creates surgical line-by-line diffs with fuzzy matching
4. **Verify:** Validates syntax, checks for conflicts, generates lintable preview
5. **Execute:** Applies changes, auto-formats with Prettier, backs up originals, commits to git

### Why It's Different
Most AI code tools either just suggest changes OR execute them. This does both **with full reasoning transparency**:

- **Code-aware thinking:** Records WHY each change is made, not just WHAT
- **Surgical precision:** Line-by-line diffs with overlap handling, not full-file replacements
- **Zero manual work:** Auto-formats + syntax checks + git commits in one flow
- **Always safe:** Backups every file, validates before writing, handles git edge cases
- **Style-aware:** Learns your existing code patterns and enforces them automatically

---

## 🚀 Installation

### Claude Desktop (One Command)
```bash
claude mcp add coding-thinker -- npx -y mcp-coding-thinker
```

### Google Gemini (One Command)
```bash
gemini mcp add coding-thinker npx -y mcp-coding-thinker
```

---

## 🔧 Manual Setup for Claude Desktop

### macOS
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "coding-thinker": {
      "command": "npx",
      "args": ["-y", "mcp-coding-thinker"]
    }
  }
}
```

### Windows
Edit `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "coding-thinker": {
      "command": "npx",
      "args": ["-y", "mcp-coding-thinker"]
    }
  }
}
```

### Linux
Edit `~/.config/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "coding-thinker": {
      "command": "npx",
      "args": ["-y", "mcp-coding-thinker"]
    }
  }
}
```

**Restart Claude Desktop** after saving.

---

## 🔧 Manual Setup for Google Gemini

### For Google AI Studio Desktop (if supported)

Create/edit MCP config file (location varies by OS):
- **macOS/Linux:** `~/.config/gemini/mcp_config.json`
- **Windows:** `%APPDATA%\Gemini\mcp_config.json`

```json
{
  "mcpServers": {
    "coding-thinker": {
      "command": "npx",
      "args": ["-y", "mcp-coding-thinker"]
    }
  }
}
```

---

## 🔧 Using with Any MCP-Compatible Client

```bash
# Start the server with npx
npx -y mcp-coding-thinker

# Or test with MCP Inspector
npx @modelcontextprotocol/inspector npx -y mcp-coding-thinker
```

---

## 📖 Usage Example

**Prompt to AI (Claude/Gemini):**
```
Use coding-thinker to fix the dark mode color contrast in Header.tsx
```

**What Happens:**
1. Analyzes `Header.tsx` → Detects React + Tailwind + 2-space indent
2. Records thoughts: "Dark text on dark bg detected at line 42"
3. Creates diff: Change `text-gray-900` → `text-gray-100`
4. Validates syntax ✅
5. Formats with Prettier ✅
6. Backs up to `.mcp-backups/` ✅
7. Commits: `"mcp-coding-thinker: Fix dark mode contrast"` ✅

**Result:** Production-ready commit in 90 seconds.

---

## 🛠️ How It Works

### 4 Tools

#### 1. `analyze_context`
- **Input:** Files + request
- **Output:** Session ID, style profile, issues, research queries
- **Use:** Always call first

#### 2. `think_aloud`
- **Input:** Session ID + reasoning step
- **Output:** Recorded thought + depth score
- **Use:** Show incremental reasoning (5+ steps = excellent quality)

#### 3. `plan_and_verify`
- **Input:** Session ID + diffs (line-by-line changes)
- **Output:** Validation results, safety score, lintable preview
- **Use:** Submit exact diffs for verification

#### 4. `execute_and_review`
- **Input:** Session ID + approval
- **Output:** Execution status, git operations, mirror critique prompt
- **Use:** Apply changes with full safety net

---

## 🔒 Safety Features

### Git Protection
- ✅ Detects detached HEAD, rebase/merge in progress
- ✅ Handles pre-commit hook failures gracefully
- ✅ Provides revert instructions: `git revert HEAD`

### Backup System
- ✅ Copies originals to `.mcp-backups/{session-id}/`
- ✅ Preserves directory structure
- ✅ 1-hour session TTL (auto-cleanup)

### Validation
- ✅ Syntax check before formatting (no silent fails)
- ✅ Fuzzy diff matching (±2 lines tolerance)
- ✅ Overlapping diff detection with unified patching
- ✅ 80% similarity threshold for stale diffs
- ✅ Size limits on diffs (prevents memory issues)
- ✅ Cross-platform line ending normalization (CRLF/LF)
- ✅ Prettier config detection from user's repo

---

## 🎓 Best Practices

### For AI Models (Claude/Gemini)
1. **Always analyze first:** Call `analyze_context` before planning
2. **Think deeply:** 5+ `think_aloud` calls = 95%+ confidence
3. **Exact diffs:** Provide real line numbers from original files
4. **Dry run first:** Use `dry_run=true` to preview before executing

### For Users
- Commit changes before using (or work on feature branch)
- Review mirror critique prompt for architectural insights
- Use research queries to verify best practices
- Check `.mcp-backups/` if rollback needed

---

## 🔧 Development

```bash
git clone https://github.com/awssat/mcp-coding-thinker.git
cd mcp-coding-thinker
npm install
npm run build

# Test with MCP Inspector
npm run inspector
```

---

## 🤝 Contributing

PRs welcome! Priority areas:
- Additional language support
- Test coverage
- Performance optimizations

---

## 📜 License

MIT © 2026

