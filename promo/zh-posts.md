# Open Claude Code 中文社区宣传文案

---

## 1. V2EX（分享创造节点）

**标题：** 开源了一个 12 章的渐进式教程，从零构建 Claude Code 克隆版

**正文：**

做了一件一直想做的事：把 Claude Code 的源码（512K+ 行 TypeScript）完整拆解，写成 12 章渐进式教程，并且边学边做——每一章都会给 demo 项目新增模块，最终产物是一个叫 mini-claude 的可运行 AI 编程助手。

做这个项目的原因很简单。市面上讲 AI Agent 的文章不少，但大多停留在概念层面，真正拆解生产级代码的几乎没有。Claude Code 作为目前最复杂的 AI 编码助手之一，它的架构设计（Agentic Loop、工具系统、权限模型、流式 API、React/Ink 终端 UI）对任何想做 AI 工具的人都有参考价值。

教程覆盖的内容：CLI 入口与启动优化、工具系统与注册机制、流式 API 通信、权限系统、MCP 集成、多智能体协调、插件系统、状态管理与上下文压缩，一直到沙盒执行和 IDE 桥接。最终 demo 包含 7 个工具、完整的 Agentic Loop、Ink REPL 和权限审批流。

所有章节中英双语，MIT 协议，欢迎 Star 和 PR。

- GitHub: https://github.com/anthhub/open-claude-code
- 文档站: https://anthhub.github.io/open-claude-code/

---

## 2. 掘金

**标题：** 逆向工程 Claude Code：12 章教程带你从零构建一个 AI 编程助手

**标签：** `AI` `TypeScript` `Agent` `Claude` `开源` `前端`

**正文：**

Claude Code 是 Anthropic 推出的 AI 编程助手，也是目前架构最复杂的 AI CLI 工具之一——约 1,900 个文件、512K+ 行 TypeScript。我花了大量时间阅读它的源码，把核心架构拆解成了 12 章渐进式教程，并且每一章都有对应的代码实现，最终产出一个叫 `mini-claude` 的可运行克隆版。

### 为什么值得学

大多数 AI Agent 教程讲的是"调 API + 拼 Prompt"。但真正生产级的 AI 工具远不止这些。Claude Code 的源码展示了：

- **Agentic Loop**：如何设计一个"LLM 调用 -> 工具执行 -> 结果回传"的多轮循环
- **工具系统**：统一的 Tool 接口、动态注册、参数校验
- **流式通信**：基于 Anthropic SDK 的 SSE 流式处理和 Token 统计
- **权限模型**：工具调用前的审批流程，防止 AI 执行危险操作
- **终端 UI**：用 React/Ink 构建的完整 REPL 界面

### 一个核心代码片段

Agentic Loop 的核心逻辑其实很清晰：

```typescript
while (true) {
  const response = await streamQuery(messages, tools);
  messages.push(response.assistantMessage);

  const toolUses = extractToolCalls(response);
  if (toolUses.length === 0) break; // 没有工具调用，结束循环

  for (const toolUse of toolUses) {
    const result = await executeTool(toolUse, permissions);
    messages.push(makeToolResultMessage(toolUse.id, result));
  }
}
```

看起来简单，但生产级实现需要处理：流式中断、并发工具执行、权限拦截、上下文压缩、错误恢复等大量细节。教程会逐一拆解这些问题。

### 教程结构

12 章从入门到专家，覆盖：项目架构 -> CLI 入口 -> 工具系统 -> 命令系统 -> 终端 UI -> 服务层 -> 权限系统 -> MCP 集成 -> 多智能体 -> 插件系统 -> 状态管理 -> 高级特性。

最终 demo 包含 7 个工具（Bash、FileRead、FileWrite、FileEdit、Grep、Glob、TodoWrite）、完整的 Agentic Loop、Ink REPL 和权限系统。

中英双语，MIT 开源。

- GitHub: https://github.com/anthhub/open-claude-code
- 文档站: https://anthhub.github.io/open-claude-code/

---

## 3. 知乎

**回答问题：** 如何学习 Claude Code 的源码？

**正文：**

直接说结论：我把 Claude Code 的源码拆解成了 12 章渐进式教程，开源在 GitHub 上，每章都有代码实现，最终从零构建一个可运行的 Claude Code 克隆版（mini-claude）。

项目地址：https://github.com/anthhub/open-claude-code

回到问题本身。Claude Code 的源码规模不小（约 1,900 个文件，512K+ 行 TypeScript），直接读很容易迷失方向。我的建议是按架构层次从外到内来理解。

**第一层：CLI 入口。** Claude Code 用 Commander.js 做命令行解析，启动时有大量并行预取优化（配置、认证、模型信息），这套启动流程的设计值得学习。

**第二层：Agentic Loop。** 这是 AI Agent 的核心——一个"发送消息 -> 模型回复 -> 解析工具调用 -> 执行工具 -> 把结果喂回模型"的循环。理解了这个循环，就理解了所有 AI Agent 的基本范式。

