/**
 * tool-interface.ts
 *
 * Simplified version of the Tool interface from src/Tool.ts.
 * Demonstrates the core method signatures and field contracts.
 *
 * Source reference: src/Tool.ts lines 362–695
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Supporting types (simplified from src/Tool.ts)
// ---------------------------------------------------------------------------

/** The result returned by validateInput() */
export type ValidationResult =
  | { result: true }
  | { result: false; message: string; errorCode: number }

/** The behavior decision returned by checkPermissions() */
export type PermissionBehavior = 'allow' | 'deny' | 'ask'

export type PermissionResult = {
  behavior: PermissionBehavior
  /** May carry updated (normalized) input back to the runtime */
  updatedInput?: Record<string, unknown>
  /** Human-readable reason shown in the permission dialog */
  message?: string
}

/**
 * The result returned by call().
 * `data` is the typed output; `newMessages` lets a tool inject additional
 * conversation turns (used by AgentTool to surface sub-agent transcripts).
 */
export type ToolResult<T> = {
  data: T
  newMessages?: unknown[]
  contextModifier?: (ctx: ToolUseContext) => ToolUseContext
}

/**
 * Minimal execution context passed to every tool method.
 * The real ToolUseContext (src/Tool.ts lines 158-299) is much larger,
 * but these are the fields tools most commonly use.
 */
export type ToolUseContext = {
  /** The user's permission settings */
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
  /** Current working directory */
  cwd: string
  /** AbortController for cancellable tool calls */
  abortController: AbortController
  /** Read the app-wide state (auth, tool permissions, etc.) */
  getAppState(): Record<string, unknown>
  /** All messages in the current conversation */
  messages: unknown[]
}

// ---------------------------------------------------------------------------
// The Tool<Input, Output> interface
// Source: src/Tool.ts lines 362–695
// ---------------------------------------------------------------------------

/**
 * Every tool in Claude Code implements this interface.
 *
 * Generic parameters:
 *   Input  — a Zod schema; constrains what the model can pass
 *   Output — TypeScript type of the value returned by call()
 */
export type Tool<
  Input extends z.ZodType<Record<string, unknown>> = z.ZodType<Record<string, unknown>>,
  Output = unknown,
