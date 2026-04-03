# Open Claude Code - English Community Promo Posts

---

## 1. Hacker News (Show HN)

**Title:** Show HN: I reverse-engineered Claude Code (512K lines of TS) into a 12-chapter build tutorial

**Body:**

I spent months studying the Claude Code source snapshot (~1,900 files, 512K+ lines of TypeScript) and distilled it into a progressive 12-chapter tutorial where you build a working clone from scratch.

Each chapter adds a real module: tool system, agentic loop with streaming, permission model, Ink-based terminal UI, context compression, and MCP integration. By the end you have "mini-claude" -- a functional AI coding assistant with 7 tools, a REPL, and the same architectural patterns as the real thing.

Not a wrapper tutorial. This covers how production AI agents actually work: tool dispatch, multi-turn conversation state, token-aware context management, and security boundaries.

TypeScript/Bun. MIT licensed.

Repo: https://github.com/anthhub/open-claude-code
Docs: https://anthhub.github.io/open-claude-code/

---

## 2. Reddit r/ClaudeAI

**Title:** I reverse-engineered Claude Code's source and wrote a 12-chapter tutorial to build your own from scratch

**Body:**

If you use Claude Code daily and have ever wondered how it actually works under the hood -- how it decides which tools to call, how it manages permissions, how the streaming agentic loop ties everything together -- this project might be useful.

I studied the full Claude Code source snapshot (512K+ lines of TypeScript across ~1,900 files) and created a progressive tutorial that walks you through rebuilding it from zero. Not the API -- the actual architecture of the coding agent itself.

Here's what you build chapter by chapter:

- **Tool system** with 7 tools (Bash, FileRead, FileWrite, FileEdit, Grep, Glob, TodoWrite) and a registration/dispatch pattern
- **Agentic loop** with streaming API calls and multi-turn tool-calling orchestration
- **Permission system** with approval flows and security boundaries
- **Terminal UI** built with React/Ink (the same framework Claude Code uses)
- **Context compression** for long conversations that hit token limits
- **MCP integration** for connecting external tool servers

Each chapter has a working demo that builds on the last. By Chapter 12, you have a fully functional "mini-claude" that mirrors the real Claude Code architecture.

Whether you want to build your own coding agent, customize Claude Code's behavior more deeply, or just understand what's happening when you type a command -- this should help.

MIT licensed, TypeScript/Bun.

Repo: https://github.com/anthhub/open-claude-code
Docs: https://anthhub.github.io/open-claude-code/

---

## 3. Reddit r/LocalLLaMA

**Title:** Want to understand how AI coding agents work internally? I reverse-engineered Claude Code into a build-from-scratch tutorial

**Body:**

Most AI coding agents (Claude Code, Cursor, Aider, etc.) share similar architectural patterns: agentic loops, tool dispatch, context management, permission systems. But their internals are rarely documented.

I studied the Claude Code source (512K+ lines of TypeScript) and wrote a 12-chapter progressive tutorial where you build a working clone. Each chapter covers one architectural layer -- tool registration, streaming multi-turn loops, token-aware context compression, security boundaries -- with real code you can run.

The goal isn't to replicate Claude Code specifically. It's to understand the patterns so you can build your own agent on top of any model. The agentic loop, tool interface, and state management patterns are model-agnostic.

Repo: https://github.com/anthhub/open-claude-code
Docs: https://anthhub.github.io/open-claude-code/

---

## 4. Reddit r/typescript

**Title:** Architectural deep-dive: How Claude Code organizes 512K lines of TypeScript (with a build-from-scratch tutorial)

**Body:**

Claude Code is one of the more complex TypeScript applications in production -- ~1,900 files, 512K+ lines, mixing React/Ink for terminal UI, Commander.js for CLI, streaming APIs, a plugin system, and multi-agent coordination.

