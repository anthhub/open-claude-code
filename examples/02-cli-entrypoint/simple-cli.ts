/**
 * simple-cli.ts — Chapter 2 Hands-on Example
 *
 * This file demonstrates Claude Code's CLI startup patterns in a simplified form.
 * It is NOT production code — it is a teaching tool showing how each technique works.
 *
 * Patterns demonstrated:
 *   1. Fast-path dispatch (--version before any heavy module loading)
 *   2. Parallel prefetch at module evaluation time
 *   3. Memoized initialization (init() runs exactly once)
 *   4. Commander.js preAction hook (init before commands, not before --help)
 *   5. Interactive vs headless mode branching
 *
 * Claude Code source references:
 *   - Fast-path:   src/entrypoints/cli.tsx:37-42
 *   - Prefetch:    src/main.tsx:14-20
 *   - Memoize:     src/entrypoints/init.ts:57
 *   - preAction:   src/main.tsx:907-967
 *   - State:       src/bootstrap/state.ts
 */

import { readFile } from 'fs/promises'
import { join } from 'path'

// ============================================================
// PATTERN 1: Parallel Prefetch at Module Evaluation Time
//
// Claude Code analogue: src/main.tsx:14-20
//   startMdmRawRead();       // spawns subprocess immediately
//   startKeychainPrefetch(); // starts keychain read immediately
//
// These fire at import/module-eval time — before any function is called.
// By the time the rest of the module finishes loading (~135ms of imports),
// the slow I/O operations have completed in parallel.
// ============================================================

/**
 * Simulates reading credentials from a slow source (e.g., system keychain).
 * In Claude Code this is: ensureKeychainPrefetchCompleted()
 */
async function simulateCredentialRead(): Promise<string | null> {
  // Simulate ~50ms keychain read
  await new Promise(resolve => setTimeout(resolve, 50))
  return process.env.API_KEY ?? 'demo-key-12345'
}

/**
 * Simulates reading managed policy settings (e.g., MDM/enterprise config).
 * In Claude Code this is: ensureMdmSettingsLoaded()
 */
async function simulatePolicyRead(): Promise<Record<string, boolean>> {
  // Simulate ~30ms policy lookup
  await new Promise(resolve => setTimeout(resolve, 30))
  return { allowNetworkAccess: true, allowFileWrite: true }
}

// START PREFETCH IMMEDIATELY at module evaluation time.
// These run concurrently with the Commander.js import below (~50ms).
const credentialPrefetch = simulateCredentialRead()
const policyPrefetch = simulatePolicyRead()

const prefetchStart = Date.now()
console.log('[startup] Prefetch started (credential + policy reads running in background)')

// ============================================================
// PATTERN 2: Fast-Path Dispatch
//
// Claude Code analogue: src/entrypoints/cli.tsx:37-42
//
// Handle special flags BEFORE loading any heavy modules.
// The --version path exits in < 10ms because it imports nothing.
// ============================================================

const rawArgs = process.argv.slice(2)

if (rawArgs[0] === '--version' || rawArgs[0] === '-v') {
  // Zero imports. Zero module loading. Just a string comparison.
  // In Claude Code, MACRO.VERSION is a build-time constant.
  console.log('1.0.0 (Simple CLI Demo)')
  process.exit(0)
}

// For all other paths, load Commander.js (the "heavy" module)
// This dynamic import ensures --version pays zero Commander cost.
// Claude Code uses @commander-js/extra-typings for strict typing;
// here we use the standard 'commander' package to avoid extra dependencies.
const { Command } = await import('commander')

console.log(`[startup] Commander loaded after ${Date.now() - prefetchStart}ms`)

// ============================================================
// PATTERN 3: Memoized Initialization
//
// Claude Code analogue: src/entrypoints/init.ts:57
//   export const init = memoize(async (): Promise<void> => { ... })
//
// The memoize wrapper guarantees:
//   - First call: runs initialization, returns a Promise
//   - Second call: returns the same (already-resolved) Promise
//   - No race conditions even with concurrent callers
// ============================================================

// Simple memoize implementation (in Claude Code, this is lodash-es/memoize)
function memoizeAsync<T>(fn: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null
  return () => {
    if (!promise) {
      promise = fn()
    }
    return promise
  }
}

/** Session state — Claude Code analogue: src/bootstrap/state.ts */
const sessionState = {
  isInteractive: false,
  apiKey: null as string | null,
  policy: null as Record<string, boolean> | null,
  initStartTime: 0,
  initEndTime: 0,
}

/**
 * Core initialization — Claude Code analogue: src/entrypoints/init.ts
 *
 * Key properties:
 *   1. Wrapped in memoize → runs exactly once
 *   2. Awaits prefetch results (nearly free by now)
 *   3. Sets up session state
 *   4. Fire-and-forget background work (void Promise)
 */
