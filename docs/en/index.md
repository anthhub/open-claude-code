---
layout: doc
---

# Learn Claude Code Source

> A hands-on guide to understanding Claude Code's architecture and implementation

## Learning Path

| # | Chapter | Difficulty | Core Concepts | Status |
|---|---------|-----------|---------------|--------|
| 1 | [Project Overview](./01-overview) | Beginner | Architecture, modules, tech stack | ✅ |
| 2 | [CLI Entrypoint](./02-cli-entrypoint) | Beginner | Commander.js, startup optimization | 🚧 |
| 3 | [Tool System](./03-tool-system) | Intermediate | Tool interface, registry, execution | 🚧 |
| 4 | [Command System](./04-command-system) | Intermediate | Slash commands, lazy loading | 🚧 |
| 5 | [Terminal UI (Ink)](./05-ink-rendering) | Intermediate | React/Ink, layout engine | 🚧 |
| 6 | [Service Layer](./06-service-layer) | Intermediate | API client, streaming | 🚧 |
| 7 | [Permission System](./07-permission-system) | Intermediate | Permission modes, security | 🚧 |
| 8 | [MCP Integration](./08-mcp-integration) | Advanced | MCP protocol, tool bridging | 🚧 |
| 9 | [Multi-Agent](./09-agent-coordination) | Advanced | Sub-agents, team coordination | 🚧 |
| 10 | [Plugins & Skills](./10-plugin-skill-system) | Advanced | Plugin loading, skill definitions | 🚧 |
| 11 | [State Management](./11-state-context) | Advanced | Context compression, memory | 🚧 |
| 12 | [Advanced Features](./12-advanced-features) | Expert | Sandbox, voice, IDE bridge | 🚧 |

## Quick Start

### Option 1: Online Environment (Recommended)

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=anthhub/learn-claude-code)

Click the button above to get a full dev environment in 30 seconds — no local installation needed.

### Option 2: Local Development

```bash
git clone https://github.com/anthhub/learn-claude-code.git
cd learn-claude-code
bun install

# Run chapter 1 example
bun run ch1:structure

# Run the demo
cd demo && bun install && bun run main.ts
```