I reverse-engineered its architecture and wrote a 12-chapter tutorial where you rebuild it progressively. Some interesting TS patterns you'll encounter:

- Factory pattern for tool registration with strict type contracts
- React/Ink for building terminal UIs with the same component model as web React
- Streaming async generators for LLM API communication
- Discriminated unions for message types across the tool-calling loop
- Service layer abstraction over the Anthropic SDK

Built with Bun. Each chapter has runnable code. MIT licensed.

Repo: https://github.com/anthhub/open-claude-code
Docs: https://anthhub.github.io/open-claude-code/

---

## 5. Twitter/X Thread

**Tweet 1:**

I reverse-engineered Claude Code's source code (512K+ lines of TypeScript) and turned it into a 12-chapter tutorial where you build your own from scratch.

Here's what I learned about how production AI coding agents actually work:

🧵

**Tweet 2:**

The core of any coding agent is the agentic loop:

1. User sends a message
2. LLM responds (text or tool call)
3. If tool call -> execute tool -> feed result back -> goto 2
4. If text -> show to user -> goto 1

Simple in theory. In practice: streaming, error recovery, token limits, permission checks, and multi-turn state management make it complex. Chapter by chapter, the tutorial builds each layer.

**Tweet 3:**

The tool system is where it gets interesting. Claude Code doesn't hardcode tools -- it uses a registration pattern where each tool declares its own schema, validation, and execution logic.

In the tutorial you build 7 tools (Bash, FileRead, FileWrite, FileEdit, Grep, Glob, TodoWrite) following the exact same interface pattern.

**Tweet 4:**

Other things you'll build:

- Permission system with approval flows (why Claude Code asks before writing files)
- React/Ink terminal UI (yes, it's React in the terminal)
- Context compression when conversations get too long
- MCP integration for external tool servers

All based on real production code patterns.

**Tweet 5:**

The full tutorial is 12 chapters, progressive, MIT licensed, and built with TypeScript/Bun.

Whether you want to build your own coding agent or just understand how they work -- start here:

Repo: https://github.com/anthhub/open-claude-code
Docs: https://anthhub.github.io/open-claude-code/

---

## 6. Dev.to / Medium Article Titles + Summaries

**Title 1:** How I Reverse-Engineered Claude Code: A 512K-Line TypeScript Deep Dive

Summary: A walkthrough of the architectural decisions behind Claude Code -- how its tool system, agentic loop, and permission model work together. Based on studying the full source snapshot and distilling it into a 12-chapter build tutorial. Repo: https://github.com/anthhub/open-claude-code

**Title 2:** Build Your Own AI Coding Agent from Scratch in 12 Chapters

Summary: A progressive tutorial that takes you from zero to a fully functional Claude Code clone. Each chapter adds one architectural layer -- tools, streaming, permissions, terminal UI -- with runnable TypeScript code at every step. Repo: https://github.com/anthhub/open-claude-code

**Title 3:** The Anatomy of an AI Coding Agent: What 512K Lines of TypeScript Taught Me

Summary: AI coding agents share common patterns: agentic loops, tool dispatch, context compression, security boundaries. This article breaks down each pattern as found in Claude Code's source, with code examples from a working reimplementation. Repo: https://github.com/anthhub/open-claude-code

**Title 4:** From ChatBot to Coding Agent: The Architecture That Makes Claude Code Work

Summary: The gap between a chatbot and a coding agent is mostly architecture -- tool systems, permission models, multi-turn state, and terminal UI. This post maps out how Claude Code bridges that gap, based on a source-level reverse engineering study. Repo: https://github.com/anthhub/open-claude-code

**Title 5:** React in the Terminal: How Claude Code Uses Ink to Build Its UI

Summary: Claude Code's terminal interface is built with React/Ink -- the same component model as web React, rendered to the terminal. This post explores how it handles layout, user input, permission prompts, and streaming output in a CLI context. Repo: https://github.com/anthhub/open-claude-code