**第三层：工具系统。** Claude Code 定义了统一的 Tool 接口，每个工具（Bash、文件读写、搜索等）都实现这个接口。工具通过注册表动态加载，支持 MCP 协议扩展外部工具。

**第四层：权限与安全。** 这是很多开源 Agent 忽略的部分。Claude Code 的权限系统会在工具执行前拦截，根据操作的危险等级决定是否需要用户确认。

**第五层：终端 UI。** 用 React/Ink 构建了一个完整的终端 REPL，包括消息列表、Markdown 渲染、权限请求弹窗等。如果你做过 React 开发，会发现 Ink 的开发体验非常熟悉。

**第六层：高级特性。** 多智能体协调、插件系统、上下文压缩、沙盒执行、IDE 桥接等。

我在教程里对每一层都做了详细拆解，并且每章的 demo 代码都是可运行的。到第 12 章，你会有一个包含 7 个工具、完整 Agentic Loop、流式 API、Ink REPL 和权限系统的 AI 编程助手。

文档站（含中文版）：https://anthhub.github.io/open-claude-code/

---

## 4. 小红书

**标题：** 拆解 Claude Code 源码写了本开源教程

**正文：**

花了好长时间读完 Claude Code 的源码（50 万行 TypeScript），把核心架构整理成了 12 章教程，还做了一个可以跑起来的克隆版 mini-claude。

每章学一个模块，边看边写代码。从 CLI 入口到工具系统，从流式 API 到权限控制，从终端 UI 到多智能体协调，一路做下来就能理解一个生产级 AI Agent 到底是怎么搭的。

最终成品：7 个工具 + Agentic Loop + 流式对话 + 权限系统 + 终端 REPL。

中英双语、MIT 开源、可以直接跑。想学 AI Agent 架构的朋友来看看。

GitHub: https://github.com/anthhub/open-claude-code

**标签：** #ClaudeCode #AI编程 #开源项目 #TypeScript #AIAgent #程序员学习 #逆向工程 #编程教程

---

## 5. 微信公众号

**标题：** 逆向 Claude Code 512K 行源码：12 章教程从零构建 AI 编程助手

**摘要：** 基于 Claude Code 真实源码的逆向工程，12 章渐进式教程带你从零构建一个完整的 AI 编程助手。覆盖 Agentic Loop、工具系统、流式 API、权限模型、终端 UI 等核心模块，每章都有可运行代码。

**正文大纲：**

### 一、为什么要拆解 Claude Code

AI Agent 的教程很多，但真正基于生产级代码的拆解几乎没有。Claude Code 作为 Anthropic 的旗舰产品，其 512K+ 行 TypeScript 源码是学习 AI 工具架构的最佳素材。

### 二、Agentic Loop：AI Agent 的心脏

"消息 -> 模型 -> 工具调用 -> 执行 -> 回传"的核心循环如何设计，以及生产环境中的流式处理、错误恢复、并发执行等工程细节。

### 三、工具系统与权限模型：安全的 AI 自主执行

统一的 Tool 接口设计，动态注册机制，以及如何在工具执行前实现分级权限审批，防止 AI 做出危险操作。

### 四、从 React 到终端：用 Ink 构建 REPL

Claude Code 用 React/Ink 渲染终端 UI，这套方案让前端开发者可以用熟悉的组件化方式构建命令行界面。

### 五、动手构建 mini-claude

12 章教程的最终产物：一个包含 7 个工具、完整 Agentic Loop、流式 API、权限系统和 Ink REPL 的可运行 AI 编程助手。

**项目地址：**
- GitHub: https://github.com/anthhub/open-claude-code
- 文档站: https://anthhub.github.io/open-claude-code/

---

## 6. Twitter/X 中文推文线程

**推文 1/3：**

开源了一个项目：12 章渐进式教程，基于 Claude Code 真实源码（512K+ 行 TypeScript）逆向工程，从零构建一个可运行的 AI 编程助手。

不是讲概念，是拆真实生产代码。每章新增一个模块，最终产物包含 7 个工具、Agentic Loop、流式 API、权限系统和 Ink REPL。

GitHub: https://github.com/anthhub/open-claude-code

**推文 2/3：**

为什么做这个？因为市面上的 AI Agent 教程大多是"调 API + 拼 Prompt"，和真正的生产级实现差距太大。

Claude Code 的架构设计——工具注册机制、流式通信、权限拦截、上下文压缩、多智能体协调——这些才是做 AI 工具真正需要解决的问题。

文档站（中英双语）: https://anthhub.github.io/open-claude-code/

**推文 3/3：**

教程覆盖 12 个核心模块：

- CLI 入口与启动优化
- 工具系统与动态注册
- 流式 API 与 Token 统计
- 权限系统与安全模型
- React/Ink 终端 UI
- MCP 协议集成
- 多智能体协调
- 插件系统与上下文压缩

MIT 开源，欢迎 Star、Fork、PR。
