/**
 * Chapter 6: Service Layer & API Communication
 * Streaming API Client Example
 *
 * This file demonstrates the core patterns from Claude Code's service layer:
 * 1. Multi-provider API client factory (client.ts)
 * 2. AsyncGenerator-based retry with observable intermediate states (withRetry.ts)
 * 3. Exponential backoff with jitter (getRetryDelay)
 * 4. Three-tier token counting (tokenEstimation.ts)
 *
 * NOTE: This is a simplified educational example. It does NOT require a real API key.
 * Run with: npx ts-node streaming-api.ts (or via tsx)
 */

// ============================================================
// Section 1: Provider Selection (mirrors client.ts)
// ============================================================

/**
 * The four API providers Claude Code supports.
 * Selected via environment variables — the rest of the codebase
 * never needs to branch on which provider is active.
 */
type APIProvider = 'direct' | 'bedrock' | 'vertex' | 'foundry'

/**
 * Detect the active API provider from environment variables.
 * Mirrors the if-chain in getAnthropicClient() at client.ts:153-315.
 */
function detectProvider(): APIProvider {
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') return 'bedrock'
  if (process.env.CLAUDE_CODE_USE_FOUNDRY === '1') return 'foundry'
  if (process.env.CLAUDE_CODE_USE_VERTEX === '1') return 'vertex'
  return 'direct'
}

/**
 * Provider configuration returned by the factory.
 * In production, this would be an `Anthropic` SDK instance.
 * Here we use a simplified structure for demonstration.
 */
interface ProviderConfig {
  provider: APIProvider
  baseUrl: string
  authHeader: string
  timeout: number
}

/**
 * Factory function analogous to getAnthropicClient().
 *
 * Key behaviors from the real implementation:
 * - Returns a uniform interface regardless of underlying provider
 * - Handles auth differently per provider (API key, OAuth, AWS SigV4, GCP token)
 * - Applies a 600-second default timeout for long agentic tasks
 * - Only injects x-client-request-id for first-party API calls
 */
async function createProviderConfig(options: {
  apiKey?: string
  model?: string
  source?: string
}): Promise<ProviderConfig> {
  const provider = detectProvider()
  // 600-second timeout matches client.ts:144 — agentic tasks can be slow
  const timeout = parseInt(process.env.API_TIMEOUT_MS ?? String(600_000), 10)

  switch (provider) {
    case 'bedrock':
      // In production: AnthropicBedrock with AWS SigV4 signing
      // AWS credentials come from environment or ~/.aws/credentials
      return {
        provider: 'bedrock',
        baseUrl: `https://bedrock-runtime.${process.env.AWS_REGION ?? 'us-east-1'}.amazonaws.com`,
        authHeader: 'AWS4-HMAC-SHA256 ...',  // SigV4 in production
        timeout,
      }

    case 'vertex':
      // In production: AnthropicVertex with Google OAuth token
      // Prevents 12-second metadata server timeout (client.ts:241-288)
      return {
        provider: 'vertex',
        baseUrl: `https://${process.env.CLOUD_ML_REGION ?? 'us-east5'}-aiplatform.googleapis.com`,
        authHeader: `Bearer ${process.env.GOOGLE_TOKEN ?? 'gcp-token'}`,
        timeout,
      }

    case 'foundry':
      // In production: AnthropicFoundry with Azure AD token or API key
      return {
        provider: 'foundry',
        baseUrl: `https://${process.env.ANTHROPIC_FOUNDRY_RESOURCE}.services.ai.azure.com`,
        authHeader: `Bearer ${process.env.ANTHROPIC_FOUNDRY_API_KEY ?? 'azure-token'}`,
        timeout,
      }

    default:
      // Direct Anthropic API — first-party path
      return {
        provider: 'direct',
        baseUrl: 'https://api.anthropic.com',
        authHeader: `x-api-key ${options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? 'sk-ant-...'}`,
        timeout,
      }
  }
}

// ============================================================
// Section 2: Retry System (mirrors withRetry.ts)
// ============================================================

/**
 * Constants from withRetry.ts
 */
