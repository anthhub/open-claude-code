/**
 * examples/08-mcp-integration/mcp-client.ts
 *
 * A simplified MCP client demonstrating the key patterns from Chapter 8:
 *   1. Transport abstraction (stdio vs HTTP)
 *   2. Connection lifecycle (connect → discover → call)
 *   3. The MCPTool placeholder / clone pattern
 *   4. Tool discovery via tools/list
 *   5. Tool invocation via tools/call
 *   6. Proper resource cleanup
 *
 * Usage:
 *   npx ts-node mcp-client.ts stdio npx @modelcontextprotocol/server-filesystem /tmp
 *   npx ts-node mcp-client.ts http http://localhost:3000
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  type Tool as McpServerTool,
} from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

// ---------------------------------------------------------------------------
// Types — mirrors Claude Code's src/services/mcp/types.ts
// ---------------------------------------------------------------------------

type TransportType = 'stdio' | 'http'

interface StdioConfig {
  type: 'stdio'
  command: string
  args: string[]
}

interface HttpConfig {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

type ServerConfig = StdioConfig | HttpConfig

/**
 * Connection state machine — mirrors Claude Code's MCPServerConnection union:
 *   ConnectedMCPServer | FailedMCPServer | NeedsAuthMCPServer | PendingMCPServer | DisabledMCPServer
 */
type ConnectionState =
  | { type: 'pending' }
  | { type: 'connected'; client: Client; capabilities: Record<string, unknown> }
  | { type: 'failed'; error: string }

// ---------------------------------------------------------------------------
// Placeholder Tool — mirrors src/tools/MCPTool/MCPTool.ts
// ---------------------------------------------------------------------------

/**
 * The MCPToolBase is a structural template with stub implementations.
 * It is NOT meant to be used directly — it is spread and overridden for
 * each real MCP tool discovered from a server.
 *
 * Compare with Claude Code's MCPTool (src/tools/MCPTool/MCPTool.ts:27-77):
 *   - isMcp: true
 *   - name: 'mcp'          (overridden)
 *   - description(): stub  (overridden)
 *   - call(): stub         (overridden)
 *   - checkPermissions()   (overridden)
 */
const MCPToolBase = {
  isMcp: true as const,
  name: 'mcp',                      // overridden per tool
  maxResultSizeChars: 100_000,      // inherited by all tools
  description: '',                  // overridden per tool
  inputSchema: {} as Record<string, unknown>,  // overridden per tool

  // Stub implementations — all overridden in createToolsFromServer()
  async call(_args: Record<string, unknown>): Promise<unknown> {
    return { data: '' }
  },
  checkPermissions(): { behavior: 'passthrough'; message: string } {
    return { behavior: 'passthrough', message: 'MCPTool requires permission.' }
  },
}

/**
 * A concrete tool object created from an MCP server tool descriptor.
 * Represents the result of spreading MCPToolBase and overriding key fields.
 */
interface MCPClientTool {
  isMcp: true
  name: string                              // mcp__<serverName>__<toolName>
  maxResultSizeChars: number
  description: string
  inputSchema: Record<string, unknown>
  serverToolName: string                    // original name on the server
  call(args: Record<string, unknown>): Promise<unknown>
  checkPermissions(): { behavior: 'passthrough'; message: string }
}

// ---------------------------------------------------------------------------
// Tool Name Builder — mirrors src/services/mcp/mcpStringUtils.ts
// ---------------------------------------------------------------------------

/**
 * Build a fully qualified MCP tool name.
 * Format: mcp__<serverName>__<toolName>
 *
 * This namespacing:
 *   1. Prevents collisions between tools from different servers
 *   2. Makes it visually clear which server a tool belongs to
 *   3. Allows the permission system to identify tools precisely
 */
