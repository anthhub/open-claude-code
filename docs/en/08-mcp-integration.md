# Chapter 8: MCP Integration

> **Difficulty:** Advanced | **Reading time:** ~75 minutes

---

## Table of Contents

1. [Introduction: What is MCP?](#1-introduction-what-is-mcp)
2. [MCP Architecture in Claude Code: Dual Role](#2-mcp-architecture-in-claude-code-dual-role)
3. [Transport Layer: Six Protocols](#3-transport-layer-six-protocols)
4. [Server Connection Lifecycle](#4-server-connection-lifecycle)
5. [MCPTool: The Placeholder Pattern](#5-mcptool-the-placeholder-pattern)
6. [Tool Discovery & Registration](#6-tool-discovery--registration)
7. [MCP Security](#7-mcp-security)
8. [MCP as Server: Exposing Claude Code's Tools](#8-mcp-as-server-exposing-claude-codes-tools)
9. [InProcessTransport: Zero-Subprocess Communication](#9-inprocesstransport-zero-subprocess-communication)
10. [Hands-on: Build a Simple MCP Client](#10-hands-on-build-a-simple-mcp-client)
11. [Key Takeaways & What's Next](#11-key-takeaways--whats-next)

---

## 1. Introduction: What is MCP?

**Model Context Protocol (MCP)** is an open protocol by Anthropic that standardizes how AI models communicate with external tools and data sources. Think of it as the "USB standard" for AI tooling: any MCP-compliant server can plug into any MCP-compliant client without custom integration code.

### Why MCP Matters

Before MCP, every AI tool integration was bespoke — a Slack integration looked nothing like a GitHub integration. Developers had to write custom adapters, handle different authentication patterns, and maintain N separate implementations.

MCP defines a single protocol with:

| Concept | Description |
|---|---|
| **Tools** | Callable functions the AI can invoke |
| **Resources** | Data sources the AI can read |
| **Prompts** | Reusable prompt templates |
| **Elicitation** | Server-to-client user input requests |

The protocol runs over JSON-RPC 2.0 and supports multiple transports (stdio, HTTP, WebSocket, SSE).

### The MCP Specification Architecture

```
┌─────────────────────────────────────────────┐
│                MCP Client                    │
│  (Claude Code, IDE extensions, etc.)         │
└──────────────┬──────────────────────────────┘
               │  JSON-RPC 2.0 over Transport
               ▼
┌─────────────────────────────────────────────┐
│                MCP Server                    │
│  (filesystem, databases, web APIs, etc.)     │
└─────────────────────────────────────────────┘
```

Claude Code's integration is unusual because it plays **both roles simultaneously** — a detail we'll explore in depth.

---

## 2. MCP Architecture in Claude Code: Dual Role

Claude Code occupies a unique position in the MCP ecosystem: it functions as both an **MCP client** (connecting to external servers) and an **MCP server** (exposing its own tools to other clients).

### 2.1 As MCP Client

When Claude Code connects to an MCP server, it:

1. Establishes a transport connection (stdio, SSE, HTTP, etc.)
2. Negotiates capabilities via the MCP handshake
3. Fetches the server's tool list (`tools/list`)
4. Wraps each tool as a local `Tool` object using the `MCPTool` placeholder pattern
5. Injects these tools into the AI's available toolset

The connection management lives in `src/services/mcp/client.ts`, the tool wrapping in `src/tools/MCPTool/MCPTool.ts`.

### 2.2 As MCP Server

Claude Code can expose its own tools to external clients via `claude mcp serve`. This is defined in `src/entrypoints/mcp.ts`:

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

This dual-role design means Claude Code can be orchestrated by external LLMs while itself orchestrating other MCP servers — enabling multi-agent hierarchies.

### 2.3 The Dual Role Diagram

```
┌──────────────────────────────────────────────────────┐
│                   Claude Code                         │
│                                                       │
│  ┌─────────────────┐    ┌──────────────────────────┐ │
│  │   MCP Client    │    │      MCP Server          │ │
│  │                 │    │  (claude mcp serve)      │ │
│  │ - Connects to   │    │                          │ │
│  │   external MCP  │    │ - Exposes Read, Write,   │ │
│  │   servers       │    │   Bash, and other tools  │ │
│  │ - Fetches tools │    │ - Accepts connections    │ │
│  │ - Calls tools   │    │   from other LLMs        │ │
│  └────────┬────────┘    └──────────────┬───────────┘ │
└───────────┼──────────────────────────  │─────────────┘
            │                            │
   connects to                    listens for
            │                            │
     ┌──────▼──────┐            ┌────────▼────────┐
     │ External    │            │ External LLM    │
     │ MCP Servers │            │ Client          │
     │ (databases, │            │ (another Claude │
     │ APIs, etc.) │            │ instance, etc.) │
     └─────────────┘            └─────────────────┘
```

---

## 3. Transport Layer: Six Protocols

The transport layer is where MCP's flexibility shines. Claude Code supports **six distinct transport types**, each designed for different deployment scenarios.

### 3.1 Transport Type Definitions

Defined in `src/services/mcp/types.ts:23-26`:

```typescript
export const TransportSchema = lazySchema(() =>
  z.enum(['stdio', 'sse', 'sse-ide', 'http', 'ws', 'sdk']),
)
export type Transport = z.infer<ReturnType<typeof TransportSchema>>
```

Plus two internal-only variants: `sse-ide`, `ws-ide`, and `claudeai-proxy`.

### 3.2 Transport Comparison Table

| Transport | Protocol | Auth | Use Case | Config Key |
|---|---|---|---|---|
| `stdio` | Process stdin/stdout | None (env vars) | Local CLI tools | `command`, `args` |
| `sse` | HTTP Server-Sent Events | OAuth 2.0 / headers | Remote APIs, cloud services | `url`, `headers` |
| `sse-ide` | SSE (IDE-specific) | Token in lockfile | VS Code / JetBrains extensions | `url`, `ideName` |
| `http` | Streamable HTTP | OAuth 2.0 / headers | Modern REST-compatible servers | `url`, `headers` |
| `ws` | WebSocket | Headers / OAuth | Bidirectional streaming | `url`, `headers` |
| `sdk` | In-process (no network) | N/A | Agent SDK integration | `name` |

### 3.3 stdio — The Local Standard

The most common transport for local tools. Claude Code spawns a subprocess and communicates over stdin/stdout:

```typescript
// src/services/mcp/client.ts:950-958
transport = new StdioClientTransport({
  command: finalCommand,
  args: finalArgs,
  env: {
    ...subprocessEnv(),
    ...serverRef.env,
  } as Record<string, string>,
  stderr: 'pipe', // prevents error output from printing to UI
})
```

The `stderr: 'pipe'` is important — it prevents the MCP server's diagnostic output from cluttering the terminal UI.

**Configuration example:**

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

### 3.4 SSE — Server-Sent Events

For remote servers, SSE provides a long-lived HTTP connection that servers use to push events. Claude Code wraps it with OAuth and timeout handling:

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

// IMPORTANT: eventSourceInit uses fetch WITHOUT timeout wrapper
// because SSE connections are long-lived (indefinitely open)
transportOptions.eventSourceInit = {
  fetch: async (url, init) => { /* auth-aware fetch */ }
}
```

Note the critical design decision: the EventSource connection does NOT use the timeout wrapper, because SSE streams are meant to stay open indefinitely. Only individual POST requests get the 60-second timeout.

### 3.5 HTTP — Streamable HTTP (Modern Standard)

The MCP Streamable HTTP transport is the modern successor to SSE. It uses a single endpoint that serves both JSON and SSE:

```typescript
// src/services/mcp/client.ts:469-471
// MCP Streamable HTTP spec requires clients to advertise acceptance
// of both JSON and SSE on every POST. Servers that enforce this strictly
// reject requests without it (HTTP 406).
const MCP_STREAMABLE_HTTP_ACCEPT = 'application/json, text/event-stream'
```

The `wrapFetchWithTimeout` function (lines 492-549) is carefully designed to:
1. Skip timeout for GET requests (long-lived SSE streams)
2. Apply 60-second timeout to POST requests
3. Use `setTimeout` instead of `AbortSignal.timeout()` to avoid Bun's lazy GC memory issue (~2.4KB per request)

### 3.6 WebSocket — Bidirectional Streaming

WebSocket (`ws`) supports bidirectional streaming for real-time applications. The `ws-ide` variant is for IDE extensions:

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
  // Bun and Node.js require different WebSocket constructor signatures
  if (typeof Bun !== 'undefined') {
    wsClient = new globalThis.WebSocket(serverRef.url, { ... })
  } else {
    wsClient = await createNodeWsClient(serverRef.url, { ... })
  }
}
```

### 3.7 SDK — In-Process Transport

The `sdk` transport type is special — it uses `InProcessTransport` to run an MCP server in the same process without any network overhead:

```typescript
// src/services/mcp/client.ts:866-867
} else if (serverRef.type === 'sdk') {
  throw new Error('SDK servers should be handled in print.ts')
}
```

SDK servers are handled separately through `setupSdkMcpClients` because they don't go through `connectToServer` — they're set up programmatically by the Agent SDK.

### 3.8 Transport Selection Flow

```
Config type?
    │
    ├── 'stdio' (or undefined) ─────────────┐
    │       └── Chrome/ComputerUse name? ───┼── InProcessTransport
    │           └── No ────────────────────► StdioClientTransport
    │
    ├── 'sse' ────────────────────────────► SSEClientTransport + OAuth
    │
    ├── 'sse-ide' ────────────────────────► SSEClientTransport (no auth)
    │
    ├── 'ws-ide' ─────────────────────────► WebSocketTransport + auth token
    │
    ├── 'ws' ─────────────────────────────► WebSocketTransport + headers
    │
    ├── 'http' ───────────────────────────► StreamableHTTPClientTransport + OAuth
    │
    ├── 'claudeai-proxy' ─────────────────► StreamableHTTPClientTransport + Claude.ai OAuth
    │
    └── 'sdk' ────────────────────────────► Error (handled elsewhere)
```

---

## 4. Server Connection Lifecycle

Understanding how connections are managed is crucial for building reliable MCP integrations.

### 4.1 State Machine

Each MCP server connection moves through well-defined states, defined in `src/services/mcp/types.ts:179-226`:

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
              │ onclose (connection dropped)
              ▼
        memoize cache cleared
              │
              │ next tool call
              ▼
        reconnects (pending again)
```

### 4.2 The ConnectedMCPServer Type

A successfully connected server carries the full client reference:

```typescript
// src/services/mcp/types.ts:180-192
export type ConnectedMCPServer = {
  client: Client          // The MCP SDK client instance
  name: string
  type: 'connected'
  capabilities: ServerCapabilities
  serverInfo?: {
    name: string
    version: string
  }
  instructions?: string   // Truncated to MAX_MCP_DESCRIPTION_LENGTH (2048)
  config: ScopedMcpServerConfig
  cleanup: () => Promise<void>
}
```

The `instructions` field is notable: MCP servers can provide system instructions, but Claude Code truncates them to 2048 characters to prevent OpenAPI-generated servers from dumping megabytes of documentation.

### 4.3 Memoized Connection Cache

The `connectToServer` function uses lodash `memoize` with a custom cache key:

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

**Why memoize?** Connecting to a server is expensive (network handshake, capability negotiation). The cache means multiple concurrent tool calls to the same server reuse one connection.

**Cache invalidation** happens in `client.onclose`:

```typescript
// src/services/mcp/client.ts:1384-1396
client.onclose = () => {
  // Clear all fetch caches too — reconnection needs fresh tools/resources
  fetchToolsForClient.cache.delete(name)
  fetchResourcesForClient.cache.delete(name)
  fetchCommandsForClient.cache.delete(name)
  connectToServer.cache.delete(key)
}
```

### 4.4 Connection Timeout & Retry Logic

Connections have a configurable timeout (default 30 seconds, `MCP_TIMEOUT` env var):

```typescript
// src/services/mcp/client.ts:1048-1077
const connectPromise = client.connect(transport)
const timeoutPromise = new Promise<never>((_, reject) => {
  const timeoutId = setTimeout(() => {
    transport.close().catch(() => {})
    reject(new Error(`MCP server "${name}" connection timed out`))
  }, getConnectionTimeoutMs())

  // Clean up timeout if connect resolves or rejects
  connectPromise.then(
    () => clearTimeout(timeoutId),
    _error => clearTimeout(timeoutId),
  )
})

await Promise.race([connectPromise, timeoutPromise])
```

For terminal connection errors (ECONNRESET, ETIMEDOUT, EPIPE, etc.), Claude Code tracks `consecutiveConnectionErrors` and triggers reconnection after `MAX_ERRORS_BEFORE_RECONNECT = 3` consecutive failures:

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

### 4.5 Auth Cache

To avoid hammering servers that need OAuth, Claude Code caches `needs-auth` state for 15 minutes:

```typescript
// src/services/mcp/client.ts:257-288
const MCP_AUTH_CACHE_TTL_MS = 15 * 60 * 1000 // 15 min

async function isMcpAuthCached(serverId: string): Promise<boolean> {
  const cache = await getMcpAuthCache()
  const entry = cache[serverId]
  if (!entry) return false
  return Date.now() - entry.timestamp < MCP_AUTH_CACHE_TTL_MS
}
```

Writes to this cache are serialized through a promise chain to prevent concurrent read-modify-write races:

```typescript
// src/services/mcp/client.ts:291-309
let writeChain = Promise.resolve()

function setMcpAuthCacheEntry(serverId: string): void {
  writeChain = writeChain.then(async () => {
    // atomic read-modify-write
  })
}
```

---

## 5. MCPTool: The Placeholder Pattern

This is one of the most elegant patterns in Claude Code's codebase: a single `MCPTool` object acts as a **prototype** that gets cloned and overridden for each real MCP tool.

### 5.1 The Placeholder Definition

`src/tools/MCPTool/MCPTool.ts` defines a minimal, non-functional tool:

```typescript
// src/tools/MCPTool/MCPTool.ts:27-77
export const MCPTool = buildTool({
  isMcp: true,
  // Overridden in mcpClient.ts with the real MCP tool name + args
  isOpenWorld() { return false },
  // Overridden in mcpClient.ts
  name: 'mcp',
  maxResultSizeChars: 100_000,
  // Overridden in mcpClient.ts
  async description() { return DESCRIPTION },
  // Overridden in mcpClient.ts
  async prompt() { return PROMPT },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  // Overridden in mcpClient.ts
  async call() { return { data: '' } },
  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'passthrough', message: 'MCPTool requires permission.' }
  },
  // ...
})
```

The comments "Overridden in mcpClient.ts" appear **six times** — this is the entire purpose of `MCPTool`. It's a structural template, not a functional tool.

### 5.2 The Clone-and-Override Pattern

In `client.ts`'s `fetchToolsForClient`, each MCP tool from the server becomes a spread of `MCPTool` with real implementations substituted:

```typescript
// src/services/mcp/client.ts:1766-1832
return toolsToProcess.map((tool): Tool => {
  const fullyQualifiedName = buildMcpToolName(client.name, tool.name)
  return {
    ...MCPTool,                    // Spread: inherit all defaults
    name: fullyQualifiedName,      // Override: mcp__serverName__toolName
    mcpInfo: { serverName: client.name, toolName: tool.name },
    isMcp: true,

    async description() {
      return tool.description ?? ''        // Override: real description
    },
    async prompt() {
      const desc = tool.description ?? ''
      return desc.length > MAX_MCP_DESCRIPTION_LENGTH
        ? desc.slice(0, MAX_MCP_DESCRIPTION_LENGTH) + '… [truncated]'
        : desc
    },
    inputJSONSchema: tool.inputSchema as Tool['inputJSONSchema'],

    async call(args, context, _canUseTool, parentMessage, onProgress?) {
      // Override: real implementation that calls the MCP server
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

### 5.3 Why This Pattern?

**Alternative approaches and why they were rejected:**

1. **Separate class per MCP tool** — would require dynamic class creation at runtime, complex prototype chains, harder to type-check
2. **Generic wrapper class** — would require all callers to know about the wrapper, breaking the uniform `Tool` interface
3. **Function factory** — similar to what they do, but without the structural benefit of spreading from a canonical template

The spread pattern has three key benefits:
- **Type safety**: TypeScript enforces that the result satisfies `ToolDef<InputSchema, Output>`
- **Default propagation**: Properties like `maxResultSizeChars`, `renderToolUseMessage`, etc. are inherited automatically
- **Minimal code per tool**: Only the varying properties (name, description, call, permissions) need to be specified

### 5.4 Tool Name Normalization

MCP tool names follow a hierarchical namespace: `mcp__<serverName>__<toolName>`. The `buildMcpToolName` function (in `src/services/mcp/mcpStringUtils.ts`) handles construction:

```
Server: "github"
Tool:   "create_pull_request"
Result: "mcp__github__create_pull_request"
```

This namespacing prevents collisions between tools from different servers and makes it visually clear in permission dialogs which server a tool belongs to.

---

## 6. Tool Discovery & Registration

The flow from "server connected" to "tools available to Claude" involves several steps.

### 6.1 Discovery Flow

```
connectToServer()
    │
    └── client.connect(transport)
         │
         └── ConnectedMCPServer returned
              │
              └── fetchToolsForClient(client)
                   │
                   └── client.request({ method: 'tools/list' })
                        │
                        └── toolsToProcess.map(tool => ({
                             ...MCPTool,      // Spread base
                             name,            // Override
                             call,            // Override
                             ...              // Override others
                           }))
                              │
                              └── Injected into appState.mcpClients
                                   │
                                   └── getTools() includes these tools
                                        │
                                        └── Available to the AI model
```

### 6.2 The fetchToolsForClient Function

```typescript
// src/services/mcp/client.ts:1743-1750
export const fetchToolsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Tool[]> => {
    if (client.type !== 'connected') return []

    if (!client.capabilities?.tools) {
      return []  // Server doesn't support tools
    }

    const result = await client.client.request(
      { method: 'tools/list' },
      ListToolsResultSchema,
    )
    // ... map to Tool[] using the clone pattern
  },
  MCP_FETCH_CACHE_SIZE,  // LRU cache: max 20 servers
)
```

Note the `memoizeWithLRU` — this bounds memory usage to `MCP_FETCH_CACHE_SIZE = 20` servers. Without this, connecting to many servers would keep all their tool lists in memory forever.

### 6.3 Tool Filtering for IDE Servers

IDE extension servers expose many tools, but Claude Code restricts which ones are usable:

```typescript
// src/services/mcp/client.ts:568-573
const ALLOWED_IDE_TOOLS = ['mcp__ide__executeCode', 'mcp__ide__getDiagnostics']
function isIncludedMcpTool(tool: Tool): boolean {
  return (
    !tool.name.startsWith('mcp__ide__') || ALLOWED_IDE_TOOLS.includes(tool.name)
  )
}
```

This prevents IDE extensions from accidentally exposing internal tools that shouldn't be AI-accessible.

### 6.4 Capability Negotiation

Before fetching tools, Claude Code checks server capabilities:

```typescript
// src/services/mcp/client.ts:1157-1183
const capabilities = client.getServerCapabilities()
const serverVersion = client.getServerVersion()
const rawInstructions = client.getInstructions()

logMCPDebug(name, `Connection established with capabilities: ${jsonStringify({
  hasTools: !!capabilities?.tools,
  hasPrompts: !!capabilities?.prompts,
  hasResources: !!capabilities?.resources,
  hasResourceSubscribe: !!capabilities?.resources?.subscribe,
  serverVersion: serverVersion || 'unknown',
})}`)
```

If `capabilities.tools` is falsy, `fetchToolsForClient` returns an empty array immediately without making a `tools/list` request.

### 6.5 Batch Connection Management

To handle many MCP servers efficiently, Claude Code connects in batches:

```typescript
// src/services/mcp/client.ts:552-560
export function getMcpServerConnectionBatchSize(): number {
  return parseInt(process.env.MCP_SERVER_CONNECTION_BATCH_SIZE || '', 10) || 3
}

function getRemoteMcpServerConnectionBatchSize(): number {
  return parseInt(process.env.MCP_REMOTE_SERVER_CONNECTION_BATCH_SIZE || '', 10) || 20
}
```

Local (stdio, sdk) servers connect 3 at a time; remote servers connect 20 at a time. Remote servers are limited by network concurrency rather than CPU.

---

## 7. MCP Security

Security is layered in Claude Code's MCP implementation. Four distinct mechanisms work together.

### 7.1 Channel Allowlist

The channel system (plugin-provided MCP servers via Telegram, Discord, etc.) requires servers to be on an allowlist managed via GrowthBook feature flags:

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

The allowlist uses `{marketplace, plugin}` granularity (not per-server) because:
- A plugin that adds a malicious second server is already compromised
- Per-server entries would break on harmless plugin refactors

### 7.2 Permission System Integration

Each cloned MCPTool's `checkPermissions` implementation generates allow-rule suggestions:

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

This integrates with the Chapter 7 permission system — every MCP tool call goes through the standard permission flow.

### 7.3 OAuth 2.0 Authentication

The `ClaudeAuthProvider` class (in `src/services/mcp/auth.ts`) implements the MCP OAuth client:

- Handles the full OAuth PKCE flow for SSE and HTTP servers
- Stores tokens securely (macOS Keychain on Mac, platform-appropriate storage elsewhere)
- Implements `sdkAuth` (initial authorization) and `sdkRefreshAuthorization` (token refresh)
- Caches `needs-auth` state for 15 minutes to avoid repeated prompts

### 7.4 XAA — Cross-App Access

XAA (Cross-App Access) is Claude Code's enterprise SSO integration for MCP servers:

```typescript
// src/services/mcp/types.ts:37-55
const McpXaaConfigSchema = lazySchema(() => z.boolean())

const McpOAuthConfigSchema = lazySchema(() =>
  z.object({
    clientId: z.string().optional(),
    callbackPort: z.number().int().positive().optional(),
    authServerMetadataUrl: z.string().url().startsWith('https://').optional(),
    xaa: McpXaaConfigSchema().optional(),  // Enable XAA for this server
  }),
)
```

When `xaa: true`, Claude Code performs a token exchange with the organization's IdP before connecting to the MCP server. The IdP settings (issuer, clientId, callbackPort) are configured once globally and shared across all XAA-enabled servers.

### 7.5 Channel Permission Relay

For channel servers (Telegram, Discord, etc.), permission prompts can be relayed to the messaging platform:

```typescript
// src/services/mcp/channelPermissions.ts:36-38
export function isChannelPermissionRelayEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_permissions', false)
}
```

When enabled, a permission dialog simultaneously sends an approval request to the active channel. The first response (local UI or channel) wins. This is gated separately from the channel system itself — channels can ship without permission relay.

**Security note**: A compromised channel server could fabricate approval responses. This is accepted risk because a compromised channel server already has conversation-injection capability; the dialog slows it, doesn't stop it.

### 7.6 Sensitive Header Redaction

All headers containing `authorization` are redacted before logging:

```typescript
// src/services/mcp/client.ts:752-755
const wsHeadersForLogging = mapValues(wsHeaders, (value, key) =>
  key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
)
```

---

## 8. MCP as Server: Exposing Claude Code's Tools

When Claude Code runs as `claude mcp serve`, it becomes an MCP server itself. This is defined in `src/entrypoints/mcp.ts`.

### 8.1 Server Setup

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

The server name `claude/tengu` is the internal codename (Tengu = 天狗, a Japanese mythological figure).

### 8.2 Listing Tools

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
            // MCP SDK requires outputSchema to have type: "object" at root level
            // Skip schemas with anyOf/oneOf at root (from z.union)
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

Note the schema filtering: schemas with `anyOf`/`oneOf` at root (from `z.union`) are excluded from `outputSchema` because the MCP SDK requires `type: "object"` at the root level.

### 8.3 Calling Tools

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
      abortController: createAbortController(),
      options: {
        commands: MCP_COMMANDS,
        tools,
        mainLoopModel: getMainLoopModel(),
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        // ...
      },
      // ...
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

The `isNonInteractiveSession: true` is crucial — it disables prompts that would require user input, since the caller is another LLM, not a human.

### 8.4 MCP Commands Exposed

Only a subset of Claude Code's commands are exposed via MCP:

```typescript
// src/entrypoints/mcp.ts:33
const MCP_COMMANDS: Command[] = [review]
```

Currently only the `review` command is exposed. This is conservative by design — not all commands make sense in a non-interactive MCP context.

### 8.5 Transport for Server Mode

```typescript
// src/entrypoints/mcp.ts:190-195
async function runServer() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

return await runServer()
```

Claude Code as MCP server only supports stdio transport. This means it's always invoked as a subprocess by the client — consistent with how most MCP servers work.

---

## 9. InProcessTransport: Zero-Subprocess Communication

For performance-critical integrations (Chrome extension, Computer Use), Claude Code avoids spawning subprocesses by running MCP servers in-process.

### 9.1 The Transport Interface

```typescript
// src/services/mcp/InProcessTransport.ts:1-3
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
```

The MCP SDK's `Transport` interface requires:
- `start(): Promise<void>` — initialize the transport
- `send(message: JSONRPCMessage): Promise<void>` — send a message
- `close(): Promise<void>` — terminate the connection
- Event handlers: `onclose?`, `onerror?`, `onmessage?`

### 9.2 The InProcessTransport Implementation

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

  async start(): Promise<void> {}   // No-op: no network to initialize

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error('Transport is closed')
    // Deliver to the other side asynchronously to avoid stack depth issues
    // with synchronous request/response cycles
    queueMicrotask(() => {
      this.peer?.onmessage?.(message)
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
    // Close the peer if it hasn't already closed
    if (this.peer && !this.peer.closed) {
      this.peer.closed = true
      this.peer.onclose?.()
    }
  }
}
```

### 9.3 The `queueMicrotask` Design Decision

The most interesting line is:

```typescript
queueMicrotask(() => {
  this.peer?.onmessage?.(message)
})
```

**Why not call `this.peer.onmessage(message)` directly?**

In the MCP protocol, a request from client triggers a response from server, which resolves a promise in the client, which may trigger another request... This creates **synchronous request/response cycles** that can overflow the call stack with deeply nested protocol exchanges.

`queueMicrotask` breaks these synchronous chains by deferring delivery to the next microtask checkpoint. The message is still delivered "immediately" (before any macro-tasks like setTimeout), but without adding stack frames. This is the same mechanism browsers use to prevent stack overflow in Promise chains.

### 9.4 Creating Linked Transport Pairs

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

Usage pattern for in-process servers:

```typescript
// src/services/mcp/client.ts:916-923
const context = createChromeContext(serverRef.env)
inProcessServer = createClaudeForChromeMcpServer(context)
const [clientTransport, serverTransport] = createLinkedTransportPair()
await inProcessServer.connect(serverTransport)
transport = clientTransport
```

The server gets `serverTransport` — messages it sends appear on `clientTransport.onmessage`. The client gets `clientTransport` — messages it sends appear on `serverTransport.onmessage`. From either side's perspective, it looks exactly like a network transport.

### 9.5 Why In-Process?

The Chrome MCP server comment explains:

```typescript
// src/services/mcp/client.ts:908-909
// Run the Chrome MCP server in-process to avoid spawning a ~325 MB subprocess
```

A 325 MB subprocess for a browser automation server is significant, especially if Claude Code needs to restart it frequently. In-process avoids:
- Process spawn overhead (~100ms+)
- IPC serialization overhead
- Memory duplication (the subprocess would need its own copy of shared libraries)

---

## 10. Hands-on: Build a Simple MCP Client

The example at `examples/08-mcp-integration/mcp-client.ts` implements a simplified MCP client that demonstrates the key patterns from this chapter.

### 10.1 What the Example Covers

The example demonstrates:

1. **Transport abstraction** — how `stdio` and `http` transports are created identically from the caller's perspective
2. **Connection lifecycle** — pending → connected → tool discovery
3. **The placeholder pattern** — creating `Tool`-compatible objects from MCP server responses
4. **Tool invocation** — calling a remote tool and handling results
5. **Connection cleanup** — proper resource disposal

### 10.2 Running the Example

```bash
# Install dependencies
cd examples/08-mcp-integration
npm install

# Run with a local MCP server (requires Node.js 18+)
npx ts-node mcp-client.ts stdio npx @modelcontextprotocol/server-filesystem /tmp

# Run with a remote HTTP server
npx ts-node mcp-client.ts http http://localhost:3000
```

### 10.3 Key Code Walkthrough

The example's core `MCPClientDemo` class mirrors how Claude Code's `connectToServer` and `fetchToolsForClient` work together:

```typescript
// Step 1: Create transport based on type
const transport = createTransport(config)

// Step 2: Create and connect client
const client = new Client({ name: 'demo-client', version: '1.0.0' }, {
  capabilities: { roots: {} }
})
await client.connect(transport)

// Step 3: Fetch tools (mirrors fetchToolsForClient)
const result = await client.request(
  { method: 'tools/list' },
  ListToolsResultSchema,
)

// Step 4: Create placeholder tools (mirrors the MCPTool clone pattern)
const tools = result.tools.map(serverTool => ({
  ...MCPToolBase,              // Base placeholder
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

### 10.4 Testing with Real MCP Servers

Several MCP servers are available for testing:

```bash
# Filesystem server — reads/writes local files
npx @modelcontextprotocol/server-filesystem /path/to/dir

# Memory server — key-value storage
npx @modelcontextprotocol/server-memory

# GitHub server — GitHub API access (requires GITHUB_TOKEN)
GITHUB_TOKEN=... npx @modelcontextprotocol/server-github
```

---

## 11. Key Takeaways & What's Next

### Key Takeaways

1. **Transport abstraction is the foundation**: MCP's six transport types all present the same `Transport` interface to the client. Adding new transports doesn't require changing tool-handling code.

2. **The MCPTool placeholder pattern**: Rather than creating unique classes per tool, Claude Code spreads `MCPTool` and overrides properties. This keeps MCP tools indistinguishable from built-in tools at the type level.

3. **Memoization at multiple layers**: Connections are memoized by `{name, config}`, tool lists are memoized by client reference (LRU-bounded to 20). Cache invalidation happens on `onclose`, which triggers reconnection on the next tool call.

4. **Dual role architecture**: Claude Code is simultaneously an MCP client (connecting to external servers) and an MCP server (exposable to other LLMs). This enables multi-agent hierarchies.

5. **InProcessTransport's `queueMicrotask`**: The microtask deferral in `send()` prevents call stack overflow in synchronous request/response cycles — a subtle but critical correctness decision.

6. **Security is layered**: Channel allowlist, permission system, OAuth 2.0, and XAA enterprise SSO each address a different threat model. None is sufficient alone.

### Connection to Previous Chapters

- The `MCPTool` pattern builds directly on the **Tool System** (Chapter 3) — MCP tools satisfy the same `ToolDef` interface as built-in tools
- MCP permissions integrate with the **Permission System** (Chapter 7) — `checkPermissions` returns `passthrough` just like tools requiring human approval
- The `InProcessTransport` uses the same Service Layer patterns (Chapter 6) for resource management

### What's Next

**Chapter 9: Agent Coordination** explores how Claude Code orchestrates parallel sub-agents — including how MCP tools are passed between agents, how tool calls are deduplicated across concurrent agent instances, and the `AgentTool` that makes multi-agent coordination possible.

---

*Source files referenced in this chapter:*
- `src/services/mcp/types.ts` — Transport and connection type definitions
- `src/services/mcp/client.ts` — Core MCP client logic, connection management, tool discovery
- `src/services/mcp/auth.ts` — OAuth 2.0 authentication provider
- `src/services/mcp/InProcessTransport.ts` — Zero-subprocess in-process transport
- `src/services/mcp/channelAllowlist.ts` — Channel plugin security allowlist
- `src/services/mcp/channelPermissions.ts` — Channel permission relay
- `src/tools/MCPTool/MCPTool.ts` — The MCPTool placeholder definition
- `src/entrypoints/mcp.ts` — Claude Code as MCP server