const BASE_DELAY_MS = 500           // withRetry.ts:55 — first retry delay
const DEFAULT_MAX_RETRIES = 10      // withRetry.ts:52
const MAX_DELAY_MS = 32_000         // withRetry.ts:533 — 32 second cap
const HEARTBEAT_INTERVAL_MS = 30_000 // withRetry.ts:98 — persistent retry heartbeat

/**
 * The "query source" tells the retry system who is asking.
 * Foreground sources (user is waiting) retry on 529.
 * Background sources (title generation, etc.) bail immediately.
 *
 * Mirrors FOREGROUND_529_RETRY_SOURCES at withRetry.ts:62-82.
 */
type QuerySource =
  | 'repl_main_thread'  // foreground — user is waiting
  | 'sdk'               // foreground — SDK caller
  | 'title_generation'  // background — user doesn't see failures
  | 'suggestion'        // background — user doesn't see failures

const FOREGROUND_SOURCES = new Set<QuerySource>([
  'repl_main_thread',
  'sdk',
])

function isForegroundSource(source: QuerySource): boolean {
  return FOREGROUND_SOURCES.has(source)
}

/**
 * Retry event yielded by withRetry during waits.
 * In production (withRetry.ts:493-499), this becomes a SystemAPIErrorMessage
 * that surfaces as {type:'system', subtype:'api_retry'} on stdout.
 */
interface RetryEvent {
  type: 'retry'
  attempt: number
  delayMs: number
  errorStatus?: number
  errorMessage: string
}

/**
 * Terminal error thrown when retries are exhausted.
 * Mirrors CannotRetryError at withRetry.ts:144-158.
 */
class CannotRetryError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly attempt: number,
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError))
    this.name = 'CannotRetryError'
  }
}

interface RetryOptions {
  maxRetries?: number
  querySource?: QuerySource
  signal?: AbortSignal
}

/**
 * Compute the delay for a retry attempt using exponential backoff + jitter.
 *
 * This is the exact algorithm from getRetryDelay() at withRetry.ts:530-548:
 *   delay = min(BASE_DELAY * 2^(attempt-1), maxDelayMs) * (1 + random * 0.25)
 *
 * The 25% jitter prevents "thundering herd" — if many clients all failed
 * at the same time, random jitter spreads their retries across time.
 *
 * Progression (without jitter, BASE_DELAY_MS=500ms):
 *   attempt 1: 500ms
 *   attempt 2: 1000ms
 *   attempt 3: 2000ms
 *   attempt 4: 4000ms
 *   attempt 5: 8000ms
 *   attempt 6: 16000ms
 *   attempt 7+: 32000ms (capped)
 */
function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs: number = MAX_DELAY_MS,
): number {
  // Honor server-sent Retry-After header (withRetry.ts:535-539)
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) return seconds * 1_000
  }

  // Exponential base: BASE_DELAY_MS * 2^(attempt-1), capped at maxDelayMs
  const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), maxDelayMs)

  // Jitter: up to 25% of the base delay (withRetry.ts:546-547)
  const jitter = Math.random() * 0.25 * baseDelay

  return Math.round(baseDelay + jitter)
}

/**
 * Simulate API errors for demonstration purposes.
 * In production, these come from the Anthropic SDK.
 */
class SimulatedAPIError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: string,
  ) {
    super(message)
    this.name = 'SimulatedAPIError'
  }
}

function shouldRetryError(error: unknown, querySource?: QuerySource): boolean {
  if (!(error instanceof SimulatedAPIError)) return false

  // 529 "overloaded" — only retry foreground sources (withRetry.ts:317-324)
  if (error.status === 529) {
    if (querySource && !isForegroundSource(querySource)) {
      console.log(
        `  [retry] 529 dropped for background source '${querySource}' — no retry amplification`,
      )
      return false
    }
    return true
  }

  // 429 rate limit — retry
  if (error.status === 429) return true

  // 408 request timeout — retry
  if (error.status === 408) return true

  // 5xx server errors — retry
  if (error.status >= 500) return true

  // 4xx client errors — don't retry
  return false
}

