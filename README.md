<div align="center">

# Open Claude Code

### Build a Claude Code Clone from Scratch — in 12 Chapters

> The only tutorial that reverse-engineers Claude Code's real 512K+ line source code into a working AI coding assistant you build yourself.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=anthhub/open-claude-code)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-latest-orange?logo=bun)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/Docs-GitHub%20Pages-blue)](https://anthhub.github.io/open-claude-code/)

[中文](README.zh-CN.md) · [Documentation](https://anthhub.github.io/open-claude-code/) · [Codespaces](https://github.com/codespaces/new?repo=anthhub/open-claude-code)

</div>

---

## Why This Project?

Most Claude Code tutorials teach you **how to use** it. This one teaches you **how to build** it.

We took the real Claude Code source snapshot (~1,900 files, 512K+ lines of TypeScript), reverse-engineered its architecture, and turned it into a 12-chapter progressive tutorial. By the end, you'll have `mini-claude` — a working AI coding assistant with:

- **Agentic Loop** — AI autonomously calls tools and reasons in a loop
- **7 Built-in Tools** — Read, Write, Edit, Bash, Grep, Glob, Echo
- **Streaming API** — Real-time token-by-token output via Anthropic SDK
- **Permission System** — Dangerous command blocking & approval flow
- **Interactive Terminal UI** — React + Ink REPL, just like the real thing
- **CLI with Commander.js** — `--model`, `--prompt`, `--print`
- **Slash Commands** — `/help`, `/clear`, `/compact`
- **Session History** — Persistent conversations across runs
- **Retry & Error Handling** — Exponential backoff, production-grade resilience

Every feature maps 1:1 to real Claude Code architecture. No hand-waving, no toy examples.

---

## How It's Different

| | Other Tutorials | Open Claude Code |
|---|---|---|
| **Approach** | "Here's how to use Claude Code" | "Here's how to **BUILD** Claude Code" |
| **Source** | Generic AI agent concepts | Real 512K+ line source code analysis |
| **Output** | Knowledge | A working AI coding assistant |
| **Learning** | Read docs passively | Build chapter by chapter |
| **Environment** | Static markdown | Codespaces + Jupyter + VitePress |

---

## Quick Start

### Option 1: One-Click Cloud Environment

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=anthhub/open-claude-code)

Zero setup. Start building in your browser.

### Option 2: Local Setup

```bash
git clone https://github.com/anthhub/open-claude-code.git
cd open-claude-code/demo
bun install
bun run demo                              # Script-mode verification
ANTHROPIC_API_KEY=sk-xxx bun run start    # Interactive REPL
```

Then open [Chapter 1](docs/en/01-overview.md) and start building.

---

## 12-Chapter Learning Roadmap

| # | Chapter | Difficulty | Key Concepts | Status |
|---|---------|------------|--------------|--------|
| 1 | [Project Overview & Architecture](docs/en/01-overview.md) | Beginner | Architecture, modules, tech stack | ✅ |
| 2 | [CLI Entrypoint & Startup](docs/en/02-cli-entrypoint.md) | Beginner | Commander.js, startup optimization, parallel prefetch | ✅ |
| 3 | [Tool System](docs/en/03-tool-system.md) | Intermediate | Tool interface, registration, execution flow | ✅ |
| 4 | [Command System](docs/en/04-command-system.md) | Intermediate | Slash commands, registration, conditional loading | ✅ |
| 5 | [Terminal UI with Ink](docs/en/05-ink-rendering.md) | Intermediate | React/Ink, layout engine, DOM model | ✅ |
| 6 | [Service Layer & API Communication](docs/en/06-service-layer.md) | Intermediate | API client, streaming, token tracking | ✅ |
| 7 | [Permission System](docs/en/07-permission-system.md) | Intermediate | Permission modes, approval flow, security | ✅ |
| 8 | [MCP Integration](docs/en/08-mcp-integration.md) | Advanced | MCP protocol, server management, tool bridging | ✅ |
| 9 | [Agent & Multi-Agent Coordination](docs/en/09-agent-coordination.md) | Advanced | Sub-agents, teams, coordinator, swarm | ✅ |
| 10 | [Plugin & Skill System](docs/en/10-plugin-skill-system.md) | Advanced | Plugin loading, skill definition, extensibility | ✅ |
| 11 | [State Management & Context](docs/en/11-state-context.md) | Advanced | State store, context compression, memory | ✅ |
| 12 | [Advanced Features](docs/en/12-advanced-features.md) | Expert | Sandbox, voice, bridge/IDE, remote execution | ✅ |

### Key Milestones

| After Chapter | What You Can Do |
|---------------|----------------|
| **Chapter 2** | Tools execute shell commands and read files |
| **Chapter 4** | Complete Agentic Loop — AI automatically calls tools and reasons in a loop |
| **Chapter 8** | Interactive terminal UI, experience close to real Claude Code |
| **Chapter 12** | Fully functional AI coding assistant |

---

## Chapter Details

### Foundation (Chapters 1-2)

- **[01 - Project Overview & Architecture](docs/en/01-overview.md)**
  Understand the high-level structure, module boundaries, and technology choices. Learn how ~1,900 files are organized into a coherent system.

- **[02 - CLI Entrypoint & Startup](docs/en/02-cli-entrypoint.md)**
  Trace execution from the `claude` command to the first rendered frame. Understand Commander.js integration and parallel prefetch optimizations.

### Core Systems (Chapters 3-7)

- **[03 - Tool System](docs/en/03-tool-system.md)**
  Every capability Claude Code has is a "tool." Learn the tool interface, how tools register themselves, and how the execution pipeline handles calls, errors, and results.

