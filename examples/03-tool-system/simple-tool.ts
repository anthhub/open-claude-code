/**
 * simple-tool.ts
 *
 * A complete, runnable example of a custom Claude Code tool.
 * Implements WordCountTool — counts words, lines, and characters.
 *
 * Mirrors the buildTool() pattern used by every tool in the Claude Code
 * codebase. See src/tools/GlobTool/GlobTool.ts for a real parallel example.
 *
 * To use in Claude Code: add WordCountTool to the array returned by
 * getAllBaseTools() (src/tools.ts line 193) or pass it via a plugin.
 */

import { z } from 'zod'
import {
  buildTool,
  type PermissionResult,
  type ToolResult,
  type ToolUseContext,
  type ValidationResult,
} from './tool-interface'

// ---------------------------------------------------------------------------
// 1. Input / output schemas
//
// Zod schemas serve two purposes:
//   (a) Runtime validation of the model's JSON input
//   (b) TypeScript type inference — z.infer<typeof inputSchema> gives the
//       exact type that call() receives, fully type-safe
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  /** The text to analyze */
  text: z.string().describe('The text to count words, lines, and characters in'),
  /**
   * When true, include a per-line breakdown in the result.
   * Demonstrates optional fields with defaults.
   */
  include_details: z
    .boolean()
    .optional()
    .describe('Include a per-line word and character count breakdown'),
})

type Input = typeof inputSchema

const outputSchema = z.object({
  lines: z.number(),
  words: z.number(),
  chars: z.number(),
  breakdown: z
    .array(
      z.object({
        lineNumber: z.number(),
        words: z.number(),
        chars: z.number(),
      }),
    )
    .optional(),
})

type Output = z.infer<typeof outputSchema>

// ---------------------------------------------------------------------------
// 2. Tool name constant
//
// Keeping names in constants avoids typos across the codebase.
// Real tools export from a toolName.ts file (e.g. BashTool/toolName.ts).
// ---------------------------------------------------------------------------

export const WORD_COUNT_TOOL_NAME = 'WordCount'

// ---------------------------------------------------------------------------
// 3. The tool definition
//
// buildTool() fills in safe defaults for any omitted method:
//   isEnabled         → true
//   isConcurrencySafe → false   (we override to true — pure computation)
//   isReadOnly        → false   (we override to true — no side effects)
//   checkPermissions  → allow   (we override to be explicit)
//   userFacingName    → 'WordCount'
//
// Source pattern: src/tools/GlobTool/GlobTool.ts lines 57-78
// ---------------------------------------------------------------------------