/**
 * AsyncGenerator-based retry wrapper.
 *
 * This demonstrates the key pattern from withRetry.ts:170-517.
 *
 * WHY AsyncGenerator?
 * The generator protocol lets the retry logic YIELD intermediate state
 * (retry events with delay info) upstream through the same channel as
 * the final result. Callers receive retry notifications without polling
 * or callbacks — they just iterate.
 *
 * The return type AsyncGenerator<RetryEvent, T> means:
 *   - .next() returns { value: RetryEvent, done: false } during waits
 *   - .next() returns { value: T, done: true } on success
 *   - generator throws on permanent failure
 */
async function* withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): AsyncGenerator<RetryEvent, T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    // Respect cancellation on each iteration (withRetry.ts:190-192)
    if (options.signal?.aborted) {
      throw new Error('Operation aborted')
    }

    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error

      console.log(
        `  [withRetry] attempt ${attempt}/${maxRetries + 1} failed: ` +
        `${error instanceof SimulatedAPIError ? `HTTP ${error.status}` : String(error)}`,
      )

      // Check if this error type is retryable
      if (!shouldRetryError(error, options.querySource)) {
        throw new CannotRetryError(error, attempt)
      }

      // Exhausted retries
      if (attempt > maxRetries) {
        throw new CannotRetryError(error, attempt)
      }

      // Compute delay (honor Retry-After header if present)
      const retryAfter = error instanceof SimulatedAPIError ? error.retryAfter : undefined
      const delayMs = getRetryDelay(attempt, retryAfter)

      // YIELD the retry event — this surfaces upstream as a UI notification
      // In production (withRetry.ts:508-510):
      //   yield createSystemAPIErrorMessage(error, delayMs, attempt, maxRetries)
      yield {
        type: 'retry',
        attempt,
        delayMs,
        errorStatus: error instanceof SimulatedAPIError ? error.status : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
      }

      // Sleep (interruptible via AbortSignal)
      await sleep(delayMs, options.signal)
    }
  }

  throw new CannotRetryError(lastError, maxRetries + 1)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Sleep aborted'))
    })
  })
}

// ============================================================
// Section 3: Streaming Response (mirrors query loop)
// ============================================================

/**
 * A streaming token event.
 * In production (query.ts:220-239), the query() AsyncGenerator yields
 * StreamEvent objects including text deltas, tool use blocks, and system messages.
 */
interface StreamToken {
  type: 'text_delta'
  text: string
  tokenIndex: number
}

interface StreamComplete {
  type: 'message_complete'
  totalTokens: number
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use'
}

type StreamEvent = RetryEvent | StreamToken | StreamComplete

/**
 * Simulates streaming a response from the API.
 * In production this wraps queryModelWithStreaming() from api/claude.ts,
 * which uses the Anthropic SDK's streaming API.
 */
async function* simulateStreamingResponse(
  prompt: string,
  failOnAttempt?: number,
  currentAttempt: number = 1,
): AsyncGenerator<StreamToken | StreamComplete> {
  // Simulate a 529 error on the first attempt for demonstration
  if (failOnAttempt !== undefined && currentAttempt <= failOnAttempt) {
    throw new SimulatedAPIError(529, 'overloaded_error: server is overloaded')
  }

  // Simulate streaming tokens one by one
  const words = `Hello! I received your prompt: "${prompt.slice(0, 30)}..."`.split(' ')
  let tokenIndex = 0

  for (const word of words) {
    // Simulate network latency between tokens
    await sleep(50)
    yield {
      type: 'text_delta',
      text: word + ' ',
      tokenIndex: tokenIndex++,
    }
  }

  yield {
    type: 'message_complete',
    totalTokens: tokenIndex * 3,  // rough estimate: ~3 tokens per word
    stopReason: 'end_turn',
  }
}

