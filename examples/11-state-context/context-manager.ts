/**
 * Chapter 11 Example: Context Manager
 *
 * A minimal implementation that mirrors Claude Code's state and context patterns:
 *   - createStore (src/state/store.ts) — Object.is shallow comparison, Set<Listener>
 *   - Context collection (src/context.ts) — memoized getSystemContext / getUserContext
 *   - Compression thresholds (src/services/compact/autoCompact.ts) — multi-level gates
 *   - Session Memory (src/services/SessionMemory/sessionMemory.ts) — sequential writes
 *   - Auto Memory Extraction (src/services/extractMemories/extractMemories.ts) — closure state
 *   - Memory Types (src/memdir/memoryTypes.ts) — user / feedback / project / reference
 */

// ============================================================================
// 1. Minimal Store — mirrors src/state/store.ts:1-34
// ============================================================================

type Listener = () => void
type OnChange<T> = (args: { newState: T; oldState: T }) => void

export type Store<T> = {
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: Listener) => () => void // returns unsubscribe fn
}

/**
 * createStore — identical semantics to src/state/store.ts.
 *
 * Key design decisions:
 *   - Object.is for change detection: avoids unnecessary renders for NaN and ±0
 *   - Set<Listener> deduplicates accidentally double-registered listeners
 *   - Functional updater (prev => next) prevents stale-closure bugs
 *   - onChange fires before listeners so external side-effects see state first
 */
export function createStore<T>(
  initialState: T,
  onChange?: OnChange<T>,
): Store<T> {
  let state = initialState
  const listeners = new Set<Listener>()

  return {
    getState: () => state,

    setState: (updater: (prev: T) => T) => {
      const prev = state
      const next = updater(prev)
      // Object.is correctly handles NaN === NaN (true) and +0 === -0 (false)
      if (Object.is(next, prev)) return
      state = next
      onChange?.({ newState: next, oldState: prev })
      for (const listener of listeners) listener()
    },

    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener) // cleanup / unsubscribe
    },
  }
}

// ============================================================================
// 2. AppState shape — subset of src/state/AppStateStore.ts:89-452
// ============================================================================

/**
 * Simplified AppState.
 * The real AppState is ~360 lines and uses DeepImmutable<{}> for most fields,
 * while mutable fields (tasks, agentNameRegistry) are excluded from that wrapper.
 */
export type AppState = {
  // UI
  verbose: boolean
  statusLineText: string | undefined
  // Conversation
  messages: ConversationMessage[]
  tokenCount: number
  // Memory
  sessionMemoryPath: string | undefined
  // Compression tracking
  compactionTracking: CompactionTracking
}

export type ConversationMessage = {
  uuid: string
  type: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  tokenEstimate: number
}

export type CompactionTracking = {
  compacted: boolean
  turnCounter: number
  consecutiveFailures: number
}

// Global singleton — mirrors src/bootstrap/state.ts pattern
// In Claude Code the singleton is created once in main.tsx and passed via
// React context / direct import. The file is kept isolated so tests can reset it.
let _globalStore: Store<AppState> | null = null

export function getGlobalStore(): Store<AppState> {
  if (!_globalStore) {
    _globalStore = createStore<AppState>({
      verbose: false,
      statusLineText: undefined,
      messages: [],
      tokenCount: 0,
      sessionMemoryPath: undefined,
      compactionTracking: {
        compacted: false,
        turnCounter: 0,
        consecutiveFailures: 0,
      },
    })
  }
  return _globalStore
}

/** Reset for testing — same pattern as resetSettingsCache() in Claude Code */
export function resetGlobalStore(): void {
  _globalStore = null
}

// ============================================================================
// 3. Context Collection — mirrors src/context.ts:116-189
// ============================================================================

type ContextMap = { [key: string]: string }

/**
 * Simple memoize — once computed per process, cached forever.
 * Claude Code uses lodash-es/memoize with .cache.clear() for invalidation.
 */
function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null
  const wrapper = () => {
    if (!cached) cached = fn()
    return cached
  }
  // Expose cache clear for testing (lodash uses fn.cache.clear)
  ;(wrapper as typeof wrapper & { clearCache(): void }).clearCache = () => {
    cached = null
  }
  return wrapper
}

