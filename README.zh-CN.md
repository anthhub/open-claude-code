# 学习 Claude Code 源码

> 深入理解 Claude Code 架构与实现的实战指南

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-latest-orange.svg)](https://bun.sh/)

[English](README.md)

---

## 这是什么？

**Learn Claude Code** 是一个渐进式、示例驱动的 Claude Code 源码研究项目，基于真实源码快照（约 1,900 个文件，512K+ 行 TypeScript）。你不只是在阅读文档，而是在深入一个成熟的 AI 编程助手内部，理解其架构决策、设计模式和技术权衡。

Claude Code 远不止是一个聊天机器人包装器，它是一个功能完整的终端应用，融合了：
- 流式 LLM API 客户端
- 基于 React/Ink 的终端用户界面
- 动态工具与插件系统
- 多智能体协调框架
- 权限与安全模型
- MCP（模型上下文协议）集成

研究其源码，是构建生产级 AI 应用的绝佳实战教材。

---

## 学习路线

| # | 章节 | 难度 | 核心概念 |
|---|------|------|----------|
| 1 | [项目概览与架构](docs/zh-CN/01-overview.md) | 入门 | 架构、模块划分、技术栈 |
| 2 | [CLI 入口与启动流程](docs/zh-CN/02-cli-entrypoint.md) | 入门 | Commander.js、启动优化、并行预取 |
| 3 | [工具系统](docs/zh-CN/03-tool-system.md) | 中级 | 工具接口、注册机制、执行流程 |
| 4 | [命令系统](docs/zh-CN/04-command-system.md) | 中级 | 斜杠命令、注册机制、条件加载 |
| 5 | [基于 Ink 的终端 UI](docs/zh-CN/05-ink-rendering.md) | 中级 | React/Ink、布局引擎、DOM 模型 |
| 6 | [服务层与 API 通信](docs/zh-CN/06-service-layer.md) | 中级 | API 客户端、流式传输、Token 统计 |
| 7 | [权限系统](docs/zh-CN/07-permission-system.md) | 中级 | 权限模式、审批流程、安全机制 |
| 8 | [MCP 集成](docs/zh-CN/08-mcp-integration.md) | 高级 | MCP 协议、服务器管理、工具桥接 |
| 9 | [智能体与多智能体协调](docs/zh-CN/09-agent-coordination.md) | 高级 | 子智能体、团队协作、协调器、集群 |
| 10 | [插件与技能系统](docs/zh-CN/10-plugin-skill-system.md) | 高级 | 插件加载、技能定义、可扩展性 |
| 11 | [状态管理与上下文](docs/zh-CN/11-state-context.md) | 高级 | 状态存储、上下文压缩、持久记忆 |
| 12 | [高级特性](docs/zh-CN/12-advanced-features.md) | 专家 | 沙盒执行、语音输入、IDE 桥接、远程执行 |

---

## 章节详情

### 基础篇（第 1-2 章）

- **[01 - 项目概览与架构](docs/zh-CN/01-overview.md)**
  理解高层结构、模块边界和技术选型。了解约 1,900 个文件如何组织成一个连贯的系统。

- **[02 - CLI 入口与启动流程](docs/zh-CN/02-cli-entrypoint.md)**
  从 `claude` 命令到第一帧渲染的完整执行路径。理解 Commander.js 集成和并行预取优化。

### 核心系统（第 3-7 章）

- **[03 - 工具系统](docs/zh-CN/03-tool-system.md)**
  Claude Code 的每项能力都是一个"工具"。学习工具接口、注册方式，以及执行管道如何处理调用、错误和结果。

- **[04 - 命令系统](docs/zh-CN/04-command-system.md)**
  斜杠命令（`/help`、`/clear`、`/mcp`）是面向用户的控制平面。学习注册机制、条件加载，以及命令与工具的区别。

- **[05 - 基于 Ink 的终端 UI](docs/zh-CN/05-ink-rendering.md)**
  终端中的 React——出乎意料地强大。学习 Ink 的 DOM 模型、布局引擎和协调器如何实现响应式 TUI。

- **[06 - 服务层与 API 通信](docs/zh-CN/06-service-layer.md)**
  Claude Code 与 Anthropic API 之间的桥梁。流式响应、Token 统计、重试逻辑和成本计算。

- **[07 - 权限系统](docs/zh-CN/07-permission-system.md)**
  安全而不繁琐。学习权限模式（auto、ask、manual）、审批流程，以及危险操作的门控机制。

### 高级系统（第 8-12 章）

- **[08 - MCP 集成](docs/zh-CN/08-mcp-integration.md)**
  模型上下文协议将外部服务器变成工具提供者。学习 Claude Code 如何发现、连接和桥接 MCP 服务器。

- **[09 - 智能体与多智能体协调](docs/zh-CN/09-agent-coordination.md)**
  Claude Code 可以生成并协调子智能体。学习协调器模式、智能体团队、任务委派和集群架构。

- **[10 - 插件与技能系统](docs/zh-CN/10-plugin-skill-system.md)**
  无需 fork 即可扩展。插件如何加载、技能如何定义，以及系统如何解决冲突。

- **[11 - 状态管理与上下文](docs/zh-CN/11-state-context.md)**
  长对话需要智能的状态管理。学习存储设计、上下文压缩策略和持久记忆系统。

- **[12 - 高级特性](docs/zh-CN/12-advanced-features.md)**
  前沿功能：沙盒执行、语音输入、IDE 桥接协议和远程智能体执行。

---

## 项目结构

```
learn-claude-code/
├── README.md               # 英文版
├── README.zh-CN.md         # 本文件（中文版）
├── ROADMAP.md              # 可视化学习路线图
├── LICENSE
├── package.json
├── tsconfig.json
├── docs/
│   ├── en/                 # 英文章节文档
│   │   ├── 01-overview.md
│   │   ├── 02-cli-entrypoint.md
│   │   └── ...
│   └── zh-CN/             # 中文章节文档
│       ├── 01-overview.md
│       └── ...
├── examples/
│   ├── 01-overview/        # 每章可运行示例
│   │   ├── project-structure.ts
│   │   └── dependency-graph.ts
│   ├── 02-cli-entrypoint/
│   └── ...
└── diagrams/               # 架构图
```

---

## 前置要求

开始之前，请确保具备：

- **Node.js 18+** — `node --version`
- **Bun** — [bun.sh](https://bun.sh)（用于直接运行 TypeScript 示例）
- **TypeScript 基础** — 能读懂类型化代码；源码中大量使用泛型和装饰器
- **基本的终端/CLI 使用经验** — 你将阅读一个 CLI 应用的源码

无需预先了解 Claude 或 Anthropic 的 API——我们从第一原理出发逐一讲解。

---

## 快速开始

```bash
# 克隆本仓库
git clone https://github.com/anthhub/learn-claude-code.git
cd learn-claude-code

# 安装开发依赖
bun install

# 运行第一个示例
bun run ch1:structure

# 或直接运行任意示例
bun run examples/01-overview/project-structure.ts
```

然后打开 [docs/zh-CN/01-overview.md](docs/zh-CN/01-overview.md) 跟随学习。

---

## 参与贡献

欢迎贡献！你可以：

- 修正文档中的错误或改进说明
- 添加或改进可运行示例
- 将章节翻译成更多语言
- 为复杂流程添加架构图

提交较大改动前请先开 Issue 讨论。

---

## 致谢

源码快照来自 [anthhub/claude-code](https://github.com/anthhub/claude-code) 仓库。本项目是独立的教育资源，与 Anthropic 官方无关。

---

## 许可证

MIT — 详见 [LICENSE](./LICENSE)
