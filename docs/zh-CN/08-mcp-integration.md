# 第八章：MCP 集成

> **难度：** 进阶 | **阅读时间：** ~75 分钟

---

## 目录

1. [简介：什么是 MCP？](#1-简介什么是-mcp)
2. [Claude Code 的 MCP 架构：双重角色](#2-claude-code-的-mcp-架构双重角色)
3. [传输层：六种协议](#3-传输层六种协议)
4. [服务器连接生命周期](#4-服务器连接生命周期)
5. [MCPTool：占位符模式](#5-mcptool占位符模式)
6. [工具发现与注册](#6-工具发现与注册)
7. [MCP 安全机制](#7-mcp-安全机制)
8. [MCP 作为服务端：暴露 Claude Code 的工具](#8-mcp-作为服务端暴露-claude-code-的工具)
9. [InProcessTransport：零子进程通信](#9-inprocesstransport零子进程通信)
10. [动手实践：构建简单的 MCP 客户端](#10-动手实践构建简单的-mcp-客户端)
11. [核心要点与下一章](#11-核心要点与下一章)

---

## 1. 简介：什么是 MCP？

**模型上下文协议（Model Context Protocol，MCP）** 是 Anthropic 发布的开放协议，用于标准化 AI 模型与外部工具和数据源之间的通信方式。可以把它理解为 AI 工具集成的"USB 标准"：任何符合 MCP 规范的服务端都能接入任何 MCP 客户端，无需定制集成代码。

### 为什么 MCP 很重要

在 MCP 之前，每个 AI 工具集成都是定制化的——Slack 集成和 GitHub 集成的实现方式完全不同。开发者需要编写自定义适配器、处理不同的认证模式，并维护 N 套独立实现。

MCP 定义了一套统一协议，包含以下概念：

| 概念 | 说明 |
|---|---|
| **工具（Tools）** | AI 可调用的函数 |
| **资源（Resources）** | AI 可读取的数据源 |
| **提示词（Prompts）** | 可复用的提示词模板 |
| **引导（Elicitation）** | 服务端向客户端发起的用户输入请求 |

该协议基于 JSON-RPC 2.0 运行，支持多种传输方式（stdio、HTTP、WebSocket、SSE）。

### MCP 规范架构

```
┌─────────────────────────────────────────────┐
│              MCP 客户端                       │
│  （Claude Code、IDE 插件等）                  │
└──────────────┬──────────────────────────────┘
               │  JSON-RPC 2.0 over 传输层
               ▼
┌─────────────────────────────────────────────┐
│              MCP 服务端                       │
│  （文件系统、数据库、Web API 等）              │
└─────────────────────────────────────────────┘
```

Claude Code 的 MCP 集成之所以特殊，在于它**同时扮演两种角色**——这一细节将在后文深入探讨。

---

## 2. Claude Code 的 MCP 架构：双重角色

Claude Code 在 MCP 生态系统中占据独特位置：它既是 **MCP 客户端**（连接外部服务端），也是 **MCP 服务端**（将自身工具暴露给其他客户端）。

### 2.1 作为 MCP 客户端

当 Claude Code 连接 MCP 服务端时，它会：

1. 建立传输层连接（stdio、SSE、HTTP 等）
2. 通过 MCP 握手协商能力
3. 获取服务端的工具列表（`tools/list`）
4. 使用 `MCPTool` 占位符模式将每个工具包装为本地 `Tool` 对象
5. 将这些工具注入 AI 的可用工具集

连接管理逻辑位于 `src/services/mcp/client.ts`，工具包装逻辑位于 `src/tools/MCPTool/MCPTool.ts`。

### 2.2 作为 MCP 服务端

Claude Code 可以通过 `claude mcp serve` 将自身工具暴露给外部客户端。具体实现在 `src/entrypoints/mcp.ts`：

```typescript
// src/entrypoints/mcp.ts:47-57
const server = new Server(
  {
    name: 'claude/tengu',
    version: MACRO.VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
)
```

这种双重角色设计意味着 Claude Code 既能被外部 LLM 编排，也能自己编排其他 MCP 服务端，从而支持多层次的多智能体架构。

### 2.3 双重角色示意图

```
┌──────────────────────────────────────────────────────┐
│                   Claude Code                         │
│                                                       │
│  ┌─────────────────┐    ┌──────────────────────────┐ │
│  │   MCP 客户端    │    │      MCP 服务端          │ │
│  │                 │    │  (claude mcp serve)      │ │
│  │ - 连接外部 MCP  │    │                          │ │
│  │   服务端        │    │ - 暴露 Read、Write、      │ │
│  │ - 获取工具列表  │    │   Bash 等工具            │ │
│  │ - 调用工具      │    │ - 接受其他 LLM 连接      │ │
│  └────────┬────────┘    └──────────────┬───────────┘ │
└───────────┼──────────────────────────  │─────────────┘
            │                            │
         连接到                       监听来自
            │                            │
     ┌──────▼──────┐            ┌────────▼────────┐
     │  外部 MCP   │            │  外部 LLM 客户端 │
     │  服务端     │            │  （另一个 Claude │
     │  （数据库、 │            │   实例等）       │
     │   API 等）  │            └─────────────────┘
     └─────────────┘
```

---

## 3. 传输层：六种协议

传输层体现了 MCP 的灵活性。Claude Code 支持 **六种不同的传输类型**，分别针对不同的部署场景。

### 3.1 传输类型定义

定义于 `src/services/mcp/types.ts:23-26`：

```typescript
export const TransportSchema = lazySchema(() =>
  z.enum(['stdio', 'sse', 'sse-ide', 'http', 'ws', 'sdk']),
)
export type Transport = z.infer<ReturnType<typeof TransportSchema>>
```

此外还有两个内部专用变体：`sse-ide`、`ws-ide` 和 `claudeai-proxy`。

### 3.2 传输类型对比

| 传输类型 | 协议 | 认证方式 | 适用场景 | 配置字段 |
|---|---|---|---|---|
| `stdio` | 进程 stdin/stdout | 无（环境变量） | 本地 CLI 工具 | `command`、`args` |
| `sse` | HTTP 服务端推送事件 | OAuth 2.0 / 请求头 | 远程 API、云服务 | `url`、`headers` |
| `sse-ide` | SSE（IDE 专用） | lockfile 中的令牌 | VS Code / JetBrains 插件 | `url`、`ideName` |
| `http` | 可流式 HTTP | OAuth 2.0 / 请求头 | 现代 REST 兼容服务端 | `url`、`headers` |
| `ws` | WebSocket | 请求头 / OAuth | 双向流式通信 | `url`、`headers` |
| `sdk` | 进程内（无网络） | 无 | Agent SDK 集成 | `name` |

### 3.3 stdio — 本地标准方案

最常用的本地工具传输方式。Claude Code 启动子进程并通过 stdin/stdout 通信：

```typescript
// src/services/mcp/client.ts:950-958
transport = new StdioClientTransport({
  command: finalCommand,
  args: finalArgs,
  env: {
    ...subprocessEnv(),
    ...serverRef.env,
  } as Record<string, string>,
  stderr: 'pipe', // 防止 MCP 服务端的错误输出打印到 UI
})
```

`stderr: 'pipe'` 非常重要——它防止 MCP 服务端的诊断输出干扰终端 UI。

**配置示例：**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

### 3.4 SSE — 服务端推送事件

对于远程服务端，SSE 提供长连接的 HTTP 连接，服务端通过该连接推送事件。Claude Code 为其封装了 OAuth 和超时处理：

```typescript
// src/services/mcp/client.ts:619-676
const transportOptions: SSEClientTransportOptions = {
  authProvider,
  fetch: wrapFetchWithTimeout(
    wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
  ),
  requestInit: {
    headers: {
      'User-Agent': getMCPUserAgent(),
      ...combinedHeaders,
    },
  },
}

// 重要：eventSourceInit 使用不带超时的 fetch
// 因为 SSE 连接是长连接（无限期保持）
transportOptions.eventSourceInit = {
  fetch: async (url, init) => { /* 带认证的 fetch */ }
}
```

关键设计决策：EventSource 连接**不使用**超时封装，因为 SSE 流本来就需要无限期保持。只有单个 POST 请求才设置 60 秒超时。

### 3.5 HTTP — 可流式 HTTP（现代标准）

MCP 可流式 HTTP 传输是 SSE 的现代继任者，使用单一端点同时服务 JSON 和 SSE：

```typescript
// src/services/mcp/client.ts:469-471
// MCP 可流式 HTTP 规范要求客户端在每次 POST 时
// 都声明接受 JSON 和 SSE。不满足此要求的服务端会返回 HTTP 406
const MCP_STREAMABLE_HTTP_ACCEPT = 'application/json, text/event-stream'
```

`wrapFetchWithTimeout` 函数（第 492-549 行）的精心设计：
1. GET 请求跳过超时（长连接 SSE 流）
2. POST 请求设置 60 秒超时
3. 使用 `setTimeout` 而非 `AbortSignal.timeout()`，避免 Bun 惰性 GC 导致的内存泄漏（每次请求泄漏约 2.4KB）

### 3.6 WebSocket — 双向流式通信

WebSocket（`ws`）支持双向流式通信，适用于实时应用。`ws-ide` 变体专用于 IDE 插件：

```typescript
// src/services/mcp/client.ts:708-733
} else if (serverRef.type === 'ws-ide') {
  const tlsOptions = getWebSocketTLSOptions()
  const wsHeaders = {
    'User-Agent': getMCPUserAgent(),
    ...(serverRef.authToken && {
      'X-Claude-Code-Ide-Authorization': serverRef.authToken,
    }),
  }
  // Bun 和 Node.js 的 WebSocket 构造函数签名不同
  if (typeof Bun !== 'undefined') {
    wsClient = new globalThis.WebSocket(serverRef.url, { ... })
  } else {
    wsClient = await createNodeWsClient(serverRef.url, { ... })
  }
}
```

### 3.7 SDK — 进程内传输

`sdk` 传输类型比较特殊——它使用 `InProcessTransport` 在同一进程中运行 MCP 服务端，无需任何网络开销：

```typescript
// src/services/mcp/client.ts:866-867
} else if (serverRef.type === 'sdk') {
  throw new Error('SDK servers should be handled in print.ts')
}
```

SDK 服务端通过 `setupSdkMcpClients` 单独处理，不经过 `connectToServer`，而是由 Agent SDK 以编程方式设置。

### 3.8 传输类型选择流程

```
配置类型？
    │
    ├── 'stdio'（或未定义）─────────────┐
    │       └── Chrome/ComputerUse 名称？─┼── InProcessTransport
    │           └── 否 ─────────────────► StdioClientTransport
    │
    ├── 'sse' ──────────────────────────► SSEClientTransport + OAuth
    │
    ├── 'sse-ide' ──────────────────────► SSEClientTransport（无认证）
    │
    ├── 'ws-ide' ───────────────────────► WebSocketTransport + 认证令牌
    │
    ├── 'ws' ───────────────────────────► WebSocketTransport + 请求头
    │
    ├── 'http' ─────────────────────────► StreamableHTTPClientTransport + OAuth
    │
    ├── 'claudeai-proxy' ───────────────► StreamableHTTPClientTransport + Claude.ai OAuth
    │
    └── 'sdk' ──────────────────────────► 错误（由其他地方处理）
```

---

## 4. 服务器连接生命周期

理解连接如何被管理，对于构建可靠的 MCP 集成至关重要。

### 4.1 状态机

每个 MCP 服务器连接都经历明确定义的状态，定义于 `src/services/mcp/types.ts:179-226`：

```
                  ┌─────────┐
                  │ pending │ ◄── reconnectAttempt / maxReconnectAttempts
                  └────┬────┘
                       │ connectToServer()
            ┌──────────┼──────────┬──────────────┐
            ▼          ▼          ▼               ▼
      ┌───────────┐ ┌────────┐ ┌───────────┐ ┌──────────┐
      │ connected │ │ failed │ │needs-auth │ │ disabled │
      └─────┬─────┘ └────────┘ └──────────┘ └──────────┘
            │
            │ onclose（连接断开）
            ▼
      memoize 缓存被清除
            │
            │ 下次工具调用
            ▼
      重新连接（再次进入 pending）
```

### 4.2 ConnectedMCPServer 类型

成功连接的服务器携带完整的客户端引用：

```typescript
// src/services/mcp/types.ts:180-192
export type ConnectedMCPServer = {
  client: Client          // MCP SDK 客户端实例
  name: string
  type: 'connected'
  capabilities: ServerCapabilities
  serverInfo?: {
    name: string
    version: string
  }
  instructions?: string   // 截断至 MAX_MCP_DESCRIPTION_LENGTH（2048）
  config: ScopedMcpServerConfig
  cleanup: () => Promise<void>
}
```

`instructions` 字段值得注意：MCP 服务器可以提供系统指令，但 Claude Code 将其截断至 2048 个字符，防止 OpenAPI 生成的服务器倾泻几十 KB 的文档。

### 4.3 记忆化连接缓存

`connectToServer` 函数使用 lodash `memoize` 和自定义缓存键：

```typescript
// src/services/mcp/client.ts:581-586
export function getServerCacheKey(
  name: string,
  serverRef: ScopedMcpServerConfig,
): string {
  return `${name}-${jsonStringify(serverRef)}`
}

// src/services/mcp/client.ts:595
export const connectToServer = memoize(
  async (name, serverRef, serverStats?) => { ... },
  getServerCacheKey,
)
```

**为什么使用记忆化？** 连接服务器开销较大（网络握手、能力协商）。缓存确保对同一服务器的多个并发工具调用复用同一连接。

**缓存失效** 发生在 `client.onclose` 中：

```typescript
// src/services/mcp/client.ts:1384-1396
client.onclose = () => {
  // 同时清除 fetch 缓存——重连需要刷新工具/资源列表
  fetchToolsForClient.cache.delete(name)
  fetchResourcesForClient.cache.delete(name)
  fetchCommandsForClient.cache.delete(name)
  connectToServer.cache.delete(key)
}
```

### 4.4 连接超时与重试逻辑

连接有可配置的超时时间（默认 30 秒，通过 `MCP_TIMEOUT` 环境变量调整）：

```typescript
// src/services/mcp/client.ts:1048-1077
const connectPromise = client.connect(transport)
const timeoutPromise = new Promise<never>((_, reject) => {
  const timeoutId = setTimeout(() => {
    transport.close().catch(() => {})
    reject(new Error(`MCP server "${name}" connection timed out`))
  }, getConnectionTimeoutMs())

  connectPromise.then(
    () => clearTimeout(timeoutId),
    _error => clearTimeout(timeoutId),
  )
})

await Promise.race([connectPromise, timeoutPromise])
```

对于终端连接错误（ECONNRESET、ETIMEDOUT、EPIPE 等），Claude Code 追踪 `consecutiveConnectionErrors` 计数，在 `MAX_ERRORS_BEFORE_RECONNECT = 3` 次连续失败后触发重连：

```typescript
// src/services/mcp/client.ts:1350-1364
if (isTerminalConnectionError(error.message)) {
  consecutiveConnectionErrors++
  if (consecutiveConnectionErrors >= MAX_ERRORS_BEFORE_RECONNECT) {
    consecutiveConnectionErrors = 0
    closeTransportAndRejectPending('max consecutive terminal errors')
  }
}
```

### 4.5 认证缓存

为避免对需要 OAuth 的服务器发出重复请求，Claude Code 将 `needs-auth` 状态缓存 15 分钟：

```typescript
// src/services/mcp/client.ts:257-288
const MCP_AUTH_CACHE_TTL_MS = 15 * 60 * 1000 // 15 分钟

async function isMcpAuthCached(serverId: string): Promise<boolean> {
  const cache = await getMcpAuthCache()
  const entry = cache[serverId]
  if (!entry) return false
  return Date.now() - entry.timestamp < MCP_AUTH_CACHE_TTL_MS
}
```

缓存写入通过 Promise 链串行化，防止并发读-改-写竞争条件：

```typescript
// src/services/mcp/client.ts:291-309
let writeChain = Promise.resolve()

function setMcpAuthCacheEntry(serverId: string): void {
  writeChain = writeChain.then(async () => {
    // 原子性读-改-写
  })
}
```

---

## 5. MCPTool：占位符模式

这是 Claude Code 代码库中最优雅的模式之一：单个 `MCPTool` 对象作为**原型**，通过克隆和属性覆盖为每个真实 MCP 工具创建实例。

### 5.1 占位符定义

`src/tools/MCPTool/MCPTool.ts` 定义了一个最小化的、无实际功能的工具：

```typescript
// src/tools/MCPTool/MCPTool.ts:27-77
export const MCPTool = buildTool({
  isMcp: true,
  // 在 mcpClient.ts 中被真实 MCP 工具名称覆盖
  isOpenWorld() { return false },
  // 在 mcpClient.ts 中被覆盖
  name: 'mcp',
  maxResultSizeChars: 100_000,
  // 在 mcpClient.ts 中被覆盖
  async description() { return DESCRIPTION },
  // 在 mcpClient.ts 中被覆盖
  async prompt() { return PROMPT },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  // 在 mcpClient.ts 中被覆盖
  async call() { return { data: '' } },
  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'passthrough', message: 'MCPTool requires permission.' }
  },
  // ...
})
```

注释"在 mcpClient.ts 中被覆盖"出现了**六次**——这正是 `MCPTool` 的全部意义。它是一个结构模板，而非功能工具。

### 5.2 克隆并覆盖模式

在 `client.ts` 的 `fetchToolsForClient` 中，服务端的每个 MCP 工具都通过展开 `MCPTool` 并替换真实实现来创建：

```typescript
// src/services/mcp/client.ts:1766-1832
return toolsToProcess.map((tool): Tool => {
  const fullyQualifiedName = buildMcpToolName(client.name, tool.name)
  return {
    ...MCPTool,                    // 展开：继承所有默认值
    name: fullyQualifiedName,      // 覆盖：mcp__serverName__toolName
    mcpInfo: { serverName: client.name, toolName: tool.name },
    isMcp: true,

    async description() {
      return tool.description ?? ''        // 覆盖：真实描述
    },
    async prompt() {
      const desc = tool.description ?? ''
      return desc.length > MAX_MCP_DESCRIPTION_LENGTH
        ? desc.slice(0, MAX_MCP_DESCRIPTION_LENGTH) + '… [truncated]'
        : desc
    },
    inputJSONSchema: tool.inputSchema as Tool['inputJSONSchema'],

    async call(args, context, _canUseTool, parentMessage, onProgress?) {
      // 覆盖：真实实现，调用 MCP 服务器
      const connectedClient = await ensureConnectedClient(client)
      const mcpResult = await callMCPToolWithUrlElicitationRetry({...})
      return { data: mcpResult.content }
    },

    async checkPermissions() {
      return {
        behavior: 'passthrough',
        suggestions: [{ type: 'addRules', rules: [...], behavior: 'allow' }],
      }
    },
  }
})
```

### 5.3 为什么使用这种模式？

**其他方案及其被否定的原因：**

1. **为每个 MCP 工具创建独立类** — 需要在运行时动态创建类，复杂的原型链，更难进行类型检查
2. **通用包装类** — 所有调用方都需要了解包装器，破坏统一的 `Tool` 接口
3. **工厂函数** — 与现有方案类似，但缺少从规范模板展开的结构化优势

展开模式有三个关键优势：
- **类型安全**：TypeScript 确保结果满足 `ToolDef<InputSchema, Output>`
- **默认值传播**：`maxResultSizeChars`、`renderToolUseMessage` 等属性自动继承
- **每个工具代码量最小**：只需指定变化的属性（name、description、call、permissions）

### 5.4 工具名称规范化

MCP 工具名称遵循层级命名空间：`mcp__<serverName>__<toolName>`。`buildMcpToolName` 函数（位于 `src/services/mcp/mcpStringUtils.ts`）负责构建：

```
服务端：  "github"
工具名：  "create_pull_request"
结果：    "mcp__github__create_pull_request"
```

这种命名空间设计防止不同服务端工具之间的命名冲突，并在权限对话框中清晰显示工具所属的服务端。

---

## 6. 工具发现与注册

从"服务器已连接"到"工具对 Claude 可用"，需要经历几个步骤。

### 6.1 发现流程

```
connectToServer()
    │
    └── client.connect(transport)
         │
         └── 返回 ConnectedMCPServer
              │
              └── fetchToolsForClient(client)
                   │
                   └── client.request({ method: 'tools/list' })
                        │
                        └── toolsToProcess.map(tool => ({
                             ...MCPTool,      // 展开基础模板
                             name,            // 覆盖
                             call,            // 覆盖
                             ...              // 覆盖其他属性
                           }))
                              │
                              └── 注入 appState.mcpClients
                                   │
                                   └── getTools() 包含这些工具
                                        │
                                        └── AI 模型可以使用这些工具
```

### 6.2 fetchToolsForClient 函数

```typescript
// src/services/mcp/client.ts:1743-1750
export const fetchToolsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Tool[]> => {
    if (client.type !== 'connected') return []

    if (!client.capabilities?.tools) {
      return []  // 服务端不支持工具
    }

    const result = await client.client.request(
      { method: 'tools/list' },
      ListToolsResultSchema,
    )
    // ... 使用克隆模式映射为 Tool[]
  },
  MCP_FETCH_CACHE_SIZE,  // LRU 缓存：最多 20 个服务端
)
```

注意 `memoizeWithLRU`——将内存使用限制在 `MCP_FETCH_CACHE_SIZE = 20` 个服务端。如果没有这个限制，连接多个服务端会永久占用所有工具列表的内存。

### 6.3 IDE 服务端的工具过滤

IDE 插件服务端暴露许多工具，但 Claude Code 限制了可用的工具：

```typescript
// src/services/mcp/client.ts:568-573
const ALLOWED_IDE_TOOLS = ['mcp__ide__executeCode', 'mcp__ide__getDiagnostics']
function isIncludedMcpTool(tool: Tool): boolean {
  return (
    !tool.name.startsWith('mcp__ide__') || ALLOWED_IDE_TOOLS.includes(tool.name)
  )
}
```

这防止 IDE 插件意外暴露不应被 AI 访问的内部工具。

### 6.4 能力协商

获取工具之前，Claude Code 先检查服务器能力：

```typescript
// src/services/mcp/client.ts:1157-1183
const capabilities = client.getServerCapabilities()
const serverVersion = client.getServerVersion()
const rawInstructions = client.getInstructions()

logMCPDebug(name, `连接已建立，能力: ${jsonStringify({
  hasTools: !!capabilities?.tools,
  hasPrompts: !!capabilities?.prompts,
  hasResources: !!capabilities?.resources,
  hasResourceSubscribe: !!capabilities?.resources?.subscribe,
  serverVersion: serverVersion || 'unknown',
})}`)
```

如果 `capabilities.tools` 为假值，`fetchToolsForClient` 立即返回空数组，不发起 `tools/list` 请求。

### 6.5 批量连接管理

为高效处理多个 MCP 服务端，Claude Code 分批进行连接：

```typescript
// src/services/mcp/client.ts:552-560
export function getMcpServerConnectionBatchSize(): number {
  return parseInt(process.env.MCP_SERVER_CONNECTION_BATCH_SIZE || '', 10) || 3
}

function getRemoteMcpServerConnectionBatchSize(): number {
  return parseInt(process.env.MCP_REMOTE_SERVER_CONNECTION_BATCH_SIZE || '', 10) || 20
}
```

本地服务端（stdio、sdk）每批连接 3 个；远程服务端每批连接 20 个。远程服务端受网络并发限制而非 CPU 限制。

---

## 7. MCP 安全机制

Claude Code 的 MCP 实现采用分层安全策略，四种不同机制协同工作。

### 7.1 Channel 允许名单

Channel 系统（通过 Telegram、Discord 等插件提供的 MCP 服务端）要求服务端在由 GrowthBook feature flag 管理的允许名单中：

```typescript
// src/services/mcp/channelAllowlist.ts:37-43
export function getChannelAllowlist(): ChannelAllowlistEntry[] {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_harbor_ledger',
    [],
  )
  const parsed = ChannelAllowlistSchema().safeParse(raw)
  return parsed.success ? parsed.data : []
}
```

允许名单使用 `{marketplace, plugin}` 粒度（而非按服务端）的原因：
- 新增恶意服务端的插件本身已被攻破
- 按服务端的条目会在无害的插件重构时失效

### 7.2 与权限系统的集成

每个克隆 MCPTool 的 `checkPermissions` 实现会生成允许规则建议：

```typescript
// src/services/mcp/client.ts:1814-1831
async checkPermissions() {
  return {
    behavior: 'passthrough',
    message: 'MCPTool requires permission.',
    suggestions: [
      {
        type: 'addRules',
        rules: [{ toolName: fullyQualifiedName, ruleContent: undefined }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
  }
},
```

这与第七章权限系统集成——每次 MCP 工具调用都经过标准权限流程。

### 7.3 OAuth 2.0 认证

`ClaudeAuthProvider` 类（位于 `src/services/mcp/auth.ts`）实现了 MCP OAuth 客户端：

- 为 SSE 和 HTTP 服务端处理完整的 OAuth PKCE 流程
- 安全存储令牌（Mac 上使用 macOS Keychain，其他平台使用对应的安全存储）
- 实现 `sdkAuth`（初始授权）和 `sdkRefreshAuthorization`（令牌刷新）
- 将 `needs-auth` 状态缓存 15 分钟，避免重复提示

### 7.4 XAA — 跨应用访问

XAA（Cross-App Access）是 Claude Code 针对 MCP 服务端的企业 SSO 集成：

```typescript
// src/services/mcp/types.ts:37-55
const McpXaaConfigSchema = lazySchema(() => z.boolean())

const McpOAuthConfigSchema = lazySchema(() =>
  z.object({
    clientId: z.string().optional(),
    callbackPort: z.number().int().positive().optional(),
    authServerMetadataUrl: z.string().url().startsWith('https://').optional(),
    xaa: McpXaaConfigSchema().optional(),  // 为此服务端启用 XAA
  }),
)
```

当 `xaa: true` 时，Claude Code 在连接 MCP 服务端之前先与组织的 IdP 进行令牌交换。IdP 设置（issuer、clientId、callbackPort）全局配置一次，由所有启用 XAA 的服务端共享。

### 7.5 Channel 权限中继

对于 channel 服务端（Telegram、Discord 等），权限提示可以中继到消息平台：

```typescript
// src/services/mcp/channelPermissions.ts:36-38
export function isChannelPermissionRelayEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_permissions', false)
}
```

启用后，权限对话框同时向活跃 channel 发送审批请求。本地 UI 或 channel 的第一个响应获胜。这与 channel 系统本身独立控制——channel 可以先发布，权限中继随后跟进。

**安全说明**：被攻破的 channel 服务端可以伪造审批响应。这是被接受的风险，因为被攻破的 channel 服务端已有对话注入能力；对话框会拖慢攻击速度，但无法完全阻止。

### 7.6 敏感请求头脱敏

所有包含 `authorization` 的请求头在日志中都会被脱敏：

```typescript
// src/services/mcp/client.ts:752-755
const wsHeadersForLogging = mapValues(wsHeaders, (value, key) =>
  key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
)
```

---

## 8. MCP 作为服务端：暴露 Claude Code 的工具

当 Claude Code 以 `claude mcp serve` 运行时，它本身成为 MCP 服务端。具体实现在 `src/entrypoints/mcp.ts`。

### 8.1 服务端设置

```typescript
// src/entrypoints/mcp.ts:35-57
export async function startMCPServer(
  cwd: string,
  debug: boolean,
  verbose: boolean,
): Promise<void> {
  const READ_FILE_STATE_CACHE_SIZE = 100
  const readFileStateCache = createFileStateCacheWithSizeLimit(
    READ_FILE_STATE_CACHE_SIZE,
  )
  setCwd(cwd)
  const server = new Server(
    { name: 'claude/tengu', version: MACRO.VERSION },
    { capabilities: { tools: {} } },
  )
```

服务端名称 `claude/tengu` 是内部代号（天狗，日本神话中的生物）。

### 8.2 工具列表

```typescript
// src/entrypoints/mcp.ts:59-96
server.setRequestHandler(
  ListToolsRequestSchema,
  async (): Promise<ListToolsResult> => {
    const toolPermissionContext = getEmptyToolPermissionContext()
    const tools = getTools(toolPermissionContext)
    return {
      tools: await Promise.all(
        tools.map(async tool => {
          let outputSchema: ToolOutput | undefined
          if (tool.outputSchema) {
            const convertedSchema = zodToJsonSchema(tool.outputSchema)
            // MCP SDK 要求 outputSchema 在根级别有 type: "object"
            // 跳过根级别有 anyOf/oneOf 的 schema（来自 z.union）
            if (
              typeof convertedSchema === 'object' &&
              convertedSchema !== null &&
              'type' in convertedSchema &&
              convertedSchema.type === 'object'
            ) {
              outputSchema = convertedSchema as ToolOutput
            }
          }
          return {
            ...tool,
            description: await tool.prompt({ ... }),
            inputSchema: zodToJsonSchema(tool.inputSchema) as ToolInput,
            outputSchema,
          }
        }),
      ),
    }
  },
)
```

注意 schema 过滤：根级别有 `anyOf`/`oneOf` 的 schema（来自 `z.union`）从 `outputSchema` 中排除，因为 MCP SDK 要求根级别为 `type: "object"`。

### 8.3 工具调用

```typescript
// src/entrypoints/mcp.ts:99-186
server.setRequestHandler(
  CallToolRequestSchema,
  async ({ params: { name, arguments: args } }): Promise<CallToolResult> => {
    const toolPermissionContext = getEmptyToolPermissionContext()
    const tools = getTools(toolPermissionContext)
    const tool = findToolByName(tools, name)
    if (!tool) throw new Error(`Tool ${name} not found`)

    const toolUseContext: ToolUseContext = {
      // ...
      options: {
        // ...
        isNonInteractiveSession: true,  // 关键：禁用需要用户输入的提示
      },
    }

    const finalResult = await tool.call(
      (args ?? {}) as never,
      toolUseContext,
      hasPermissionsToUseTool,
      createAssistantMessage({ content: [] }),
    )
    // ...
  },
)
```

`isNonInteractiveSession: true` 至关重要——它禁用需要用户输入的提示，因为调用方是另一个 LLM，而非人类。

### 8.4 暴露的 MCP 命令

通过 MCP 暴露的命令只是 Claude Code 命令的子集：

```typescript
// src/entrypoints/mcp.ts:33
const MCP_COMMANDS: Command[] = [review]
```

目前只暴露了 `review` 命令。这是刻意保守的设计——并非所有命令都适合非交互式 MCP 场景。

### 8.5 服务端模式的传输层

```typescript
// src/entrypoints/mcp.ts:190-195
async function runServer() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

return await runServer()
```

Claude Code 作为 MCP 服务端只支持 stdio 传输。这意味着它始终以子进程方式被客户端调用——与大多数 MCP 服务端的工作方式一致。

---

## 9. InProcessTransport：零子进程通信

对于性能敏感的集成（Chrome 插件、Computer Use），Claude Code 通过在进程内运行 MCP 服务端来避免启动子进程。

### 9.1 Transport 接口

```typescript
// src/services/mcp/InProcessTransport.ts:1-3
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
```

MCP SDK 的 `Transport` 接口要求实现：
- `start(): Promise<void>` — 初始化传输
- `send(message: JSONRPCMessage): Promise<void>` — 发送消息
- `close(): Promise<void>` — 终止连接
- 事件处理器：`onclose?`、`onerror?`、`onmessage?`

### 9.2 InProcessTransport 实现

```typescript
// src/services/mcp/InProcessTransport.ts:11-49
class InProcessTransport implements Transport {
  private peer: InProcessTransport | undefined
  private closed = false

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  _setPeer(peer: InProcessTransport): void {
    this.peer = peer
  }

  async start(): Promise<void> {}   // 无操作：无需初始化网络

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error('Transport is closed')
    // 异步传递给对端，避免同步请求/响应循环导致的调用栈溢出
    queueMicrotask(() => {
      this.peer?.onmessage?.(message)
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
    // 如果对端尚未关闭，则关闭对端
    if (this.peer && !this.peer.closed) {
      this.peer.closed = true
      this.peer.onclose?.()
    }
  }
}
```

### 9.3 `queueMicrotask` 的设计决策

最值得关注的一行是：

```typescript
queueMicrotask(() => {
  this.peer?.onmessage?.(message)
})
```

**为什么不直接调用 `this.peer.onmessage(message)`？**

在 MCP 协议中，客户端发出请求 → 服务端响应 → 解决客户端的 Promise → 可能触发下一个请求……这创造了**同步的请求/响应循环**，深度嵌套的协议交换可能导致调用栈溢出。

`queueMicrotask` 通过将消息传递推迟到下一个微任务检查点来打破这些同步链。消息仍然"立即"传递（在任何宏任务如 setTimeout 之前），但不会增加调用栈帧。这与浏览器防止 Promise 链栈溢出的机制相同。

### 9.4 创建关联传输对

```typescript
// src/services/mcp/InProcessTransport.ts:57-63
export function createLinkedTransportPair(): [Transport, Transport] {
  const a = new InProcessTransport()
  const b = new InProcessTransport()
  a._setPeer(b)
  b._setPeer(a)
  return [a, b]
}
```

进程内服务端的使用模式：

```typescript
// src/services/mcp/client.ts:916-923
const context = createChromeContext(serverRef.env)
inProcessServer = createClaudeForChromeMcpServer(context)
const [clientTransport, serverTransport] = createLinkedTransportPair()
await inProcessServer.connect(serverTransport)
transport = clientTransport
```

服务端获得 `serverTransport`——它发送的消息出现在 `clientTransport.onmessage` 中。客户端获得 `clientTransport`——它发送的消息出现在 `serverTransport.onmessage` 中。从任一方的角度看，这与网络传输完全相同。

### 9.5 为什么使用进程内方案？

Chrome MCP 服务端的注释解释了原因：

```typescript
// src/services/mcp/client.ts:908-909
// 在进程内运行 Chrome MCP 服务端，避免启动约 325 MB 的子进程
```

325 MB 的浏览器自动化子进程开销非常显著，尤其是 Claude Code 需要频繁重启它的情况下。进程内方案避免了：
- 进程启动开销（100ms+）
- IPC 序列化开销
- 内存重复（子进程需要共享库的独立副本）

---

## 10. 动手实践：构建简单的 MCP 客户端

`examples/08-mcp-integration/mcp-client.ts` 中的示例实现了一个简化版 MCP 客户端，演示了本章的关键模式。

### 10.1 示例涵盖的内容

示例演示：

1. **传输抽象** — 从调用方角度，`stdio` 和 `http` 传输的创建方式完全相同
2. **连接生命周期** — pending → connected → 工具发现
3. **占位符模式** — 从 MCP 服务端响应创建与 `Tool` 兼容的对象
4. **工具调用** — 调用远程工具并处理结果
5. **连接清理** — 正确释放资源

### 10.2 运行示例

```bash
# 安装依赖
cd examples/08-mcp-integration
npm install

# 使用本地 MCP 服务端运行（需要 Node.js 18+）
npx ts-node mcp-client.ts stdio npx @modelcontextprotocol/server-filesystem /tmp

# 使用远程 HTTP 服务端运行
npx ts-node mcp-client.ts http http://localhost:3000
```

### 10.3 核心代码解析

示例的核心 `MCPClientDemo` 类展示了 Claude Code 的 `connectToServer` 和 `fetchToolsForClient` 如何协同工作：

```typescript
// 第一步：根据类型创建传输
const transport = createTransport(config)

// 第二步：创建并连接客户端
const client = new Client({ name: 'demo-client', version: '1.0.0' }, {
  capabilities: { roots: {} }
})
await client.connect(transport)

// 第三步：获取工具（对应 fetchToolsForClient）
const result = await client.request(
  { method: 'tools/list' },
  ListToolsResultSchema,
)

// 第四步：创建占位符工具（对应 MCPTool 克隆模式）
const tools = result.tools.map(serverTool => ({
  ...MCPToolBase,              // 基础占位符
  name: `mcp__demo__${serverTool.name}`,
  description: serverTool.description ?? '',
  inputSchema: serverTool.inputSchema,
  call: async (args: Record<string, unknown>) => {
    return client.request(
      { method: 'tools/call', params: { name: serverTool.name, arguments: args } },
      CallToolResultSchema,
    )
  },
}))
```

### 10.4 使用真实 MCP 服务端测试

以下 MCP 服务端可用于测试：

```bash
# 文件系统服务端——读写本地文件
npx @modelcontextprotocol/server-filesystem /path/to/dir

# 内存服务端——键值存储
npx @modelcontextprotocol/server-memory

# GitHub 服务端——GitHub API 访问（需要 GITHUB_TOKEN）
GITHUB_TOKEN=... npx @modelcontextprotocol/server-github
```

---

## 11. 核心要点与下一章

### 核心要点

1. **传输抽象是基础**：MCP 的六种传输类型都向客户端呈现相同的 `Transport` 接口。添加新传输方式无需修改工具处理代码。

2. **MCPTool 占位符模式**：Claude Code 不为每个工具创建独立的类，而是展开 `MCPTool` 并覆盖属性。在类型层面，MCP 工具与内置工具无法区分。

3. **多层记忆化**：连接按 `{name, config}` 记忆化，工具列表按客户端引用记忆化（LRU 限制为 20 个）。缓存失效在 `onclose` 时触发，下次工具调用时重连。

4. **双重角色架构**：Claude Code 同时是 MCP 客户端（连接外部服务端）和 MCP 服务端（可被其他 LLM 调用）。这支持多智能体层级结构。

5. **InProcessTransport 的 `queueMicrotask`**：`send()` 中的微任务延迟防止同步请求/响应循环导致调用栈溢出——一个微妙但至关重要的正确性决策。

6. **安全分层**：Channel 允许名单、权限系统、OAuth 2.0、XAA 企业 SSO 各自应对不同的威胁模型，单独任何一个都不够。

### 与前几章的联系

- `MCPTool` 模式直接建立在**工具系统**（第三章）之上——MCP 工具满足与内置工具相同的 `ToolDef` 接口
- MCP 权限集成**权限系统**（第七章）——`checkPermissions` 返回 `passthrough`，与需要人工审批的工具相同
- `InProcessTransport` 使用与服务层（第六章）相同的资源管理模式

### 下一章预告

**第九章：智能体协调** 探索 Claude Code 如何编排并行子智能体——包括 MCP 工具如何在智能体之间传递、工具调用如何在并发智能体实例间去重，以及实现多智能体协调的 `AgentTool`。

---

*本章引用的源文件：*
- `src/services/mcp/types.ts` — 传输和连接类型定义
- `src/services/mcp/client.ts` — MCP 客户端核心逻辑、连接管理、工具发现
- `src/services/mcp/auth.ts` — OAuth 2.0 认证提供器
- `src/services/mcp/InProcessTransport.ts` — 零子进程进程内传输
- `src/services/mcp/channelAllowlist.ts` — Channel 插件安全允许名单
- `src/services/mcp/channelPermissions.ts` — Channel 权限中继
- `src/tools/MCPTool/MCPTool.ts` — MCPTool 占位符定义
- `src/entrypoints/mcp.ts` — Claude Code 作为 MCP 服务端