/**
 * Collect system-level context: git status, environment metadata.
 * Mirrors getSystemContext() in src/context.ts:116-150.
 *
 * Memoized: called once per conversation, not per API request.
 */
export const getSystemContext = memoize(async (): Promise<ContextMap> => {
  const gitStatus = await getGitStatus()
  return {
    ...(gitStatus ? { gitStatus } : {}),
    platform: process.platform,
    nodeVersion: process.version,
  }
})

/**
 * Collect user-level context: CLAUDE.md files, current date.
 * Mirrors getUserContext() in src/context.ts:155-189.
 *
 * Memoized: invalidated when CLAUDE.md files change on disk.
 */
export const getUserContext = memoize(async (): Promise<ContextMap> => {
  const claudeMd = await loadClaudeMd()
  return {
    ...(claudeMd ? { claudeMd } : {}),
    currentDate: `Today's date is ${new Date().toISOString().split('T')[0]}.`,
  }
})

/** Stub: in production this runs git commands via execFileNoThrow */
async function getGitStatus(): Promise<string | null> {
  // Real implementation: src/context.ts:36-111
  // Runs: git status --short, git log --oneline -n 5, git branch, git config user.name
  return process.env.NODE_ENV !== 'test'
    ? 'Branch: main\nStatus: (clean)\nRecent commits: (none)'
    : null
}

/** Stub: in production walks the filesystem looking for CLAUDE.md files */
async function loadClaudeMd(): Promise<string | null> {
  // Real implementation: src/utils/claudemd.ts — directory walk, filterInjectedMemoryFiles
  return null
}

// ============================================================================
// 4. Token Compression Thresholds — mirrors src/services/compact/autoCompact.ts
// ============================================================================

// Constants from autoCompact.ts:62-65
const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

/**
 * Calculate which threshold the current token count has crossed.
 *
 * Four levels (from autoCompact.ts:93-145):
 *   warning   — approaching limit, show UI indicator
 *   error     — near limit, show strong warning
 *   autoCompact — trigger background compaction
 *   blocking  — refuse new prompts until compacted
 */
export function calculateTokenWarningState(
  tokenUsage: number,
  contextWindow: number,
  autoCompactEnabled: boolean,
): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  // Effective window reserves room for the compaction summary output
  // In production: getEffectiveContextWindowSize() subtracts max output tokens
  const effectiveWindow = contextWindow - 20_000 // simplified

  const autoCompactThreshold = effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS
  const threshold = autoCompactEnabled ? autoCompactThreshold : effectiveWindow

  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100),
  )

  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const errorThreshold = threshold - ERROR_THRESHOLD_BUFFER_TOKENS
  const blockingLimit = effectiveWindow - MANUAL_COMPACT_BUFFER_TOKENS

  return {
    percentLeft,
    isAboveWarningThreshold: tokenUsage >= warningThreshold,
    isAboveErrorThreshold: tokenUsage >= errorThreshold,
    isAboveAutoCompactThreshold:
      autoCompactEnabled && tokenUsage >= autoCompactThreshold,
    isAtBlockingLimit: tokenUsage >= blockingLimit,
  }
}

// ============================================================================
// 5. Session Memory — mirrors src/services/SessionMemory/sessionMemory.ts
// ============================================================================

export type SessionMemoryConfig = {
  minimumMessageTokensToInit: number // tokens before first extraction
  minimumTokensBetweenUpdate: number // token growth between updates
  toolCallsBetweenUpdates: number    // tool calls between updates
}

const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
  minimumMessageTokensToInit: 10_000,
  minimumTokensBetweenUpdate: 5_000,
  toolCallsBetweenUpdates: 10,
}

/**
 * SessionMemory service.
 *
 * Responsibilities (from sessionMemory.ts:1-495):
 *   1. Register a post-sampling hook that runs after each model turn
 *   2. Check shouldExtractMemory() — dual threshold (tokens + tool calls)
 *   3. Fork a subagent to update the session memory markdown file
 *   4. Use sequential() to serialize writes (no concurrent file edits)
 *
 * The forked agent runs with createMemoryFileCanUseTool (lines 460-481),
 * which only allows FileEdit on the exact session memory file path.
 */
