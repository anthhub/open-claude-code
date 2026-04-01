# Demo: mini-claude Build Guide

> Build chapter by chapter — end up with an AI coding assistant matching Claude Code's architecture

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=anthhub/learn-claude-code)

## Final Goal

```
demo/
├── main.ts                    # CLI entry (Commander.js)
├── context.ts                 # System prompt builder
├── query.ts                   # Query loop (streaming + tool use)
├── Tool.ts                    # Tool interface & factory
├── tools.ts                   # Tool registry
├── types/                     # Type system ← Chapter 1
├── tools/                     # Tool implementations
├── services/
│   ├── api/claude.ts          # Anthropic SDK wrapper
│   └── compact/compact.ts     # Context compression
├── screens/REPL.tsx           # Terminal UI (Ink)
├── components/                # UI components
├── commands/                  # Slash commands
└── utils/                     # Utilities
```

## Chapter-by-Chapter Progress

| Ch | New Modules | Capability After | Status |
|----|------------|-----------------|--------|
| 1 | `types/` type system | Type definitions compile | ✅ |
| 2 | `Tool.ts` + `tools.ts` | Tool interface & registry | 🚧 |
| 3 | `services/api/` + `context.ts` | Streaming API calls | 🚧 |
| 4 | `query.ts` + `utils/messages.ts` | Multi-turn tool use loop | 🚧 |
| 5 | BashTool, FileReadTool, GrepTool | Execute commands, read files, search | 🚧 |
| 6 | FileWriteTool, FileEditTool, GlobTool | Full file operations | 🚧 |
| 7 | `utils/permissions.ts` | Dangerous command blocking | 🚧 |
| 8 | `screens/REPL.tsx` + `components/` | Interactive terminal UI | 🚧 |
| 9 | `main.ts` (Commander.js) | Full CLI argument support | 🚧 |
| 10 | `commands/` + compact service | /help, /clear, /compact | 🚧 |
| 11 | `components/PermissionRequest.tsx` | Interactive permission prompts | 🚧 |
| 12 | History, retry, error handling | Production-ready | 🚧 |

## Run the Demo

```bash
cd demo
bun install
bun run main.ts

# Type check
bun run typecheck
```