function buildMcpToolName(serverName: string, toolName: string): string {
  // Normalize: replace characters invalid in identifiers with underscores
  const normalizedServer = serverName.replace(/[^a-zA-Z0-9_]/g, '_')
  const normalizedTool = toolName.replace(/[^a-zA-Z0-9_]/g, '_')
  return `mcp__${normalizedServer}__${normalizedTool}`
}

// ---------------------------------------------------------------------------
// Transport Factory — mirrors the transport selection in client.ts:619-960
// ---------------------------------------------------------------------------

/**
 * Create the appropriate transport based on configuration.
 *
 * In Claude Code, this logic is distributed across client.ts lines 619-960,
 * handling: stdio, sse, sse-ide, ws-ide, ws, http, claudeai-proxy, sdk.
 * We simplify to two types for demonstration.
 */
function createTransport(config: ServerConfig): Transport {
  if (config.type === 'stdio') {
    // Mirrors Claude Code's StdioClientTransport setup (client.ts:950-958)
    // Key detail: stderr: 'pipe' prevents server diagnostic output from
    // cluttering the terminal UI
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      // In Claude Code: stderr: 'pipe' and custom env via subprocessEnv()
    })
  }

  if (config.type === 'http') {
    // Mirrors Claude Code's StreamableHTTPClientTransport setup (client.ts:861-865)
    // In production Claude Code, this also:
    //   - Wraps fetch with wrapFetchWithTimeout() (60s timeout on POSTs, no timeout on GETs)
    //   - Wraps with wrapFetchWithStepUpDetection() for OAuth step-up
    //   - Attaches a ClaudeAuthProvider for OAuth 2.0
    //   - Sets 'application/json, text/event-stream' Accept header (MCP spec requirement)
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: {
          'User-Agent': 'mcp-client-demo/1.0.0',
          ...config.headers,
        },
      },
    })
  }

  throw new Error(`Unsupported transport type: ${(config as ServerConfig).type}`)
}

// ---------------------------------------------------------------------------
// Tool Discovery — mirrors fetchToolsForClient in client.ts:1743-1832
// ---------------------------------------------------------------------------

/**
 * Fetch tools from a connected MCP server and wrap them as local tool objects.
 *
 * This mirrors Claude Code's fetchToolsForClient() which:
 *   1. Checks capabilities.tools before requesting (client.ts:1748)
 *   2. Calls tools/list (client.ts:1752)
 *   3. Maps each server tool to { ...MCPTool, <overrides> } (client.ts:1766-1832)
 *   4. Is memoized with LRU (max 20 servers) to avoid repeated requests
 *
 * The key pattern is the spread-and-override:
 *   return { ...MCPToolBase, name, description, call, ... }
 */
async function discoverTools(
  client: Client,
  serverName: string,
  capabilities: Record<string, unknown>,
): Promise<MCPClientTool[]> {
  // Check capability before requesting — mirrors client.ts:1748
  if (!capabilities.tools) {
    console.log(`  Server "${serverName}" does not support tools`)
    return []
  }

  const result = await client.request(
    { method: 'tools/list' },
    ListToolsResultSchema,
  )

  // The MCPTool clone pattern: spread the base and override per-tool properties
  return result.tools.map((serverTool: McpServerTool): MCPClientTool => {
    // Mirrors buildMcpToolName() in mcpStringUtils.ts
    const fullyQualifiedName = buildMcpToolName(serverName, serverTool.name)

    // Clone MCPToolBase and override the varying properties.
    // In Claude Code, this spread + override creates a Tool that is
    // indistinguishable from built-in tools at the type level.
    return {
      ...MCPToolBase,

      // Override: real tool identity
      name: fullyQualifiedName,
      serverToolName: serverTool.name,

      // Override: real description (truncated to prevent token waste)
      // Claude Code uses MAX_MCP_DESCRIPTION_LENGTH = 2048
      description: (serverTool.description ?? '').slice(0, 2048),

      // Override: real input schema from the server
      inputSchema: serverTool.inputSchema as Record<string, unknown>,

      // Override: real call implementation
      // In Claude Code this calls ensureConnectedClient() + callMCPToolWithUrlElicitationRetry()
      // which handles session expiry, retries, and progress events.
      async call(args: Record<string, unknown>): Promise<unknown> {
        console.log(`  Calling ${serverTool.name} with args:`, args)

        const result = await client.request(
          {
            method: 'tools/call',
            params: {
              name: serverTool.name,
              arguments: args,
            },
          },
          CallToolResultSchema,
        )

        return result
      },

      // Override: permission check with allow-rule suggestion
      // In Claude Code, this integrates with the full Permission System (Chapter 7)
      checkPermissions() {
        return {
          behavior: 'passthrough' as const,
          message: `Tool "${fullyQualifiedName}" requires permission.`,
        }
      },
    }
  })
}

