/**
 * tool-registry.ts
 *
 * Demonstrates the three-layer tool registration mechanism from src/tools.ts.
 *
 * The real implementation uses feature flags and process.env extensively.
 * This simplified version shows the core architecture patterns:
 *   - getAllBaseTools() — exhaustive source of truth
 *   - getTools()        — filtered by permission context and environment
 *   - assembleToolPool() — combined with MCP tools, deduplicated
 *
 * Source reference: src/tools.ts lines 193-367
 */

import { z } from 'zod'
import { buildTool, type Tool, type ToolUseContext } from './tool-interface'

// ---------------------------------------------------------------------------
// Minimal Tool implementations for demonstration
// ---------------------------------------------------------------------------

/** Simulated BashTool — a stateful, write tool */
const BashTool = buildTool({
  name: 'Bash',
  searchHint: 'run shell commands execute scripts terminal',
  maxResultSizeChars: 100_000,
  isConcurrencySafe() { return false },  // stateful shell
  isReadOnly() { return false },          // can write files
  get inputSchema() {
    return z.object({ command: z.string() })
  },
  async call(args, _ctx) {
    return { data: `[simulated] ran: ${args.command}` }
  },
  async checkPermissions(input) {
    return { behavior: 'ask', updatedInput: input }  // always ask
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: 'tool_result', tool_use_id: toolUseID, content: String(content) }
  },
  renderToolUseMessage(input) {
    return `$ ${input.command ?? '...'}`
  },
  async prompt() { return 'Run shell commands.' },
  async description() { return 'Execute shell commands' },
})

/** Simulated FileReadTool — read-only, concurrency-safe */
const FileReadTool = buildTool({
  name: 'Read',
  searchHint: 'read file view contents open document',
  maxResultSizeChars: Infinity,  // self-bounds via limit/offset
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  get inputSchema() {
    return z.object({
      file_path: z.string(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    })
  },
  async call(args, _ctx) {
    return { data: `[simulated] contents of ${args.file_path}` }
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: 'tool_result', tool_use_id: toolUseID, content: String(content) }
  },
  renderToolUseMessage(input) {
    return `Reading ${input.file_path ?? '...'}`
  },
  async prompt() { return 'Read file contents.' },
  async description() { return 'Read a file' },
})

/** Simulated GlobTool — read-only, concurrency-safe */
const GlobTool = buildTool({
  name: 'Glob',
  searchHint: 'find files by name pattern wildcard',
  maxResultSizeChars: 100_000,
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  get inputSchema() {
    return z.object({
      pattern: z.string(),
      path: z.string().optional(),
    })
  },
  async call(args, _ctx) {
    return { data: { filenames: [], numFiles: 0, durationMs: 0, truncated: false } }
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: 'tool_result', tool_use_id: toolUseID, content: JSON.stringify(content) }
  },
  renderToolUseMessage(input) {
    return `Finding ${input.pattern ?? '...'}`
  },
  async prompt() { return 'Find files by pattern.' },
  async description() { return 'Find files matching a glob pattern' },
})

