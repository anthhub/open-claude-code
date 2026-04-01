# Demo: mini-claude 构建指南

> 跟随教程逐章构建，最终得到一个与 Claude Code 架构一致的 AI 编程助手

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=anthhub/learn-claude-code)

## 最终目标

```
demo/
├── main.ts                    # CLI 入口（Commander.js）
├── context.ts                 # 系统提示词构建器
├── query.ts                   # 查询循环（流式 + 工具调用）
├── Tool.ts                    # 工具接口与工厂
├── tools.ts                   # 工具注册表
├── types/                     # 类型系统 ← 第 1 章
├── tools/                     # 工具实现
│   ├── BashTool/
│   ├── FileReadTool/
│   ├── FileWriteTool/
│   ├── FileEditTool/
│   ├── GrepTool/
│   └── GlobTool/
├── services/
│   ├── api/claude.ts          # Anthropic SDK 封装
│   └── compact/compact.ts     # 上下文压缩
├── screens/REPL.tsx           # 终端 UI（Ink）
├── components/                # UI 组件
├── commands/                  # 斜杠命令
└── utils/                     # 工具函数
```

## 每章构建进度

| 章 | 新增模块 | 完成后能力 | 状态 |
|----|---------|-----------|------|
| 1 | `types/` 类型系统 | 类型定义可编译 | ✅ |
| 2 | `Tool.ts` + `tools.ts` | 工具接口与注册表 | 🚧 |
| 3 | `services/api/` + `context.ts` | 流式 API 调用 | 🚧 |
| 4 | `query.ts` + `utils/messages.ts` | 多轮工具调用循环 | 🚧 |
| 5 | `tools/BashTool`、`FileReadTool`、`GrepTool` | 执行命令、读文件、搜索 | 🚧 |
| 6 | `tools/FileWriteTool`、`FileEditTool`、`GlobTool` | 完整文件操作 | 🚧 |
| 7 | `utils/permissions.ts` | 危险命令拦截 | 🚧 |
| 8 | `screens/REPL.tsx` + `components/` | 交互式终端 UI | 🚧 |
| 9 | `main.ts`（Commander.js） | 完整 CLI 参数支持 | 🚧 |
| 10 | `commands/` + compact 服务 | /help、/clear、/compact | 🚧 |
| 11 | `components/PermissionRequest.tsx` | 交互式权限确认 | 🚧 |
| 12 | 历史、重试、错误处理 | 生产就绪 | 🚧 |

## 运行 Demo

```bash
# 本地运行
cd demo
bun install
bun run main.ts

# 类型检查
bun run typecheck
```

## 架构对应关系

| Demo 文件 | 真实 Claude Code 文件 |
|-----------|---------------------|
| `types/message.ts` | `src/types/message.ts` |
| `types/tool.ts` | `src/Tool.ts` |
| `types/permissions.ts` | `src/types/permissions.ts` |
| `Tool.ts` | `src/Tool.ts` |
| `tools.ts` | `src/tools/index.ts` |
| `query.ts` | `src/query.ts` |
| `context.ts` | `src/context.ts` |
| `services/api/claude.ts` | `src/services/claude.ts` |
| `screens/REPL.tsx` | `src/screens/REPL.tsx` |
| `utils/permissions.ts` | `src/utils/permissions.ts` |
