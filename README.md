# Learn Claude Code

> A hands-on guide to understanding Claude Code's architecture and implementation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-latest-orange.svg)](https://bun.sh/)

[中文版](README.zh-CN.md)

---

## What is this?

**Learn Claude Code** is a progressive, example-driven study of the Claude Code source snapshot (~1,900 files, 512K+ lines of TypeScript). Rather than just reading documentation, you'll navigate real production code — a sophisticated AI coding assistant — and understand the architectural decisions, patterns, and tradeoffs that make it work.

Claude Code is more than a chatbot wrapper. It's a full-featured terminal application combining:
- A streaming LLM API client
- A terminal UI built with React/Ink
- A dynamic tool and plugin system
- A multi-agent coordination framework
- A permission and security model
- MCP (Model Context Protocol) integration

Understanding its source is a masterclass in building production-grade AI applications.

**Build as you learn.** This isn't just documentation — it's a progressive tutorial. Starting from Chapter 1, you'll build `mini-claude`, a working clone of Claude Code. Each chapter adds a new module to the demo. By Chapter 12, you'll have a fully functional AI coding assistant with tools, permissions, terminal UI, and more.

---

## Learning Roadmap

| # | Chapter | Difficulty | Key Concepts |
|---|---------|------------|--------------|
| 1 | [Project Overview & Architecture](docs/en/01-overview.md) | Beginner | Architecture, modules, tech stack |
| 2 | [CLI Entrypoint & Startup](docs/en/02-cli-entrypoint.md) | Beginner | Commander.js, startup optimization, parallel prefetch |
| 3 | [Tool System](docs/en/03-tool-system.md) | Intermediate | Tool interface, registration, execution flow |
| 4 | [Command System](docs/en/04-command-system.md) | Intermediate | Slash commands, registration, conditional loading |
| 5 | [Terminal UI with Ink](docs/en/05-ink-rendering.md) | Intermediate | React/Ink, layout engine, DOM model |
| 6 | [Service Layer & API Communication](docs/en/06-service-layer.md) | Intermediate | API client, streaming, token tracking |
| 7 | [Permission System](docs/en/07-permission-system.md) | Intermediate | Permission modes, approval flow, security |
| 8 | [MCP Integration](docs/en/08-mcp-integration.md) | Advanced | MCP protocol, server management, tool bridging |
| 9 | [Agent & Multi-Agent Coordination](docs/en/09-agent-coordination.md) | Advanced | Sub-agents, teams, coordinator, swarm |
| 10 | [Plugin & Skill System](docs/en/10-plugin-skill-system.md) | Advanced | Plugin loading, skill definition, extensibility |
| 11 | [State Management & Context](docs/en/11-state-context.md) | Advanced | State store, context compression, memory |
| 12 | [Advanced Features](docs/en/12-advanced-features.md) | Expert | Sandbox, voice, bridge/IDE, remote execution |

---

## The Demo: mini-claude

As you read each chapter, you'll build `mini-claude` — a working AI coding assistant that mirrors Claude Code's real architecture. The demo lives in the `demo/` directory and grows chapter by chapter.

### Final Architecture

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

### What You Build Each Chapter

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

### Key Milestones

- **After Chapter 2**: Tools can actually execute shell commands and read files
- **After Chapter 4**: Complete Agentic Loop — AI automatically calls tools and reasons in a loop
- **After Chapter 8**: Interactive terminal UI, experience close to real Claude Code
- **After Chapter 12**: Fully functional AI coding assistant

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

## Chapters

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

## Project Structure

```
learn-claude-code/
├── README.md               # This file
├── README.zh-CN.md         # Chinese version
├── ROADMAP.md              # Visual learning roadmap
├── LICENSE
├── package.json
├── tsconfig.json
├── docs/
│   ├── en/                 # English chapter docs
│   │   ├── 01-overview.md
│   │   ├── 02-cli-entrypoint.md
│   │   └── ...
│   └── zh-CN/             # Chinese chapter docs
│       ├── 01-overview.md
│       └── ...
├── examples/
│   ├── 01-overview/        # Runnable examples per chapter
│   │   ├── project-structure.ts
│   │   └── dependency-graph.ts
│   ├── 02-cli-entrypoint/
│   └── ...
├── demo/                   # mini-claude: the progressive demo you build
│   ├── main.ts
│   ├── query.ts
│   ├── Tool.ts
│   └── ...
└── diagrams/               # Architecture diagrams
```

---

## Prerequisites

Before starting, make sure you have:

- **Node.js 18+** — `node --version`
- **Bun** — [bun.sh](https://bun.sh) (used to run TypeScript examples directly)
- **TypeScript knowledge** — comfortable reading typed code; generics and decorators appear often
- **Basic terminal/CLI familiarity** — you'll be reading a CLI app's source

No prior knowledge of Claude or Anthropic's APIs is required — we explain everything from first principles.

---

## Getting Started

```bash
# Clone this repo
git clone https://github.com/anthhub/learn-claude-code.git
cd learn-claude-code

# Install dev dependencies
bun install

# Run the first example
bun run ch1:structure

# Or run any example directly
bun run examples/01-overview/project-structure.ts

# Run the demo (after completing chapters)
cd demo
bun install
bun run main.ts
```

Then open [docs/en/01-overview.md](docs/en/01-overview.md) and follow along.

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