/** Simulated FileEditTool — write tool */
const FileEditTool = buildTool({
  name: 'Edit',
  searchHint: 'modify file contents in place replace text',
  maxResultSizeChars: 100_000,
  isConcurrencySafe() { return false },
  isReadOnly() { return false },
  get inputSchema() {
    return z.object({
      file_path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
    })
  },
  async call(args, _ctx) {
    return { data: { file_path: args.file_path, lines_changed: 1 } }
  },
  async checkPermissions(input) {
    return { behavior: 'ask', updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return { type: 'tool_result', tool_use_id: toolUseID, content: JSON.stringify(content) }
  },
  renderToolUseMessage(input) {
    return `Editing ${input.file_path ?? '...'}`
  },
  async prompt() { return 'Edit a file.' },
  async description() { return 'Edit a file by replacing text' },
})

// ---------------------------------------------------------------------------
// Permission context
//
// Simplified version of ToolPermissionContext from src/Tool.ts lines 123-138.
// The real type uses DeepImmutable<> and a richer rule structure.
// ---------------------------------------------------------------------------

export type PermissionMode =
  | 'default'         // ask for write operations
  | 'acceptEdits'     // auto-approve file edits
  | 'bypassPermissions' // skip all permission prompts
  | 'plan'            // read-only plan mode

export type DenyRule = {
  /** Tool name pattern to deny, e.g. 'Bash', 'mcp__server__*' */
  toolPattern: string
  /** Optional: additional condition (e.g. command content). If omitted, deny all uses. */
  ruleContent?: string
}

export type RegistryPermissionContext = {
  mode: PermissionMode
  /** Tools that are always denied, matched before the model sees them */
  denyRules: DenyRule[]
  /** When true, read-only mode: exclude all write tools */
  readOnly?: boolean
}

// ---------------------------------------------------------------------------
// Utility: wildcard pattern matching
//
// Simplified from src/utils/permissions/shellRuleMatching.ts
// ---------------------------------------------------------------------------

function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === value) return true
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1)
    return value.startsWith(prefix)
  }
  return false
}

// ---------------------------------------------------------------------------
// Layer 1: getAllBaseTools()
//
// The exhaustive source of truth — every tool that *could* be available.
// Source: src/tools.ts lines 193-251
// ---------------------------------------------------------------------------

/**
 * Returns all tools that exist in the registry.
 * Conditional includes (feature flags, env vars) are simulated here
 * with simple boolean flags.
 */
export function getAllBaseTools(options?: {
  /** Include embedded search tools (GlobTool, GrepTool). Default: true */
  includeSearchTools?: boolean
}): readonly Tool[] {
  const { includeSearchTools = true } = options ?? {}

  const tools: Tool[] = [
    BashTool,
    FileReadTool,
    FileEditTool,
  ]

  // Glob/Grep are excluded on builds where faster embedded tools replace them.
  // Source: src/tools.ts line 201
  // ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
  if (includeSearchTools) {
    tools.push(GlobTool)
  }

  return tools
}

// ---------------------------------------------------------------------------
// Helper: filterToolsByDenyRules()
//
// Strips tools matched by deny rules BEFORE the model sees them.
// Source: src/tools.ts lines 262-269
// ---------------------------------------------------------------------------

/**
 * Filters out tools that are blanket-denied by the permission context.
 * Uses the same wildcard matcher as the runtime permission check.
 *
 * Key insight: this runs at *registration time*, not at *call time*.
 * A tool denied here never appears in the model's tool list.
 */
export function filterToolsByDenyRules(
  tools: readonly Tool[],
  denyRules: DenyRule[],
): Tool[] {
  return tools.filter(tool => {
    // Check if any deny rule matches this tool without a content restriction.
    // Rules with ruleContent are call-time checks, not blanket exclusions.
    const isDenied = denyRules.some(
      rule => !rule.ruleContent && matchesPattern(rule.toolPattern, tool.name),
    )
    return !isDenied
  })
}

// ---------------------------------------------------------------------------
// Layer 2: getTools()
//
// Filtered view: respects permission context, mode, and isEnabled().
// Source: src/tools.ts lines 271-327
// ---------------------------------------------------------------------------

/**
 * Returns the tool list appropriate for the current session.
 *
 * Filters applied (in order):
 *   1. Blanket deny rules (same as runtime permission check)
 *   2. Read-only mode: remove write tools
 *   3. Simple mode: only Bash + Read + Edit
 *   4. tool.isEnabled() — feature-flag gating
 */