/**
 * Full streaming query with retry.
 *
 * This demonstrates how the query loop (query.ts) and withRetry (withRetry.ts)
 * compose: the retry generator wraps the streaming operation, and both
 * yield events that flow to the same consumer.
 *
 * In production:
 * - query.ts:query() is an AsyncGenerator yielding Message | StreamEvent | ...
 * - withRetry() is called inside queryModelWithStreaming()
 * - All yielded values flow through the same generator chain to the UI
 */
async function* streamingQuery(
  prompt: string,
  options: {
    querySource?: QuerySource
    maxRetries?: number
    simulateFailures?: number  // for demo: fail this many times before succeeding
  } = {},
): AsyncGenerator<StreamEvent> {
  const { querySource = 'repl_main_thread', maxRetries = 3, simulateFailures = 0 } = options

  // The withRetry generator wraps our streaming operation
  // Note: we need to "flatten" two generators — retry events and stream events
  // are interleaved in the same output channel
  const retryGen = withRetry(
    async (attempt: number) => {
      // Collect all stream events from this attempt
      const events: Array<StreamToken | StreamComplete> = []
      for await (const event of simulateStreamingResponse(prompt, simulateFailures, attempt)) {
        events.push(event)
      }
      return events
    },
    { maxRetries, querySource },
  )

  // Iterate the retry generator
  // - If it yields a RetryEvent: forward it (UI will show "Retrying...")
  // - If it returns successfully: yield all the stream events
  let result = await retryGen.next()
  while (!result.done) {
    // This is a RetryEvent (yielded during a wait between retries)
    yield result.value
    result = await retryGen.next()
  }

  // result.value is now the array of stream events from the successful attempt
  for (const event of result.value) {
    yield event
  }
}

// ============================================================
// Section 4: Token Estimation (mirrors tokenEstimation.ts)
// ============================================================

/**
 * Three-tier token counting from tokenEstimation.ts.
 *
 * Tier 1: API-based (exact) — countMessagesTokensWithAPI() at line 140
 * Tier 2: Haiku-based (cheap) — countTokensViaHaikuFallback() at line 251
 * Tier 3: Rough estimate (O(1)) — roughTokenCountEstimation() at line 203
 */

/**
 * Tier 3: Rough estimation — tokenEstimation.ts:203-208
 *
 * Uses bytes-per-token ratio:
 * - Default: 4 bytes/token (prose, code)
 * - JSON: 2 bytes/token (tokenEstimation.ts:215-223)
 *   because {, }, :, ,, " are single chars AND single tokens
 */
function roughTokenEstimation(
  content: string,
  fileExtension?: string,
): number {
  const bytesPerToken = fileExtension === 'json' ||
                        fileExtension === 'jsonl' ||
                        fileExtension === 'jsonc'
    ? 2   // Dense JSON — many single-character tokens
    : 4   // Default prose/code ratio

  return Math.round(content.length / bytesPerToken)
}

/**
 * Tier 1: API-based token counting (simulated).
 * In production: anthropic.beta.messages.countTokens() at tokenEstimation.ts:172
 * Returns null if the API is unavailable (triggers fallback to Tier 3).
 */
async function countTokensWithAPI(content: string): Promise<number | null> {
  // Simulate API unavailability for demonstration
  if (process.env.SIMULATE_NO_API === '1') {
    return null
  }
  // In production, this calls the real count tokens API
  // Here we simulate an accurate count (API charges per real token boundary)
  // Actual tokenizers use BPE; this is an approximation
  return Math.round(content.length / 3.8)  // slightly more accurate than /4
}

/**
 * Token counting with automatic fallback cascade.
 * Mirrors the pattern in tokenEstimation.ts where:
 * 1. Try API-based counting (most accurate)
 * 2. Fall back to rough estimation (always available)
 */
async function countTokens(
  content: string,
  fileExtension?: string,
): Promise<{ count: number; method: 'api' | 'rough' }> {
  // Tier 1: Try API-based counting
  const apiCount = await countTokensWithAPI(content)
  if (apiCount !== null) {
    return { count: apiCount, method: 'api' }
  }

  // Tier 3: Fall back to rough estimation
  return {
    count: roughTokenEstimation(content, fileExtension),
    method: 'rough',
  }
}