export const WordCountTool = buildTool<Input, Output>({
  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  name: WORD_COUNT_TOOL_NAME,

  /**
   * searchHint: used by ToolSearch for keyword discovery when the tool is
   * deferred. Should NOT repeat "WordCount" — provide complementary words.
   * Source: src/Tool.ts lines 374-377
   */
  searchHint: 'count words lines characters analyze text statistics',

  /**
   * maxResultSizeChars: hard limit on result size.
   * Word counts are tiny, but we set a reasonable ceiling.
   * Source: src/Tool.ts lines 464-467
   */
  maxResultSizeChars: 10_000,

  // -------------------------------------------------------------------------
  // Schemas
  // -------------------------------------------------------------------------

  get inputSchema(): Input {
    return inputSchema
  },

  get outputSchema() {
    return outputSchema
  },

  // -------------------------------------------------------------------------
  // Behavioral flags
  // -------------------------------------------------------------------------

  /**
   * isConcurrencySafe: true because this tool is pure computation.
   * No filesystem access, no shared state — safe to run in parallel.
   * Compare: GlobTool sets this to true (src/tools/GlobTool/GlobTool.ts:76)
   */
  isConcurrencySafe() {
    return true
  },

  /**
   * isReadOnly: true because we only read the input string.
   * No writes to filesystem or any external state.
   */
  isReadOnly() {
    return true
  },

  // -------------------------------------------------------------------------
  // Input validation
  //
  // validateInput runs BEFORE checkPermissions.
  // Use it for cheap checks that don't need user interaction.
  // Source: src/Tool.ts lines 489-492
  // -------------------------------------------------------------------------

  async validateInput(
    input: z.infer<Input>,
    _context: ToolUseContext,
  ): Promise<ValidationResult> {
    // Reject empty text — nothing meaningful to count
    if (input.text.trim().length === 0) {
      return {
        result: false,
        message: 'Cannot count words in empty text. Please provide non-empty text.',
        errorCode: 1,
      }
    }

    // Guard against extremely large inputs that would be slow
    const MAX_TEXT_LENGTH = 1_000_000 // 1 million characters
    if (input.text.length > MAX_TEXT_LENGTH) {
      return {
        result: false,
        message: `Text too large: ${input.text.length.toLocaleString()} chars. Maximum is ${MAX_TEXT_LENGTH.toLocaleString()}.`,
        errorCode: 2,
      }
    }

    return { result: true }
  },

  // -------------------------------------------------------------------------
  // Permission check
  //
  // For read-only, side-effect-free tools, always allow.
  // Tools with file access or external side effects use checkWritePermissionForTool()
  // or checkReadPermissionForTool() from src/utils/permissions/filesystem.ts.
  // Source: src/Tool.ts lines 500-503
  // -------------------------------------------------------------------------

  async checkPermissions(
    input: z.infer<Input>,
    _context: ToolUseContext,
  ): Promise<PermissionResult> {
    return { behavior: 'allow', updatedInput: input }
  },

  // -------------------------------------------------------------------------
  // Core execution
  //
  // Receives fully-validated, typed args. Must return { data: Output }.
  // Source: src/Tool.ts lines 379-385
  // -------------------------------------------------------------------------

  async call(
    args: z.infer<Input>,
    _context: ToolUseContext,
  ): Promise<ToolResult<Output>> {
    const lines = args.text.split('\n')

    // Word splitting: split on any whitespace, filter empty strings from
    // leading/trailing/multiple spaces
    const words = args.text.split(/\s+/).filter(w => w.length > 0)

    const result: Output = {
      lines: lines.length,
      words: words.length,
      chars: args.text.length,
    }

    // Optional per-line breakdown
    if (args.include_details) {
      result.breakdown = lines.map((line, i) => ({
        lineNumber: i + 1,
        words: line.split(/\s+/).filter(w => w.length > 0).length,
        chars: line.length,
      }))
    }

    return { data: result }
  },

  // -------------------------------------------------------------------------
  // Prompt & description
  //
  // prompt() is shown in the system message; description() is a brief summary.
  // Source: src/Tool.ts lines 518-524
  // -------------------------------------------------------------------------

  async prompt() {
    return `Count the number of words, lines, and characters in the provided text.

Parameters:
- text: The text to analyze (required)
- include_details: When true, include a per-line breakdown (optional, default false)

Returns an object with:
- lines: Total number of lines
- words: Total number of words (whitespace-separated)
- chars: Total number of characters
- breakdown: Array of per-line stats (only when include_details=true)`
  },

  async description() {
    return 'Count words, lines, and characters in text'
  },

  // -------------------------------------------------------------------------
  // UI rendering
  //
  // renderToolUseMessage is called with PARTIAL input while parameters stream.
  // Always handle undefined fields safely.
  // Source: src/Tool.ts lines 605-608
  // -------------------------------------------------------------------------

  renderToolUseMessage(input) {
    if (!input.text) {
      // Parameters still streaming — show placeholder
      return 'Counting...'
    }
    const preview = input.text.slice(0, 60)
    const ellipsis = input.text.length > 60 ? '...' : ''
    return `Counting words in: "${preview}${ellipsis}"`
  },

  renderToolResultMessage(content, options) {
    if (options?.style === 'condensed') {
      // Condensed view: single line
      return `${content.words} words, ${content.lines} lines, ${content.chars} chars`
    }

    // Full view: multi-line with breakdown if present
    const lines = [
      `Words: ${content.words.toLocaleString()}`,
      `Lines: ${content.lines.toLocaleString()}`,
      `Characters: ${content.chars.toLocaleString()}`,
    ]

    if (content.breakdown && content.breakdown.length > 0) {
      lines.push('', 'Per-line breakdown:')
      content.breakdown.slice(0, 20).forEach(row => {
        lines.push(`  Line ${row.lineNumber}: ${row.words} words, ${row.chars} chars`)
      })
      if (content.breakdown.length > 20) {
        lines.push(`  ... and ${content.breakdown.length - 20} more lines`)
      }
    }

    return lines.join('\n')
  },

  // -------------------------------------------------------------------------
  // Serialization
  //
  // mapToolResultToToolResultBlockParam converts Output to the API wire format.
  // The content must be a string or array of content blocks.
  // Source: src/Tool.ts lines 557-560
  // -------------------------------------------------------------------------

  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: JSON.stringify(content),
    }
  },

  // -------------------------------------------------------------------------
  // User-facing display
  // -------------------------------------------------------------------------

  userFacingName() {
    return 'Word Count'
  },
})

// ---------------------------------------------------------------------------
// Usage example (runnable with: npx ts-node simple-tool.ts)
// ---------------------------------------------------------------------------

async function demo() {
  const mockContext: ToolUseContext = {
    permissionMode: 'default',
    cwd: process.cwd(),
    abortController: new AbortController(),
    getAppState: () => ({}),
    messages: [],
  }

  const sampleText = `Hello world, this is a test.
The tool system is Claude Code's capability layer.
Every action goes through a Tool implementation.`

  console.log('=== WordCountTool Demo ===\n')
  console.log('Input text:')
  console.log(sampleText)
  console.log()

  // Validate input
  const validation = await WordCountTool.validateInput?.(
    { text: sampleText, include_details: true },
    mockContext,
  )
  console.log('Validation result:', validation)

  // Check permissions
  const permission = await WordCountTool.checkPermissions(
    { text: sampleText, include_details: true },
    mockContext,
  )
  console.log('Permission result:', permission)

  // Execute
  const result = await WordCountTool.call(
    { text: sampleText, include_details: true },
    mockContext,
  )
  console.log('\nTool result:')
  console.log(JSON.stringify(result.data, null, 2))

  // Render messages (returns strings in our simplified interface)
  console.log('\nUI rendering (condensed):')
  console.log(WordCountTool.renderToolResultMessage?.(result.data, { style: 'condensed', verbose: false }))

  console.log('\nUI rendering (full):')
  console.log(WordCountTool.renderToolResultMessage?.(result.data, { verbose: true }))
}

// Run if this is the entry point
if (require.main === module) {
  demo().catch(console.error)
}
