---
layout: doc
---

# 学习 Claude Code 源码

> 深入理解 Claude Code 架构与实现的实战指南

## 学习路线

| # | 章节 | 难度 | 核心概念 | 状态 |
|---|------|------|----------|------|
| 1 | [项目概览与架构](./01-overview) | 入门 | 架构、模块划分、技术栈 | ✅ |
| 2 | [CLI 入口与启动流程](./02-cli-entrypoint) | 入门 | Commander.js、启动优化 | 🚧 |
| 3 | [工具系统](./03-tool-system) | 中级 | 工具接口、注册、执行 | 🚧 |
| 4 | [命令系统](./04-command-system) | 中级 | 斜杠命令、条件加载 | 🚧 |
| 5 | [终端 UI (Ink)](./05-ink-rendering) | 中级 | React/Ink、布局引擎 | 🚧 |
| 6 | [服务层与 API](./06-service-layer) | 中级 | API 客户端、流式传输 | 🚧 |
| 7 | [权限系统](./07-permission-system) | 中级 | 权限模式、安全机制 | 🚧 |
| 8 | [MCP 集成](./08-mcp-integration) | 高级 | MCP 协议、工具桥接 | 🚧 |
| 9 | [多智能体协调](./09-agent-coordination) | 高级 | 子智能体、团队协作 | 🚧 |
| 10 | [插件与技能](./10-plugin-skill-system) | 高级 | 插件加载、技能定义 | 🚧 |
| 11 | [状态管理](./11-state-context) | 高级 | 上下文压缩、持久记忆 | 🚧 |
| 12 | [高级特性](./12-advanced-features) | 专家 | 沙盒、语音、IDE 桥接 | 🚧 |

## 快速开始

### 方式一：在线环境（推荐）

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=anthhub/learn-claude-code)

点击上面的按钮，30 秒内获得完整的开发环境，无需本地安装任何工具。

### 方式二：本地开发

```bash
git clone https://github.com/anthhub/learn-claude-code.git
cd learn-claude-code
bun install

# 运行第一章示例
bun run ch1:structure

# 运行 demo
cd demo && bun install && bun run main.ts
```