> = {
  // -----------------------------------------------------------------------
  // Identity (src/Tool.ts lines 371-377)
  // -----------------------------------------------------------------------

  /** Primary name used in API tool_use blocks */
  readonly name: string

  /**
   * Legacy names kept for backwards compatibility when a tool is renamed.
   * toolMatchesName() checks both name and aliases.
   */
  aliases?: string[]

  /**
   * 3–10 word phrase used by ToolSearch for keyword discovery.
   * Should NOT repeat the tool name — provide complementary vocabulary.
   * Example: 'jupyter' for NotebookEdit, not 'edit notebook'.
   */
  searchHint?: string

  // -----------------------------------------------------------------------
  // Schema (src/Tool.ts lines 394-400)
  // -----------------------------------------------------------------------

  /** Zod schema that validates and types the model's input */
  readonly inputSchema: Input

  /** Optional Zod schema for the output — used for structured output validation */
  outputSchema?: z.ZodType<Output>

  // -----------------------------------------------------------------------
  // Core execution (src/Tool.ts lines 379-392)
  // -----------------------------------------------------------------------

  /**
   * The tool's actual implementation.
   *
   * Called only after validateInput() passes and checkPermissions() allows.
   * Receives typed args (inferred from inputSchema), the execution context,
   * and an optional progress callback for streaming updates.
   */
  call(
    args: z.infer<Input>,
    context: ToolUseContext,
    onProgress?: (progress: unknown) => void,
  ): Promise<ToolResult<Output>>

  /**
   * Pre-execution validation — runs BEFORE checkPermissions().
   *
   * Use for cheap format checks that don't require user interaction.
   * Return { result: false } to reject the call with an error message
   * without ever showing a permission dialog.
   *
   * Source: src/Tool.ts lines 489-492
   */
  validateInput?(
    input: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<ValidationResult>

  /**
   * Permission gate — runs AFTER validateInput() passes.
   *
   * Return behavior:
   *   'allow' — proceed immediately
   *   'deny'  — reject with message
   *   'ask'   — show permission dialog to the user
   *
   * General permission logic lives in permissions.ts.
   * This method contains tool-specific logic only.
   *
   * Source: src/Tool.ts lines 500-503
   */
  checkPermissions(
    input: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<PermissionResult>

  // -----------------------------------------------------------------------
  // Result size limit (src/Tool.ts lines 464-467)
  // -----------------------------------------------------------------------

  /**
   * Maximum characters for the serialized tool result.
   * When exceeded: result is written to disk; Claude gets a preview + path.
   *
   * Special value:
   *   Infinity — never persist (used by FileReadTool to avoid circular reads)
   *
   * Common values: 100_000 for most tools.
   */
  maxResultSizeChars: number

  // -----------------------------------------------------------------------
  // Behavioral flags (src/Tool.ts lines 402-416)
  // -----------------------------------------------------------------------

  /**
   * Returns true if the tool can run in parallel with other tools.
   * Default (from TOOL_DEFAULTS): false — assume not safe.
   *
   * GlobTool and GrepTool set this to true to enable parallel searches.
   */
  isConcurrencySafe(input: z.infer<Input>): boolean

  /**
   * Returns true when the tool should be included in the available set.
   * Default (from TOOL_DEFAULTS): true.
   *
   * Use to gate tools behind feature flags or platform checks.
   */
  isEnabled(): boolean

  /**
   * Returns true for tools that never modify the filesystem or other state.
   * Default (from TOOL_DEFAULTS): false — assume writes.
   *
   * Informs --no-write / read-only mode enforcement.
   */
  isReadOnly(input: z.infer<Input>): boolean

  /**
   * Returns true for irreversible operations: delete, overwrite, send.
   * Optional — default is false.
   *
   * Informs UI warnings and auto-classifier security checks.
   */
  isDestructive?(input: z.infer<Input>): boolean

  /**
   * What happens when the user sends a new message while this tool runs.
   *   'cancel' — stop the tool immediately
   *   'block'  — keep running; the message waits
   * Default (implicit): 'block'
   */
  interruptBehavior?(): 'cancel' | 'block'

  // -----------------------------------------------------------------------
  // Deferred loading (src/Tool.ts lines 438-449)
  // -----------------------------------------------------------------------

  /**
   * When true, this tool is excluded from the initial system prompt
   * when ToolSearch is enabled. The model discovers it via ToolSearch.
   */
  readonly shouldDefer?: boolean

  /**
   * When true, this tool is always included in the prompt even when
   * ToolSearch is on. Use for tools the model must see on turn 1.
   */
  readonly alwaysLoad?: boolean

  // -----------------------------------------------------------------------
  // UI rendering (src/Tool.ts lines 600-694)
  // -----------------------------------------------------------------------

  /**
   * Renders the tool use message in the UI.
   * Called with PARTIAL input as parameters stream in — handle undefined fields.
   *
   * Source: src/Tool.ts lines 605-608
   */
  renderToolUseMessage(
    input: Partial<z.infer<Input>>,
    options: { verbose: boolean },
  ): string | null

  /**
   * Renders the tool result message after execution completes.
   * The style='condensed' option requests a compact summary.
   *
   * Source: src/Tool.ts lines 566-580
   */
  renderToolResultMessage?(
    content: Output,
    options: { style?: 'condensed'; verbose: boolean },
  ): string | null

  // -----------------------------------------------------------------------
  // Serialization (src/Tool.ts lines 557-560)
  // -----------------------------------------------------------------------

  /**
   * Converts the typed Output to the API's ToolResultBlockParam format.
   * Must serialize content to a string or array of content blocks.
   */
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): {
    type: 'tool_result'
    tool_use_id: string
    content: string | Array<{ type: string; [key: string]: unknown }>
  }

  // -----------------------------------------------------------------------
  // Prompt / description (src/Tool.ts lines 518-524)
  // -----------------------------------------------------------------------

  /**
   * Returns the detailed system prompt describing this tool to the model.
   * Shown in the initial system message.
   */
  prompt(options?: Record<string, unknown>): Promise<string>

  /**
   * Returns a brief one-line description of what the tool does.
   */
  description(
    input: z.infer<Input>,
    options?: Record<string, unknown>,
  ): Promise<string>

  /**
   * Returns the display name shown in the UI (may include input context).
   * Default (from TOOL_DEFAULTS): returns tool.name
   */
  userFacingName(input: Partial<z.infer<Input>> | undefined): string
}

// ---------------------------------------------------------------------------
// ToolDef — the partial version accepted by buildTool()
// Source: src/Tool.ts lines 721-726
// ---------------------------------------------------------------------------

/**
 * DefaultableToolKeys are the methods that buildTool() provides defaults for.
 * A ToolDef may omit them; the resulting Tool always has them.
 *
 * Source: src/Tool.ts lines 707-714
 */
type DefaultableToolKeys =
  | 'isEnabled'
  | 'isConcurrencySafe'
  | 'isReadOnly'
  | 'isDestructive'
  | 'checkPermissions'
  | 'userFacingName'

/**
 * ToolDef is the input to buildTool().
 * Same shape as Tool, but defaultable methods are optional.
 */
export type ToolDef<
  Input extends z.ZodType<Record<string, unknown>> = z.ZodType<Record<string, unknown>>,
  Output = unknown,
> = Omit<Tool<Input, Output>, DefaultableToolKeys> &
  Partial<Pick<Tool<Input, Output>, DefaultableToolKeys>>

// ---------------------------------------------------------------------------
// TOOL_DEFAULTS and buildTool() factory
// Source: src/Tool.ts lines 757-792
// ---------------------------------------------------------------------------

/**
 * Default implementations for the commonly-stubbed methods.
 * All defaults are fail-closed where security matters:
 *   - isConcurrencySafe: false (assume not safe)
 *   - isReadOnly: false (assume writes)
 *   - checkPermissions: allow (defer to general permission system)
 *
 * Source: src/Tool.ts lines 757-769
 */
export const TOOL_DEFAULTS = {
  isEnabled: (): boolean => true,
  isConcurrencySafe: (_input?: unknown): boolean => false,
  isReadOnly: (_input?: unknown): boolean => false,
  isDestructive: (_input?: unknown): boolean => false,
  checkPermissions: async (
    input: Record<string, unknown>,
    _ctx?: ToolUseContext,
  ): Promise<PermissionResult> => ({ behavior: 'allow', updatedInput: input }),
  userFacingName: (_input?: unknown): string => '',
} as const

/**
 * Build a complete Tool from a partial definition, filling in safe defaults.
 *
 * Usage:
 *   export const MyTool = buildTool({
 *     name: 'MyTool',
 *     maxResultSizeChars: 100_000,
 *     inputSchema: z.object({ ... }),
 *     async call(args, ctx) { ... },
 *     // ... only what you need to override
 *   })
 *
 * Source: src/Tool.ts lines 783-792
 */
export function buildTool<
  Input extends z.ZodType<Record<string, unknown>>,
  Output,
>(def: ToolDef<Input, Output>): Tool<Input, Output> {
  return {
    ...TOOL_DEFAULTS,
    userFacingName: () => def.name,
    ...def,
  } as Tool<Input, Output>
}

// ---------------------------------------------------------------------------
// Helper utilities
// Source: src/Tool.ts lines 348-360
// ---------------------------------------------------------------------------

/**
 * Check if a tool matches a given name, including aliases.
 * Used everywhere the codebase looks up a tool by name.
 *
 * Source: src/Tool.ts lines 348-353
 */
export function toolMatchesName(
  tool: { name: string; aliases?: string[] },
  name: string,
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false)
}

/**
 * Find a tool by name (or alias) in a collection.
 *
 * Source: src/Tool.ts lines 358-360
 */
export function findToolByName<T extends { name: string; aliases?: string[] }>(
  tools: readonly T[],
  name: string,
): T | undefined {
  return tools.find(t => toolMatchesName(t, name))
}