export class SessionMemoryService {
  private config: SessionMemoryConfig
  private initialized = false
  private tokenCountAtLastExtraction = 0
  private lastMemoryMessageUuid: string | undefined

  // sequential() wrapper: ensures only one extraction runs at a time.
  // In production this is utils/sequential.ts wrapping the async function.
  private extractionQueue: Promise<void> = Promise.resolve()

  constructor(config: Partial<SessionMemoryConfig> = {}) {
    this.config = { ...DEFAULT_SESSION_MEMORY_CONFIG, ...config }
  }

  /**
   * Decide whether to extract session memory.
   * Mirrors shouldExtractMemory() in sessionMemory.ts:134-181.
   *
   * Requires:
   *   - Token count > init threshold (first run) OR already initialized
   *   - Token growth since last extraction > minimumTokensBetweenUpdate
   *   - Tool call count since last extraction > toolCallsBetweenUpdates
   *     OR no tool calls in last turn (natural break point)
   */
  shouldExtract(messages: ConversationMessage[], currentTokens: number): boolean {
    if (!this.initialized) {
      if (currentTokens < this.config.minimumMessageTokensToInit) return false
      this.initialized = true
    }

    const tokenGrowth = currentTokens - this.tokenCountAtLastExtraction
    const hasMetTokenThreshold =
      tokenGrowth >= this.config.minimumTokensBetweenUpdate

    const toolCallsSinceLastUpdate = this.countToolCallsSince(messages)
    const hasMetToolCallThreshold =
      toolCallsSinceLastUpdate >= this.config.toolCallsBetweenUpdates

    const lastMsg = messages[messages.length - 1]
    const noToolCallsInLastTurn =
      lastMsg?.type !== 'assistant' || !lastMsg.content.includes('[tool_use]')

    // Token threshold is ALWAYS required (prevents runaway extraction)
    return (
      (hasMetTokenThreshold && hasMetToolCallThreshold) ||
      (hasMetTokenThreshold && noToolCallsInLastTurn)
    )
  }

  private countToolCallsSince(messages: ConversationMessage[]): number {
    let count = 0
    let found = this.lastMemoryMessageUuid === undefined
    for (const msg of messages) {
      if (!found) {
        if (msg.uuid === this.lastMemoryMessageUuid) found = true
        continue
      }
      if (msg.type === 'assistant' && msg.content.includes('[tool_use]')) {
        count++
      }
    }
    return count
  }

  /**
   * Queue a session memory extraction.
   * Uses a promise chain for serialization — mirrors sequential() in utils/sequential.ts.
   */
  async enqueueExtraction(
    messages: ConversationMessage[],
    currentTokens: number,
    memoryPath: string,
  ): Promise<void> {
    this.extractionQueue = this.extractionQueue.then(() =>
      this.doExtract(messages, currentTokens, memoryPath),
    )
    return this.extractionQueue
  }

  private async doExtract(
    messages: ConversationMessage[],
    currentTokens: number,
    memoryPath: string,
  ): Promise<void> {
    if (!this.shouldExtract(messages, currentTokens)) return

    // In production: runForkedAgent() runs a subagent that edits the file.
    // canUseTool only allows FileEditTool on the exact memoryPath.
    console.log(`[SessionMemory] Extracting to ${memoryPath}`)

    // Update cursor after extraction
    const lastMsg = messages[messages.length - 1]
    if (lastMsg) this.lastMemoryMessageUuid = lastMsg.uuid
    this.tokenCountAtLastExtraction = currentTokens
  }
}

// ============================================================================
// 6. Auto Memory Extraction — mirrors src/services/extractMemories/extractMemories.ts
// ============================================================================

/**
 * Memory types — from src/memdir/memoryTypes.ts:14-21.
 *
 * Only four types are valid. Claude Code evals showed that a richer taxonomy
 * caused more confusion than benefit.
 */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export type MemoryRecord = {
  name: string
  description: string // used to decide relevance in future conversations
  type: MemoryType
  body: string        // for feedback/project: rule + Why: + How to apply:
}