const init = memoizeAsync(async (): Promise<void> => {
  sessionState.initStartTime = Date.now()
  console.log('[init] Starting initialization...')

  // Step 1: Collect prefetch results
  // Claude Code: await Promise.all([ensureMdmSettingsLoaded(), ensureKeychainPrefetchCompleted()])
  // These were started at module-eval time, so they're nearly done by now.
  const [credential, policy] = await Promise.all([credentialPrefetch, policyPrefetch])
  console.log(`[init] Prefetch results collected (started ${Date.now() - prefetchStart}ms ago)`)

  // Step 2: Store in session state
  // Claude Code: setters in bootstrap/state.ts
  sessionState.apiKey = credential
  sessionState.policy = policy

  // Step 3: Fire-and-forget background work
  // Claude Code: void Promise.all([import('analytics'), import('growthbook')])
  void (async () => {
    await new Promise(resolve => setTimeout(resolve, 100))
    console.log('[init] [background] Analytics initialized (non-blocking)')
  })()

  // Step 4: Preconnect to API (fire-and-forget)
  // Claude Code: preconnectAnthropicApi() in src/entrypoints/init.ts:159
  void (async () => {
    await new Promise(resolve => setTimeout(resolve, 80))
    console.log('[init] [background] API connection pre-warmed (non-blocking)')
  })()

  sessionState.initEndTime = Date.now()
  const initDuration = sessionState.initEndTime - sessionState.initStartTime
  console.log(`[init] Initialization complete in ${initDuration}ms`)
})

// ============================================================
// Commander.js Program Definition
//
// Claude Code analogue: src/main.tsx:884-967 (the run() function)
// ============================================================

const program = new Command()
  .name('simple-cli')
  .description('A simplified CLI demonstrating Claude Code startup patterns')
  .version('1.0.0', '--version', 'Show version number')
  .helpOption('-h, --help', 'Show help')

// ============================================================
// PATTERN 4: preAction Hook
//
// Claude Code analogue: src/main.tsx:907-967
//   program.hook('preAction', async thisCommand => {
//     await Promise.all([ensureMdmSettingsLoaded(), ensureKeychainPrefetchCompleted()])
//     await init()
//     initSinks()
//   })
//
// Key insight: preAction runs BEFORE every command action,
// but NOT when displaying help (--help). This means:
//   - claude --help     → instant, no init()
//   - claude foo        → init() runs before action
//   - claude bar        → init() returns cached promise (nearly free)
// ============================================================

program.hook('preAction', async () => {
  console.log('\n[preAction] Hook fired — running before command action')

  // This is where we await init(). Because init() is memoized,
  // calling it here is safe even if another code path also calls it.
  await init()

  // Determine interactive vs headless mode
  // Claude Code: STATE.isInteractive set in main.tsx based on TTY + flags
  const isPrintMode = rawArgs.includes('-p') || rawArgs.includes('--print')
  sessionState.isInteractive = !isPrintMode && (process.stdout.isTTY ?? false)

  console.log(`[preAction] Mode: ${sessionState.isInteractive ? 'interactive' : 'headless'}`)
})

// ============================================================
// PATTERN 5: Interactive vs Headless Mode
//
// Claude Code analogue: src/bootstrap/state.ts:1057-1066
//   getIsNonInteractiveSession() / setIsInteractive()
//
// Interactive mode:  renders Ink TUI, enters REPL event loop
// Headless mode:     prints to stdout, exits after one query
// ============================================================

program
  .command('greet [name]')
  .description('Greet someone (demonstrates interactive vs headless mode)')
  .option('-p, --print', 'Print mode: output result and exit (headless)')
  .option('--output-format <format>', 'Output format: text or json', 'text')
  .action(async (name: string | undefined, opts: { print?: boolean; outputFormat: string }) => {
    const greeting = `Hello, ${name ?? 'World'}!`
    const timestamp = new Date().toISOString()

    if (opts.print || !sessionState.isInteractive) {
      // Headless mode: structured output to stdout
      // Claude Code: src/entrypoints/print.ts handles this path
      if (opts.outputFormat === 'json') {
        console.log(JSON.stringify({ greeting, timestamp, mode: 'headless' }))
      } else {
        console.log(greeting)
      }
    } else {
      // Interactive mode: rich terminal output
      // Claude Code: Ink/React components render here
      console.log('\n╔══════════════════════════════╗')
      console.log(`║  ${greeting.padEnd(28)}║`)
      console.log(`║  Mode: interactive            ║`)
      console.log(`║  Time: ${timestamp.slice(11, 19).padEnd(22)}║`)
      console.log('╚══════════════════════════════╝\n')
    }
  })

program
  .command('status')
  .description('Show current session state')
  .action(async () => {
    // init() guaranteed to have run before this action (preAction hook)
    console.log('\nSession State:')
    console.log(`  API Key:     ${sessionState.apiKey ? '***' + sessionState.apiKey.slice(-4) : 'not set'}`)
    console.log(`  Interactive: ${sessionState.isInteractive}`)
    console.log(`  Policy:      ${JSON.stringify(sessionState.policy)}`)
    console.log(`  Init time:   ${sessionState.initEndTime - sessionState.initStartTime}ms`)
  })

program
  .command('demo-memoize')
  .description('Demonstrate that init() runs only once even when called multiple times')
  .action(async () => {
    console.log('\nCalling init() 3 more times (should be instant — already memoized):')
    const t0 = Date.now()
    await init()
    console.log(`  Call 1: ${Date.now() - t0}ms`)
    const t1 = Date.now()
    await init()
    console.log(`  Call 2: ${Date.now() - t1}ms`)
    const t2 = Date.now()
    await init()
    console.log(`  Call 3: ${Date.now() - t2}ms`)
    console.log('All three returned the cached Promise — zero additional work.')
  })

// ============================================================
// Main entry point
// ============================================================

await program.parseAsync(process.argv)