// ============================================================
// Section 5: Auto-compact Threshold (mirrors autoCompact.ts)
// ============================================================

/**
 * Context window thresholds from autoCompact.ts:62-65.
 * These trigger progressively more urgent actions.
 */
const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const WARNING_BUFFER_TOKENS = 20_000

/**
 * Calculate the token warning state for a given usage.
 * Mirrors calculateTokenWarningState() at autoCompact.ts:93-145.
 */
function calculateTokenWarningState(
  tokenUsage: number,
  contextWindow: number,
): {
  percentUsed: number
  isAboveWarningThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const effectiveWindow = contextWindow - 20_000  // reserve 20K for output
  const autoCompactThreshold = effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS
  const warningThreshold = effectiveWindow - WARNING_BUFFER_TOKENS
  const blockingLimit = effectiveWindow - 3_000

  return {
    percentUsed: Math.round((tokenUsage / effectiveWindow) * 100),
    isAboveWarningThreshold: tokenUsage >= warningThreshold,
    isAboveAutoCompactThreshold: tokenUsage >= autoCompactThreshold,
    isAtBlockingLimit: tokenUsage >= blockingLimit,
  }
}

// ============================================================
// Section 6: Demo Runner
// ============================================================

/**
 * Run all demonstrations.
 */
async function runDemo(): Promise<void> {
  console.log('='.repeat(60))
  console.log('Chapter 6: Service Layer — Interactive Demonstration')
  console.log('='.repeat(60))

  // --- Demo 1: Provider Detection ---
  console.log('\n[1] Provider Detection')
  console.log('-'.repeat(40))
  const config = await createProviderConfig({ source: 'demo' })
  console.log(`Active provider: ${config.provider}`)
  console.log(`Base URL: ${config.baseUrl}`)
  console.log(`Timeout: ${config.timeout / 1000}s`)
  console.log(
    `(Set CLAUDE_CODE_USE_BEDROCK=1 or CLAUDE_CODE_USE_VERTEX=1 to change provider)`,
  )

  // --- Demo 2: Backoff Algorithm ---
  console.log('\n[2] Exponential Backoff Algorithm')
  console.log('-'.repeat(40))
  console.log('Retry delays (no Retry-After header):')
  for (let attempt = 1; attempt <= 7; attempt++) {
    // Use 0 jitter for deterministic demo output
    const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS)
    console.log(`  Attempt ${attempt}: ${baseDelay}ms base + up to ${Math.round(baseDelay * 0.25)}ms jitter`)
  }
  console.log(`  (capped at ${MAX_DELAY_MS / 1000}s)`)

  // --- Demo 3: Streaming with Retry ---
  console.log('\n[3] Streaming Query with Retry (2 simulated 529 failures)')
  console.log('-'.repeat(40))

  const prompt = 'Explain the service layer architecture'
  let fullText = ''
  let tokenCount = 0

  for await (const event of streamingQuery(prompt, {
    querySource: 'repl_main_thread',
    maxRetries: 3,
    simulateFailures: 2,  // fail on attempts 1 and 2, succeed on attempt 3
  })) {
    if (event.type === 'retry') {
      // This is what the UI layer receives — it renders "Retrying in Xms..."
      console.log(
        `  [UI] API error (HTTP ${event.errorStatus ?? 'unknown'}): ` +
        `retrying in ${event.delayMs}ms (attempt ${event.attempt})`,
      )
    } else if (event.type === 'text_delta') {
      process.stdout.write(event.text)
      fullText += event.text
    } else if (event.type === 'message_complete') {
      tokenCount = event.totalTokens
      console.log(`\n  [complete] stop_reason=${event.stopReason}, tokens=${tokenCount}`)
    }
  }

  // --- Demo 4: 529 Background Source (no retry) ---
  console.log('\n[4] 529 Retry: Background Source Bails Immediately')
  console.log('-'.repeat(40))

  try {
    for await (const event of streamingQuery('Generate a title', {
      querySource: 'title_generation',  // background — no retry on 529
      maxRetries: 3,
      simulateFailures: 1,
    })) {
      if (event.type === 'retry') {
        console.log(`  [UI] Retry event: ${JSON.stringify(event)}`)
      }
    }
  } catch (error) {
    if (error instanceof CannotRetryError) {
      console.log(`  [expected] CannotRetryError thrown immediately for background source`)
      console.log(`  (no retry amplification during capacity cascades)`)
    }
  }

  // --- Demo 5: Token Estimation ---
  console.log('\n[5] Token Estimation: Three-Tier Cascade')
  console.log('-'.repeat(40))

  const samples = [
    { text: 'Hello, world!', ext: undefined },
    { text: '{"key": "value", "nested": {"a": 1, "b": 2}}', ext: 'json' },
    { text: 'function greet(name: string): string { return `Hello, ${name}!`; }', ext: 'ts' },
  ]

  for (const sample of samples) {
    const rough = roughTokenEstimation(sample.text, sample.ext)
    const precise = await countTokens(sample.text, sample.ext)

    console.log(`  "${sample.text.slice(0, 40)}..."`)
    console.log(`    File type: ${sample.ext ?? 'default (prose/code)'}`)
    console.log(`    Rough estimate: ${rough} tokens (${sample.ext === 'json' ? '2' : '4'} bytes/token)`)
    console.log(`    Precise (${precise.method}): ${precise.count} tokens`)
    console.log()
  }

  // --- Demo 6: Context Window Thresholds ---
  console.log('[6] Context Window Threshold Calculation')
  console.log('-'.repeat(40))

  const contextWindow = 200_000  // claude-3-5-sonnet
  const tokenLevels = [100_000, 155_000, 165_000, 180_000, 196_000]

  for (const usage of tokenLevels) {
    const state = calculateTokenWarningState(usage, contextWindow)
    const flags: string[] = []
    if (state.isAboveWarningThreshold) flags.push('WARNING')
    if (state.isAboveAutoCompactThreshold) flags.push('AUTO-COMPACT')
    if (state.isAtBlockingLimit) flags.push('BLOCKED')

    console.log(
      `  ${usage.toLocaleString()} tokens (${state.percentUsed}% used): ` +
      (flags.length > 0 ? flags.join(' + ') : 'OK'),
    )
  }

  console.log('\n' + '='.repeat(60))
  console.log('Demo complete. See docs/en/06-service-layer.md for details.')
  console.log('='.repeat(60))
}