/**
 * Auto Memory Extractor — closure-scoped state pattern.
 *
 * Claude Code uses initExtractMemories() (extractMemories.ts:296-587) to
 * create a fresh closure instead of module-level variables. This makes
 * unit tests trivial: call init() in beforeEach and get a blank slate.
 *
 * Key behaviors:
 *   - inProgress flag prevents overlapping forked agents
 *   - pendingContext stashes the latest call during an in-progress run
 *     (trailing run processes it after the current one finishes)
 *   - Cursor (lastMemoryMessageUuid) advances only on success
 *   - hasMemoryWritesSince() skips extraction when the main agent wrote
 *     memories directly — prevents duplicate writes (mutual exclusion)
 *   - Max 5 turns per extraction (well-behaved runs complete in 2-4)
 */
export function initAutoMemoryExtractor() {
  // Closure-scoped state — fresh on each init() call
  let lastMemoryMessageUuid: string | undefined
  let inProgress = false
  let pendingMessages: ConversationMessage[] | undefined
  const inFlightExtractions = new Set<Promise<void>>()

  async function runExtraction(messages: ConversationMessage[]): Promise<void> {
    const newMsgCount = countMessagesSince(messages, lastMemoryMessageUuid)

    // Mutual exclusion: skip if main agent already wrote to memory this range
    if (hasMemoryWritesSince(messages, lastMemoryMessageUuid)) {
      console.log('[AutoMem] skipping — main agent already wrote memories')
      advanceCursor(messages)
      return
    }

    inProgress = true
    try {
      console.log(`[AutoMem] extracting from ${newMsgCount} new messages`)

      // Production: runForkedAgent({ maxTurns: 5, querySource: 'extract_memories' })
      // canUseTool: Read/Grep/Glob unrestricted; Edit/Write only in auto-mem dir
      const memories = await simulateExtraction(messages, lastMemoryMessageUuid)
      memories.forEach(m => saveMemory(m))

      advanceCursor(messages)
    } catch (e) {
      console.error('[AutoMem] extraction failed:', e)
      // Cursor NOT advanced — messages will be reconsidered next turn
    } finally {
      inProgress = false

      // Process stashed context (trailing run)
      const trailing = pendingMessages
      pendingMessages = undefined
      if (trailing) {
        await runExtraction(trailing)
      }
    }
  }

  function advanceCursor(messages: ConversationMessage[]): void {
    const last = messages[messages.length - 1]
    if (last) lastMemoryMessageUuid = last.uuid
  }

  return {
    /**
     * Entry point — called fire-and-forget at end of each query loop.
     * If an extraction is in progress, stash context for a trailing run.
     */
    async extract(messages: ConversationMessage[]): Promise<void> {
      if (inProgress) {
        console.log('[AutoMem] coalescing — trailing run will pick this up')
        pendingMessages = messages // latest wins
        return
      }
      const p = runExtraction(messages)
      inFlightExtractions.add(p)
      try {
        await p
      } finally {
        inFlightExtractions.delete(p)
      }
    },

    /** Await all in-flight extractions (called before process exit) */
    async drain(timeoutMs = 60_000): Promise<void> {
      if (inFlightExtractions.size === 0) return
      await Promise.race([
        Promise.all(inFlightExtractions).catch(() => {}),
        new Promise<void>(r => setTimeout(r, timeoutMs).unref?.()),
      ])
    },
  }
}

// ============================================================================
// 7. Memory Storage (simplified)
// ============================================================================

const memoryStore = new Map<string, MemoryRecord>()

/** Save a memory record — in production this writes frontmatter .md files */
export function saveMemory(record: MemoryRecord): void {
  // Real path: ~/.claude/projects/<sanitized-git-root>/memory/<name>.md
  memoryStore.set(record.name, record)
  console.log(`[Memory] saved ${record.type} memory: "${record.name}"`)
}

/** Load all memories of a given type — used to inject relevant context */
export function loadMemoriesByType(type: MemoryType): MemoryRecord[] {
  return Array.from(memoryStore.values()).filter(m => m.type === type)
}

// ============================================================================
// Helpers
// ============================================================================

function countMessagesSince(
  messages: ConversationMessage[],
  sinceUuid: string | undefined,
): number {
  if (!sinceUuid) return messages.length
  let found = false
  let n = 0
  for (const m of messages) {
    if (!found) {
      if (m.uuid === sinceUuid) found = true
      continue
    }
    n++
  }
  return found ? n : messages.length
}