export function getTools(
  permissionContext: RegistryPermissionContext,
  options?: {
    /** Simple mode: only primitive tools (Bash, Read, Edit) */
    simple?: boolean
  },
): readonly Tool[] {
  const { simple = false } = options ?? {}

  // Simple mode returns only the three primitive tools
  // Source: src/tools.ts lines 273-298
  if (simple) {
    const simpleSet = new Set(['Bash', 'Read', 'Edit'])
    const simpleTools = getAllBaseTools().filter(t => simpleSet.has(t.name))
    return filterToolsByDenyRules(simpleTools, permissionContext.denyRules)
  }

  let tools = [...getAllBaseTools()]

  // Step 1: apply blanket deny rules
  // Source: src/tools.ts line 310
  tools = filterToolsByDenyRules(tools, permissionContext.denyRules)

  // Step 2: read-only mode removes write tools
  if (permissionContext.readOnly || permissionContext.mode === 'plan') {
    tools = tools.filter(t => t.isReadOnly({}))
  }

  // Step 3: isEnabled() — feature flags, platform checks
  // Source: src/tools.ts lines 325-326
  tools = tools.filter(t => t.isEnabled())

  return tools
}

// ---------------------------------------------------------------------------
// Layer 3: assembleToolPool()
//
// Combines built-in tools with MCP tools, deduplicated.
// Source: src/tools.ts lines 345-367
// ---------------------------------------------------------------------------

/**
 * Assemble the full tool pool for a session.
 *
 * Combines built-in tools (from getTools) with externally-provided MCP tools.
 * Deduplicates by name — built-in tools win on conflict.
 *
 * Sort strategy (from source):
 *   - Built-ins and MCP tools are sorted SEPARATELY, then concatenated.
 *   - This keeps built-ins as a contiguous prefix in the tool list.
 *   - The server places a prompt-cache breakpoint after the last built-in;
 *     interleaving MCP tools would bust the cache for every user.
 *
 * Source: src/tools.ts lines 345-367
 */
export function assembleToolPool(
  permissionContext: RegistryPermissionContext,
  mcpTools: readonly Tool[] = [],
): readonly Tool[] {
  const builtInTools = [...getTools(permissionContext)]

  // Filter MCP tools by deny rules — same rules apply
  const allowedMcpTools = filterToolsByDenyRules(
    mcpTools,
    permissionContext.denyRules,
  )

  // Sort each partition independently to preserve cache breakpoint
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  const sortedBuiltIns = builtInTools.sort(byName)
  const sortedMcp = allowedMcpTools.sort(byName)

  // Concatenate: built-ins first (they win on name conflict)
  const combined = [...sortedBuiltIns, ...sortedMcp]

  // Deduplicate by name — first occurrence wins (built-ins)
  const seen = new Set<string>()
  return combined.filter(tool => {
    if (seen.has(tool.name)) return false
    seen.add(tool.name)
    return true
  })
}

// ---------------------------------------------------------------------------
// Tool discovery utilities
// ---------------------------------------------------------------------------

/**
 * Find a tool by name (including aliases).
 * Source: src/Tool.ts lines 358-360
 */
export function findToolByName(
  tools: readonly Tool[],
  name: string,
): Tool | undefined {
  return tools.find(
    t => t.name === name || (t.aliases?.includes(name) ?? false),
  )
}

/**
 * Get all read-only tools from a pool.
 * Useful for constructing restricted tool sets.
 */
export function getReadOnlyTools(tools: readonly Tool[]): Tool[] {
  return tools.filter(t => t.isReadOnly({}))
}

/**
 * Get all concurrency-safe tools.
 * Useful for parallel execution planning.
 */
export function getConcurrencySafeTools(tools: readonly Tool[]): Tool[] {
  return tools.filter(t => t.isConcurrencySafe({}))
}

// ---------------------------------------------------------------------------
// Demo: show the three layers in action
// ---------------------------------------------------------------------------

function printToolList(label: string, tools: readonly Tool[]): void {
  console.log(`\n${label} (${tools.length} tools):`)
  tools.forEach(t => {
    const flags = [
      t.isReadOnly({}) ? 'readonly' : 'write',
      t.isConcurrencySafe({}) ? 'parallel-safe' : 'serial',
    ]
    console.log(`  - ${t.name.padEnd(12)} [${flags.join(', ')}]`)
  })
}