- **[04 - Command System](docs/en/04-command-system.md)**
  Slash commands (`/help`, `/clear`, `/mcp`) are the user-facing control plane. Learn registration, conditional loading, and how commands differ from tools.

- **[05 - Terminal UI with Ink](docs/en/05-ink-rendering.md)**
  React for the terminal — a surprisingly powerful paradigm. Learn how Ink's DOM model, layout engine, and reconciler enable a responsive TUI.

- **[06 - Service Layer & API Communication](docs/en/06-service-layer.md)**
  The bridge between Claude Code and the Anthropic API. Streaming responses, token tracking, retry logic, and cost accounting.

- **[07 - Permission System](docs/en/07-permission-system.md)**
  Security without friction. Learn the permission modes (auto, ask, manual), the approval flow, and how dangerous operations are gated.

### Advanced Systems (Chapters 8-12)

- **[08 - MCP Integration](docs/en/08-mcp-integration.md)**
  Model Context Protocol turns external servers into tool providers. Learn how Claude Code discovers, connects, and bridges MCP servers.

- **[09 - Agent & Multi-Agent Coordination](docs/en/09-agent-coordination.md)**
  Claude Code can spawn and coordinate sub-agents. Learn the coordinator pattern, agent teams, task delegation, and the swarm architecture.

- **[10 - Plugin & Skill System](docs/en/10-plugin-skill-system.md)**
  Extensibility without forking. How plugins are loaded, how skills are defined, and how the system resolves conflicts.

- **[11 - State Management & Context](docs/en/11-state-context.md)**
  Long conversations require smart state. Learn the store design, context compression strategies, and the persistent memory system.

- **[12 - Advanced Features](docs/en/12-advanced-features.md)**
  The frontier: sandboxed execution, voice input, IDE bridge protocol, and remote agent execution.

---

## What You Build Each Chapter

| Ch | Module Added | Demo Capability After |
|----|-------------|----------------------|
| 1 | Project scaffold + type system | Type definitions compile |
| 2 | Tool.ts + tools.ts | Tool interface & registry |
| 3 | services/api/ + context.ts | Streaming API calls |
| 4 | query.ts + utils/messages.ts | Multi-turn tool-calling loop |
| 5 | tools/BashTool, FileReadTool, GrepTool | Execute commands, read files, search |
| 6 | tools/FileWriteTool, FileEditTool, GlobTool | Full file operations |
| 7 | utils/permissions.ts | Dangerous command blocking |
| 8 | screens/REPL.tsx + components/ | Interactive terminal UI |
| 9 | main.ts (Commander.js) | Full CLI with args |
| 10 | commands/ + compact service | /help, /clear, /compact |
| 11 | components/PermissionRequest.tsx | Interactive permission dialogs |
| 12 | History, retry, error handling | Production-ready demo |

---

## Demo: Final Architecture

```
demo/
├── main.ts                    # CLI entry (Commander.js)
├── context.ts                 # System prompt builder
├── query.ts                   # Query loop (stream + tool calls)
├── Tool.ts                    # Tool interface & factory
├── tools.ts                   # Tool registry
├── types/
│   ├── message.ts             # Message types
│   └── permissions.ts         # Permission types
├── tools/
│   ├── BashTool/
│   ├── FileReadTool/
│   ├── FileWriteTool/
│   ├── FileEditTool/
│   ├── GrepTool/
│   ├── GlobTool/
│   └── TodoWriteTool/
├── services/
│   ├── api/claude.ts          # Anthropic SDK wrapper
│   └── compact/compact.ts     # Context compression
├── screens/REPL.tsx           # Terminal UI (Ink)
├── components/
│   ├── App.tsx
│   ├── MessageList.tsx
│   └── PermissionRequest.tsx
├── commands/
│   ├── clear.ts
│   ├── help.ts
│   └── compact.ts
└── utils/
    ├── permissions.ts
    ├── messages.ts
    ├── format.ts
    └── config.ts
```

### Architecture Correspondence

| Demo File | Real Claude Code Equivalent |
|-----------|----------------------------|
| `Tool.ts` | `src/Tool.ts` |
| `tools.ts` | `src/tools/index.ts` |
| `query.ts` | `src/query.ts` |
| `context.ts` | `src/context.ts` |
| `services/api/claude.ts` | `src/services/claude.ts` |
| `screens/REPL.tsx` | `src/screens/REPL.tsx` |
| `utils/permissions.ts` | `src/utils/permissions.ts` |

---

## Project Structure

```
open-claude-code/
├── README.md               # This file
├── README.zh-CN.md         # Chinese version
├── ROADMAP.md              # Visual learning roadmap
├── LICENSE
├── package.json
├── tsconfig.json
├── docs/
│   ├── en/                 # English chapter docs
│   └── zh-CN/              # Chinese chapter docs
├── examples/               # Runnable examples per chapter
├── demo/                   # mini-claude: the progressive demo you build
└── diagrams/               # Architecture diagrams
```

---

## Prerequisites

- **Node.js 18+** — `node --version`
- **Bun** — [bun.sh](https://bun.sh) (used to run TypeScript examples directly)
- **TypeScript knowledge** — comfortable reading typed code; generics and decorators appear often
- **Basic terminal/CLI familiarity** — you'll be reading a CLI app's source

No prior knowledge of Claude or Anthropic's APIs is required — we explain everything from first principles.

---

## Contributing

Contributions welcome! Ways to help:

- Fix errors or improve explanations in the docs
- Add or improve runnable examples
- Translate chapters to additional languages
- Add diagrams for complex flows

Please open an issue before submitting large changes.

---

## Acknowledgments

Source code snapshot from the [anthhub/claude-code](https://github.com/anthhub/claude-code) repository. This project is an independent educational resource and is not affiliated with Anthropic.

---

## License

MIT — see [LICENSE](./LICENSE)