function hasMemoryWritesSince(
  messages: ConversationMessage[],
  sinceUuid: string | undefined,
): boolean {
  // Real impl checks tool_use blocks for FileEdit/FileWrite targeting isAutoMemPath()
  let found = sinceUuid === undefined
  for (const m of messages) {
    if (!found) {
      if (m.uuid === sinceUuid) found = true
      continue
    }
    if (m.type === 'assistant' && m.content.includes('[memory_write]')) {
      return true
    }
  }
  return false
}

/** Stub: real impl calls runForkedAgent and parses written file paths */
async function simulateExtraction(
  messages: ConversationMessage[],
  _sinceUuid: string | undefined,
): Promise<MemoryRecord[]> {
  // In production the forked agent reads existing MEMORY.md, scans new messages,
  // and writes / edits topic files in the auto-memory directory.
  return []
}

// ============================================================================
// 8. Demo — wire everything together
// ============================================================================

async function main() {
  console.log('=== Chapter 11: State Management & Context Demo ===\n')

  // 1. Create store
  const store = getGlobalStore()
  const unsubscribe = store.subscribe(() => {
    const s = store.getState()
    console.log(`[Store] tokenCount changed: ${s.tokenCount}`)
  })

  // 2. Add messages & update token count
  store.setState(prev => ({
    ...prev,
    messages: [
      ...prev.messages,
      {
        uuid: 'msg-001',
        type: 'user',
        content: 'Hello, Claude!',
        timestamp: Date.now(),
        tokenEstimate: 4,
      },
    ],
    tokenCount: prev.tokenCount + 4,
  }))

  // Object.is check: identical state → no listener fired
  const prevState = store.getState()
  store.setState(() => prevState) // same reference → Object.is → skip
  console.log('[Store] no listener fired for same-reference update (Object.is)\n')

  // 3. Collect context
  const [system, user] = await Promise.all([getSystemContext(), getUserContext()])
  console.log('[Context] system keys:', Object.keys(system))
  console.log('[Context] user keys:', Object.keys(user))
  console.log()

  // 4. Check compression thresholds
  const CONTEXT_WINDOW = 200_000
  const thresholds = calculateTokenWarningState(185_000, CONTEXT_WINDOW, true)
  console.log('[Compact] token warning state for 185k/200k tokens:')
  console.log('  percentLeft:', thresholds.percentLeft)
  console.log('  isAboveWarningThreshold:', thresholds.isAboveWarningThreshold)
  console.log('  isAboveAutoCompactThreshold:', thresholds.isAboveAutoCompactThreshold)
  console.log()

  // 5. Session memory extraction check
  const sessionMem = new SessionMemoryService({
    minimumMessageTokensToInit: 100, // low threshold for demo
    minimumTokensBetweenUpdate: 50,
    toolCallsBetweenUpdates: 2,
  })
  const messages: ConversationMessage[] = [
    { uuid: 'u1', type: 'user', content: 'task', timestamp: 1, tokenEstimate: 10 },
    { uuid: 'a1', type: 'assistant', content: '[tool_use] bash', timestamp: 2, tokenEstimate: 20 },
    { uuid: 'a2', type: 'assistant', content: 'Done', timestamp: 3, tokenEstimate: 10 },
  ]
  console.log('[SessionMemory] shouldExtract:', sessionMem.shouldExtract(messages, 200))

  // 6. Auto memory
  const extractor = initAutoMemoryExtractor()
  await extractor.extract(messages)

  // 7. Save a memory
  saveMemory({
    name: 'user_role',
    description: 'User is a TypeScript engineer focused on AI tooling',
    type: 'user',
    body: 'User is a TypeScript engineer building AI agent tooling.',
  })
  saveMemory({
    name: 'feedback_terse',
    description: 'User prefers terse responses without trailing summaries',
    type: 'feedback',
    body: 'Keep responses terse. **Why:** user said "I can read the diff". **How to apply:** skip summary paragraphs after tool use.',
  })

  console.log('\n[Memory] user memories:', loadMemoriesByType('user').length)
  console.log('[Memory] feedback memories:', loadMemoriesByType('feedback').length)

  unsubscribe()
  console.log('\nDemo complete.')
}

main().catch(console.error)