// ============================================================
// Section 7: Type-Level PII Protection (mirrors analytics/index.ts)
// ============================================================

/**
 * Demonstrates the PII protection pattern from analytics/index.ts.
 *
 * The AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS type
 * is `never`, which forces an explicit cast at every analytics call site.
 * This makes PII leakage a compile-time error rather than a runtime surprise.
 *
 * See analytics/index.ts:19 for the production implementation.
 */
type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

interface AnalyticsEvent {
  eventName: string
  metadata: Record<string, boolean | number | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS>
}

function logAnalyticsEvent(event: AnalyticsEvent): void {
  // In production: routes to Datadog + Anthropic's internal BigQuery
  console.log(`[analytics] ${event.eventName}:`, event.metadata)
}

// Correct usage — developer explicitly verified no PII:
function logRetryEvent(attempt: number, errorStatus: number, _errorMessage: string): void {
  logAnalyticsEvent({
    eventName: 'tengu_api_retry',
    metadata: {
      attempt,
      // NOTE: We log status (a number, safe) but NOT errorMessage (could contain PII)
      // To log a string, it must be cast:
      //   errorMessage: message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      // This forces a manual review at the call site.
      status: errorStatus,
    },
  })
}

// ============================================================
// Entry Point
// ============================================================

runDemo().catch(console.error)

export {
  createProviderConfig,
  withRetry,
  getRetryDelay,
  streamingQuery,
  roughTokenEstimation,
  countTokens,
  calculateTokenWarningState,
  logRetryEvent,
}

export type {
  APIProvider,
  ProviderConfig,
  RetryOptions,
  RetryEvent,
  StreamEvent,
  QuerySource,
  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
}