function demo(): void {
  console.log('=== Tool Registry Demo ===')
  console.log('Source: src/tools.ts (anthhub-claude-code)\n')

  // Simulated MCP tools (as if from an external server)
  const mcpFileSystemTool = buildTool({
    name: 'mcp__filesystem__list_directory',
    searchHint: 'list directory files MCP filesystem',
    maxResultSizeChars: 50_000,
    isConcurrencySafe() { return true },
    isReadOnly() { return true },
    get inputSchema() {
      return z.object({ path: z.string() })
    },
    async call(args, _ctx) {
      return { data: `[MCP] listing ${args.path}` }
    },
    async checkPermissions(input) {
      return { behavior: 'allow', updatedInput: input }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
      return { type: 'tool_result', tool_use_id: toolUseID, content: String(content) }
    },
    renderToolUseMessage(input) {
      return `[MCP] Listing ${input.path ?? '...'}`
    },
    async prompt() { return 'List directory via MCP.' },
    async description() { return 'List directory contents via MCP filesystem server' },
  })

  // =========================================================================
  // Layer 1: getAllBaseTools() — everything
  // =========================================================================
  const allTools = getAllBaseTools()
  printToolList('Layer 1: getAllBaseTools()', allTools)

  // =========================================================================
  // Layer 2: getTools() — filtered by permission context
  // =========================================================================

  // Default mode: all tools available
  const defaultCtx: RegistryPermissionContext = {
    mode: 'default',
    denyRules: [],
  }
  printToolList('Layer 2: getTools() [default mode]', getTools(defaultCtx))

  // Plan mode (read-only): only read-only tools
  const planCtx: RegistryPermissionContext = {
    mode: 'plan',
    denyRules: [],
  }
  printToolList('Layer 2: getTools() [plan/read-only mode]', getTools(planCtx))

  // Deny Bash with a blanket rule
  const deniedBashCtx: RegistryPermissionContext = {
    mode: 'default',
    denyRules: [{ toolPattern: 'Bash' }],
  }
  printToolList('Layer 2: getTools() [Bash denied]', getTools(deniedBashCtx))

  // Simple mode: only primitive tools
  printToolList(
    'Layer 2: getTools() [simple mode]',
    getTools(defaultCtx, { simple: true }),
  )

  // =========================================================================
  // Layer 3: assembleToolPool() — combined with MCP
  // =========================================================================
  const mcpTools = [mcpFileSystemTool]
  const fullPool = assembleToolPool(defaultCtx, mcpTools)
  printToolList('Layer 3: assembleToolPool() [built-in + MCP]', fullPool)

  // =========================================================================
  // Discovery utilities
  // =========================================================================
  console.log('\n=== Discovery Utilities ===')

  const readOnlyTools = getReadOnlyTools(fullPool)
  console.log(`\nRead-only tools: ${readOnlyTools.map(t => t.name).join(', ')}`)

  const parallelSafeTools = getConcurrencySafeTools(fullPool)
  console.log(`Parallel-safe tools: ${parallelSafeTools.map(t => t.name).join(', ')}`)

  const found = findToolByName(fullPool, 'Glob')
  console.log(`\nfindToolByName('Glob'): ${found?.name ?? 'not found'}`)
  console.log(`findToolByName('mcp__filesystem__list_directory'): ${findToolByName(fullPool, 'mcp__filesystem__list_directory')?.name ?? 'not found'}`)

  // =========================================================================
  // Key insight: sort stability for prompt caching
  // =========================================================================
  console.log('\n=== Sort Stability Demo ===')
  console.log('Built-ins appear before MCP tools (cache breakpoint preserved):')
  fullPool.forEach((t, i) => {
    const source = t.name.startsWith('mcp__') ? '[MCP]    ' : '[built-in]'
    console.log(`  ${String(i + 1).padStart(2)}. ${source} ${t.name}`)
  })
}

demo()