// ---------------------------------------------------------------------------
// MCP Client Demo — orchestrates the full lifecycle
// ---------------------------------------------------------------------------

class MCPClientDemo {
  private state: ConnectionState = { type: 'pending' }
  private tools: MCPClientTool[] = []
  private client: Client | null = null

  constructor(
    private readonly serverName: string,
    private readonly config: ServerConfig,
  ) {}

  /**
   * Connect to the MCP server and discover its tools.
   *
   * Mirrors Claude Code's connectToServer() (client.ts:595-1641):
   *   1. Create transport
   *   2. Create Client with capabilities declaration
   *   3. Connect with timeout
   *   4. Negotiate capabilities
   *   5. Fetch tools
   *
   * Key difference: Claude Code memoizes connectToServer by {name, config}
   * so multiple concurrent calls reuse one connection.
   */
  async connect(): Promise<void> {
    console.log(`Connecting to "${this.serverName}"...`)
    this.state = { type: 'pending' }

    const transport = createTransport(this.config)

    // Create client with capability declarations.
    // In Claude Code (client.ts:985-1001):
    //   - name: 'claude-code', title: 'Claude Code', version: MACRO.VERSION
    //   - capabilities: { roots: {}, elicitation: {} }
    //   - The elicitation capability enables server-to-client user input requests
    this.client = new Client(
      {
        name: 'mcp-client-demo',
        version: '1.0.0',
      },
      {
        capabilities: {
          roots: {},   // Declares we support roots listing
        },
      },
    )

    // Register a handler for roots requests — MCP servers use this to know
    // which directories the client is working in.
    // In Claude Code (client.ts:1009-1018), this returns getOriginalCwd().
    // Roots allow servers to scope their operations to relevant directories.

    // Connection with timeout — mirrors Promise.race pattern (client.ts:1048-1077)
    const CONNECT_TIMEOUT_MS = 30_000
    const connectPromise = this.client.connect(transport)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Connection timed out after ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS,
      )
    })

    try {
      await Promise.race([connectPromise, timeoutPromise])
    } catch (error) {
      this.state = {
        type: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
      throw error
    }

    // Capability negotiation — mirrors client.ts:1157-1183
    const serverCapabilities = this.client.getServerCapabilities() ?? {}
    const serverVersion = this.client.getServerVersion()

    console.log(`Connected to "${this.serverName}"!`)
    console.log(`  Server version: ${serverVersion?.version ?? 'unknown'}`)
    console.log(`  Capabilities:`)
    console.log(`    tools: ${!!serverCapabilities.tools}`)
    console.log(`    resources: ${!!serverCapabilities.resources}`)
    console.log(`    prompts: ${!!serverCapabilities.prompts}`)

    this.state = {
      type: 'connected',
      client: this.client,
      capabilities: serverCapabilities as Record<string, unknown>,
    }

    // Discover tools using the clone pattern
    this.tools = await discoverTools(
      this.client,
      this.serverName,
      serverCapabilities as Record<string, unknown>,
    )
    console.log(`Discovered ${this.tools.length} tools:`)
    for (const tool of this.tools) {
      console.log(`  - ${tool.name}`)
      if (tool.description) {
        const preview = tool.description.slice(0, 80)
        console.log(`    ${preview}${tool.description.length > 80 ? '...' : ''}`)
      }
    }
  }

  /**
   * Call a tool by its fully qualified name (mcp__server__tool).
   * Demonstrates the call() override installed during tool discovery.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.state.type !== 'connected') {
      throw new Error(`Not connected (state: ${this.state.type})`)
    }

    const tool = this.tools.find(t => t.name === toolName)
    if (!tool) {
      const available = this.tools.map(t => t.name).join(', ')
      throw new Error(`Tool "${toolName}" not found. Available: ${available}`)
    }

    // In Claude Code, checkPermissions() is called by the permission system
    // before call() is invoked. Here we just log the result.
    const permResult = tool.checkPermissions()
    console.log(`\nPermission check: ${permResult.behavior} (${permResult.message})`)

    return tool.call(args)
  }

  /**
   * List all discovered tools with their schemas.
   */
  listTools(): MCPClientTool[] {
    return this.tools
  }

  /**
   * Clean up the connection.
   * In Claude Code, cleanup() is called by the CleanupRegistry on process exit,
   * and also when onclose triggers to clear the memoize cache.
   */
  async cleanup(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close()
        console.log(`\nDisconnected from "${this.serverName}"`)
      } catch (error) {
        console.error(`Error during cleanup: ${error}`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// InProcessTransport demo — mirrors src/services/mcp/InProcessTransport.ts
// ---------------------------------------------------------------------------

/**
 * A simplified in-process transport demonstrating the queueMicrotask pattern.
 *
 * In Claude Code (InProcessTransport.ts:26-34), send() uses queueMicrotask
 * to deliver messages asynchronously. This prevents call stack overflow in
 * synchronous request/response cycles where:
 *   - Client sends request
 *   - Server's onmessage fires synchronously
 *   - Server sends response
 *   - Client's onmessage fires synchronously
 *   - Client resolves its Promise, triggering another request
 *   - ... (stack grows until overflow)
 *
 * queueMicrotask breaks this chain: each send() defers delivery to the
 * next microtask checkpoint, preventing stack accumulation while still
 * delivering "immediately" (before any macro-tasks like setTimeout).
 */
class SimpleInProcessTransport {
  private peer: SimpleInProcessTransport | undefined
  private closed = false

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: unknown) => void

  _setPeer(peer: SimpleInProcessTransport): void {
    this.peer = peer
  }

  async start(): Promise<void> {
    // No-op: no network initialization needed for in-process transport
  }

  async send(message: unknown): Promise<void> {
    if (this.closed) {
      throw new Error('Transport is closed')
    }

    // THE KEY DESIGN DECISION: queueMicrotask instead of direct call
    //
    // Without queueMicrotask:
    //   send() → peer.onmessage() → peer calls send() → onmessage() → ...
    //   This creates deep synchronous nesting → RangeError: Maximum call stack size exceeded
    //
    // With queueMicrotask:
    //   send() → schedules delivery → returns
    //   [next microtask checkpoint]
    //   → peer.onmessage() → peer calls send() → schedules delivery → returns
    //   [next microtask checkpoint]
    //   → ... (stack stays shallow, always returns before next delivery)
    queueMicrotask(() => {
      this.peer?.onmessage?.(message)
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
    // Symmetric close: closing one side also closes the other
    if (this.peer && !this.peer.closed) {
      this.peer.closed = true
      this.peer.onclose?.()
    }
  }
}

/**
 * Create a linked pair of in-process transports.
 * Messages sent on transport A appear on transport B's onmessage, and vice versa.
 *
 * Mirrors createLinkedTransportPair() in InProcessTransport.ts:57-63
 */
function createLinkedTransportPair(): [SimpleInProcessTransport, SimpleInProcessTransport] {
  const a = new SimpleInProcessTransport()
  const b = new SimpleInProcessTransport()
  a._setPeer(b)
  b._setPeer(a)
  return [a, b]
}

// ---------------------------------------------------------------------------
// Demo: show queueMicrotask preventing stack overflow
// ---------------------------------------------------------------------------

async function demonstrateQueueMicrotask(): Promise<void> {
  console.log('\n--- InProcessTransport queueMicrotask demo ---')

  const [clientTransport, serverTransport] = createLinkedTransportPair()
  let messageCount = 0
  const MAX_MESSAGES = 1000 // Would overflow without queueMicrotask

  await clientTransport.start()
  await serverTransport.start()

  // Server echoes every message it receives back to the client
  serverTransport.onmessage = async (message: unknown) => {
    await serverTransport.send({ echo: message, count: messageCount })
  }

  // Client counts echoes and sends the next message
  const allDone = new Promise<void>((resolve) => {
    clientTransport.onmessage = async (message: unknown) => {
      messageCount++
      if (messageCount >= MAX_MESSAGES) {
        resolve()
        return
      }
      // Without queueMicrotask in send(), this would stack overflow
      await clientTransport.send({ seq: messageCount })
    }
  })

  // Start the chain
  await clientTransport.send({ seq: 0 })
  await allDone

  console.log(`Successfully exchanged ${messageCount} messages without stack overflow`)
  console.log(`(queueMicrotask kept the stack shallow throughout)`)

  await clientTransport.close()
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--demo') {
    // Run the in-process transport demo
    await demonstrateQueueMicrotask()
    return
  }

  const transportType = args[0] as TransportType
  let config: ServerConfig

  if (transportType === 'stdio') {
    if (args.length < 2) {
      console.error('Usage: mcp-client.ts stdio <command> [args...]')
      process.exit(1)
    }
    config = {
      type: 'stdio',
      command: args[1],
      args: args.slice(2),
    }
  } else if (transportType === 'http') {
    if (args.length < 2) {
      console.error('Usage: mcp-client.ts http <url>')
      process.exit(1)
    }
    config = {
      type: 'http',
      url: args[1],
    }
  } else {
    console.error(`Unknown transport type: ${transportType}`)
    console.error('Supported: stdio, http')
    process.exit(1)
  }

  const serverName = transportType === 'stdio'
    ? (args[1].split('/').pop() ?? 'unknown').replace(/^server-/, '')
    : new URL(args[1]).hostname

  const demo = new MCPClientDemo(serverName, config)

  // Ensure cleanup on exit
  process.on('SIGINT', async () => {
    await demo.cleanup()
    process.exit(0)
  })

  try {
    // Step 1: Connect and discover tools
    await demo.connect()

    const tools = demo.listTools()
    if (tools.length === 0) {
      console.log('\nNo tools available on this server.')
      return
    }

    // Step 2: Demonstrate calling the first available tool
    const firstTool = tools[0]
    console.log(`\nDemonstrating tool call: ${firstTool.name}`)
    console.log('Input schema:', JSON.stringify(firstTool.inputSchema, null, 2))

    // For the filesystem server, try listing files
    // For other servers, try calling with empty args
    let demoArgs: Record<string, unknown> = {}
    if (firstTool.serverToolName === 'list_directory') {
      demoArgs = { path: '/tmp' }
    } else if (firstTool.serverToolName === 'read_file') {
      demoArgs = { path: '/tmp' }
    }

    try {
      const result = await demo.callTool(firstTool.name, demoArgs)
      console.log('\nResult:')
      console.log(JSON.stringify(result, null, 2))
    } catch (callError) {
      console.log(`\nTool call skipped (demo args may not match schema): ${callError}`)
      console.log('In a real client, you would provide args matching the inputSchema.')
    }

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  } finally {
    await demo.cleanup()
  }
}

main().catch(console.error)
