/**
 * Chapter 7: Permission System — Hands-on Example
 *
 * Demonstrates the key patterns from Claude Code's permission system:
 * 1. Multi-source rule loading with priority ordering
 * 2. Three-behavior rules: allow / deny / ask
 * 3. Wildcard pattern matching (git *, npm run *)
 * 4. Resolve-once concurrent guard (prevents double-resolution)
 * 5. Mode-level overrides (bypassPermissions, dontAsk)
 *
 * Source references:
 *   src/types/permissions.ts
 *   src/utils/permissions/permissions.ts
 *   src/utils/permissions/shellRuleMatching.ts
 *   src/hooks/toolPermission/PermissionContext.ts
 *   src/hooks/toolPermission/handlers/interactiveHandler.ts
 */

// ============================================================================
// Types — mirrors src/types/permissions.ts
// ============================================================================

/** Global permission mode for the session */
type PermissionMode =
  | 'default'        // Ask for unknown tools, apply rules
  | 'acceptEdits'    // Auto-approve file edits in working directory
  | 'plan'           // Read-only; all writes require approval
  | 'bypassPermissions' // Skip all checks (dangerous)
  | 'dontAsk'        // Convert all 'ask' to 'deny'

/** The outcome of a permission check */
type PermissionBehavior = 'allow' | 'deny' | 'ask'

/** Where a rule originated from (priority: index 0 = highest) */
type PermissionRuleSource =
  | 'policySettings'   // Enterprise managed policy — read-only
  | 'userSettings'     // ~/.claude/settings.json
  | 'projectSettings'  // .claude/settings.json in project root
  | 'localSettings'    // .claude/settings.local.json
  | 'cliArg'           // --allowedTools / --disallowedTools CLI flags
  | 'session'          // Approved during this session (memory only)

/** A parsed rule: which tool, optional content constraint */
interface PermissionRuleValue {
  toolName: string
  ruleContent?: string  // e.g. "npm install" in "Bash(npm install)"
}

/** A full rule record with source and behavior */
interface PermissionRule {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: PermissionRuleValue
}

/** Decision returned from permission check */
interface PermissionDecision {
  behavior: PermissionBehavior
  message?: string
  reason?: string
}

// ============================================================================
// Rule Parser — mirrors src/utils/permissions/permissionRuleParser.ts
// ============================================================================

/**
 * Parse a rule string like "Bash(npm install)" into { toolName, ruleContent }.
 *
 * Supported formats:
 *   "Bash"              → { toolName: 'Bash' }
 *   "Bash(npm install)" → { toolName: 'Bash', ruleContent: 'npm install' }
 *   "Bash(*)"           → { toolName: 'Bash' }  (wildcard = whole-tool rule)
 */
function parseRuleString(ruleString: string): PermissionRuleValue {
  const parenOpen = ruleString.indexOf('(')
  if (parenOpen === -1) {
    return { toolName: ruleString.trim() }
  }

  const parenClose = ruleString.lastIndexOf(')')
  if (parenClose === -1 || parenClose <= parenOpen) {
    return { toolName: ruleString.trim() }
  }

  const toolName = ruleString.slice(0, parenOpen).trim()
  const rawContent = ruleString.slice(parenOpen + 1, parenClose)

  // Empty content or bare wildcard → treat as whole-tool rule
  if (!rawContent || rawContent === '*') {
    return { toolName }
  }

  return { toolName, ruleContent: rawContent }
}

/**
 * Serialise a rule value back to its string representation.
 */
function ruleValueToString(value: PermissionRuleValue): string {
  if (!value.ruleContent) return value.toolName
  return `${value.toolName}(${value.ruleContent})`
}

// ============================================================================
// Wildcard Matching — mirrors src/utils/permissions/shellRuleMatching.ts
// ============================================================================

/**
 * Match a command against a pattern that may contain * wildcards.
 *
 * Rules:
 *   - "*" matches any sequence of characters
 *   - "\*" matches a literal asterisk
 *   - A trailing " *" makes the space-and-args optional (so "git *" matches "git")
 *
 * Examples:
 *   matchWildcard("git *", "git status")  → true
 *   matchWildcard("git *", "git")         → true  (optional trailing args)
 *   matchWildcard("npm run *", "npm run build") → true
 *   matchWildcard("npm run *", "npm install")   → false
 */
function matchWildcard(pattern: string, command: string): boolean {
  // Escape regex special chars except *
  let regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

  // Convert unescaped * to .*
  regexStr = regexStr.replace(/\*/g, '.*')

  // Make trailing " .*" optional (aligns with prefix semantics)
  if (regexStr.endsWith(' .*')) {
    regexStr = regexStr.slice(0, -3) + '( .*)?'
  }

  return new RegExp(`^${regexStr}$`, 's').test(command)
}

/**
 * Check whether a command matches a rule's content.
 * Handles exact match, legacy prefix syntax (npm:*), and wildcard patterns.
 */
function commandMatchesRuleContent(
  command: string,
  ruleContent: string,
): boolean {
  // Legacy prefix syntax: "npm:*" → command starts with "npm"
  const prefixMatch = ruleContent.match(/^(.+):\*$/)
  if (prefixMatch) {
    const prefix = prefixMatch[1]
    return command === prefix || command.startsWith(prefix + ' ')
  }

  // Wildcard pattern
  if (ruleContent.includes('*')) {
    return matchWildcard(ruleContent, command)
  }

  // Exact match
  return command.trim() === ruleContent.trim()
}

// ============================================================================
// Rule Store — simulates multi-source rule loading
// ============================================================================

/** Priority-ordered list of rule sources (index 0 = highest priority) */
const RULE_SOURCE_PRIORITY: PermissionRuleSource[] = [
  'policySettings',
  'userSettings',
  'projectSettings',
  'localSettings',
  'cliArg',
  'session',
]

/**
 * In-memory rule store keyed by source.
 * In Claude Code this is built from settings files, CLI args, and session approvals.
 * See: src/utils/permissions/permissions.ts:124-132 (getAllowRules)
 */
class RuleStore {
  private rules: PermissionRule[] = []

  /** Add a rule from a specific source */
  addRule(
    source: PermissionRuleSource,
    behavior: PermissionBehavior,
    ruleString: string,
  ): void {
    this.rules.push({
      source,
      ruleBehavior: behavior,
      ruleValue: parseRuleString(ruleString),
    })
  }

  /** Get all rules for a given behavior, ordered by source priority */
  getRulesForBehavior(behavior: PermissionBehavior): PermissionRule[] {
    const byPriority = RULE_SOURCE_PRIORITY.flatMap(source =>
      this.rules
        .filter(r => r.source === source && r.ruleBehavior === behavior)
    )
    return byPriority
  }

  /** Find the first rule that matches a tool + optional command */
  findMatchingRule(
    toolName: string,
    command: string | undefined,
    behavior: PermissionBehavior,
  ): PermissionRule | null {
    for (const rule of this.getRulesForBehavior(behavior)) {
      if (rule.ruleValue.toolName !== toolName) continue

      if (rule.ruleValue.ruleContent === undefined) {
        // Whole-tool rule — matches any invocation of this tool
        return rule
      }

      if (command !== undefined) {
        if (commandMatchesRuleContent(command, rule.ruleValue.ruleContent)) {
          return rule
        }
      }
    }
    return null
  }
}

// ============================================================================
// Resolve-Once Guard — mirrors src/hooks/toolPermission/PermissionContext.ts:75-93
// ============================================================================

/**
 * A resolve-once guard that allows exactly one caller to win a concurrent race.
 *
 * The critical design: claim() is an atomic check-and-mark operation.
 * This closes the race window between checking isResolved() and calling resolve().
 *
 * Without claim():
 *   Thread A: isResolved() → false   (gap begins)
 *   Thread B: isResolved() → false   (both think they won)
 *   Thread A: resolve(decisionA)     (double-resolution!)
 *   Thread B: resolve(decisionB)
 *
 * With claim():
 *   Thread A: claim() → true   (atomically marks as claimed)
 *   Thread B: claim() → false  (sees claimed=true, returns false)
 *   Thread A: resolve(decisionA)  (only A resolves)
 */
interface ResolveOnce<T> {
  resolve(value: T): void
  isResolved(): boolean
  /**
   * Atomically check-and-mark. Returns true if this caller won the race,
   * false if another caller already claimed it.
   *
   * Always call claim() BEFORE any await in async callbacks.
   */
  claim(): boolean
}

function createResolveOnce<T>(
  resolve: (value: T) => void,
): ResolveOnce<T> {
  let claimed = false
  let delivered = false

  return {
    resolve(value: T) {
      if (delivered) return
      delivered = true
      claimed = true
      resolve(value)
    },
    isResolved() {
      return claimed
    },
    claim() {
      if (claimed) return false
      claimed = true
      return true
    },
  }
}

// ============================================================================
// Permission Checker — core logic
// ============================================================================

interface CheckOptions {
  toolName: string
  command?: string        // For Bash: the shell command being run
  filePath?: string       // For file tools: the path being accessed
  mode: PermissionMode
}

/**
 * Check whether a tool invocation is permitted.
 *
 * Decision flow (mirrors hasPermissionsToUseTool in permissions.ts:473):
 * 1. bypassPermissions mode → allow immediately
 * 2. Check deny rules → deny if matched
 * 3. Check allow rules → allow if matched
 * 4. Check ask rules → ask if matched
 * 5. Mode-level defaults
 * 6. dontAsk mode → convert ask → deny
 */
function checkPermission(
  store: RuleStore,
  opts: CheckOptions,
): PermissionDecision {
  const { toolName, command, mode } = opts

  // Step 1: bypassPermissions skips all rule checks
  if (mode === 'bypassPermissions') {
    return { behavior: 'allow', reason: 'bypassPermissions mode' }
  }

  // Step 2: Check deny rules (deny always wins over allow)
  const denyRule = store.findMatchingRule(toolName, command, 'deny')
  if (denyRule) {
    return {
      behavior: 'deny',
      message: `Denied by rule '${ruleValueToString(denyRule.ruleValue)}' from ${denyRule.source}`,
      reason: 'deny rule matched',
    }
  }

  // Step 3: Check allow rules
  const allowRule = store.findMatchingRule(toolName, command, 'allow')
  if (allowRule) {
    return {
      behavior: 'allow',
      reason: `Allowed by rule '${ruleValueToString(allowRule.ruleValue)}' from ${allowRule.source}`,
    }
  }

  // Step 4: Check ask rules (force prompt even in permissive modes)
  const askRule = store.findMatchingRule(toolName, command, 'ask')
  if (askRule) {
    return {
      behavior: 'ask',
      message: `Rule '${ruleValueToString(askRule.ruleValue)}' requires approval`,
      reason: 'ask rule matched',
    }
  }

  // Step 5: Mode-level defaults
  let result: PermissionDecision
  switch (mode) {
    case 'default':
      // Ask for any tool without an explicit allow rule
      result = {
        behavior: 'ask',
        message: `No allow rule found for ${toolName}${command ? ` command: ${command}` : ''}`,
      }
      break
    case 'acceptEdits':
      // File edits within working directory are auto-approved
      // (Bash and other tools still require approval)
      if (toolName === 'Edit' || toolName === 'Write') {
        result = { behavior: 'allow', reason: 'acceptEdits mode' }
      } else {
        result = { behavior: 'ask', message: `${toolName} requires approval in acceptEdits mode` }
      }
      break
    case 'plan':
      // Read-only mode: all writes denied
      if (toolName === 'Bash' || toolName === 'Edit' || toolName === 'Write') {
        result = { behavior: 'deny', message: 'plan mode: write operations not permitted' }
      } else {
        result = { behavior: 'allow', reason: 'plan mode: read-only allowed' }
      }
      break
    default:
      result = { behavior: 'ask', message: `Unknown mode: ${mode}` }
  }

  // Step 6: dontAsk converts ask → deny
  if (mode === 'dontAsk' && result.behavior === 'ask') {
    return {
      behavior: 'deny',
      message: result.message,
      reason: 'dontAsk mode converts ask to deny',
    }
  }

  return result
}

// ============================================================================
// Interactive Permission Handler with Concurrent Racers
// ============================================================================

/**
 * Simulate the interactive permission flow from interactiveHandler.ts.
 *
 * In Claude Code, three async sources race to resolve a single permission:
 *   1. User dialog (local terminal)
 *   2. PermissionRequest hooks (scripts from settings.json)
 *   3. Bash classifier (AI safety classifier)
 *
 * All three race via resolve-once. The first to call claim() wins.
 */
async function handleAskPermission(
  toolName: string,
  command: string | undefined,
  promptMessage: string,
  options: {
    hookDelayMs?: number     // Simulate hook response time
    classifierDelayMs?: number  // Simulate classifier response time
    userDelayMs?: number     // Simulate user response time
    hookDecision?: PermissionBehavior
    classifierDecision?: PermissionBehavior
    userDecision?: PermissionBehavior
  } = {},
): Promise<PermissionDecision> {
  return new Promise<PermissionDecision>(outerResolve => {
    const guard = createResolveOnce<PermissionDecision>(outerResolve)

    console.log(`  [dialog] Showing permission dialog: ${promptMessage}`)

    // Racer 1: User interaction (simulated with a timeout)
    const userDelay = options.userDelayMs ?? 500
    setTimeout(() => {
      // Atomic check-and-mark: if another racer already won, skip
      if (!guard.claim()) {
        console.log(`  [user] Another racer already resolved — skipping user decision`)
        return
      }
      const decision = options.userDecision ?? 'allow'
      console.log(`  [user] User chose: ${decision} (after ${userDelay}ms)`)
      guard.resolve({ behavior: decision, reason: 'user interaction' })
    }, userDelay)

    // Racer 2: PermissionRequest hook (async, background)
    if (options.hookDelayMs !== undefined) {
      const hookDelay = options.hookDelayMs
      setTimeout(() => {
        if (!guard.claim()) {
          console.log(`  [hook] Another racer already resolved — skipping hook decision`)
          return
        }
        const decision = options.hookDecision ?? 'allow'
        console.log(`  [hook] Hook responded: ${decision} (after ${hookDelay}ms)`)
        guard.resolve({ behavior: decision, reason: 'PermissionRequest hook' })
      }, hookDelay)
    }

    // Racer 3: Bash classifier (async, background)
    if (options.classifierDelayMs !== undefined) {
      const classifierDelay = options.classifierDelayMs
      setTimeout(() => {
        if (!guard.claim()) {
          console.log(`  [classifier] Another racer already resolved — skipping classifier decision`)
          return
        }
        const decision = options.classifierDecision ?? 'allow'
        console.log(`  [classifier] Classifier responded: ${decision} (after ${classifierDelay}ms)`)
        guard.resolve({ behavior: decision, reason: 'bash classifier' })
      }, classifierDelay)
    }
  })
}

// ============================================================================
// Demo
// ============================================================================

async function runDemo(): Promise<void> {
  console.log('='.repeat(60))
  console.log('Claude Code Permission System — Demonstration')
  console.log('='.repeat(60))

  // Set up rule store with rules from multiple sources
  const store = new RuleStore()

  // Policy (highest priority): deny access to secrets
  store.addRule('policySettings', 'deny', 'Bash(cat ~/.aws/*)')
  store.addRule('policySettings', 'deny', 'Bash(cat ~/.ssh/*)')

  // User settings: allow common git and npm commands
  store.addRule('userSettings', 'allow', 'Bash(git *)')
  store.addRule('userSettings', 'allow', 'Bash(npm run *)')

  // Project settings: allow specific test commands
  store.addRule('projectSettings', 'allow', 'Bash(npm test)')
  store.addRule('projectSettings', 'ask', 'Bash(npm publish)')

  // Session: user approved something interactively
  store.addRule('session', 'allow', 'Bash(ls -la)')

  console.log('\n--- Rule Matching Examples ---\n')

  const testCases: Array<{ mode: PermissionMode; tool: string; command?: string; description: string }> = [
    // Allow rules
    { mode: 'default', tool: 'Bash', command: 'git status', description: 'git (user allow rule)' },
    { mode: 'default', tool: 'Bash', command: 'npm run build', description: 'npm run (user allow rule)' },
    { mode: 'default', tool: 'Bash', command: 'npm test', description: 'npm test (project allow rule)' },
    { mode: 'default', tool: 'Bash', command: 'ls -la', description: 'ls -la (session allow rule)' },

    // Deny rules (policy overrides everything)
    { mode: 'default', tool: 'Bash', command: 'cat ~/.aws/credentials', description: 'cat AWS creds (policy deny)' },
    { mode: 'acceptEdits', tool: 'Bash', command: 'cat ~/.ssh/id_rsa', description: 'cat SSH key (policy deny, acceptEdits mode)' },

    // Ask rules
    { mode: 'default', tool: 'Bash', command: 'npm publish', description: 'npm publish (project ask rule)' },

    // Mode-level behavior
    { mode: 'acceptEdits', tool: 'Edit', command: undefined, description: 'file edit in acceptEdits mode' },
    { mode: 'plan', tool: 'Bash', command: 'make build', description: 'build command in plan mode' },
    { mode: 'bypassPermissions', tool: 'Bash', command: 'rm -rf /tmp/test', description: 'rm in bypassPermissions mode' },
    { mode: 'dontAsk', tool: 'Bash', command: 'unknown-command', description: 'unknown command in dontAsk mode' },
  ]

  for (const tc of testCases) {
    const decision = checkPermission(store, {
      toolName: tc.tool,
      command: tc.command,
      mode: tc.mode,
    })

    const icon = decision.behavior === 'allow' ? '✓' : decision.behavior === 'deny' ? '✗' : '?'
    const display = tc.command
      ? `${tc.tool}(${tc.command})`
      : tc.tool
    console.log(`[${tc.mode}] ${icon} ${display}`)
    console.log(`  → ${decision.behavior}: ${decision.reason ?? decision.message ?? ''}`)
  }

  // -------------------------------------------------------------------------
  // Demonstrate resolve-once concurrent guard
  // -------------------------------------------------------------------------
  console.log('\n--- Concurrent Racer Demo ---\n')

  console.log('Scenario A: Hook wins before user (hook responds in 50ms, user in 300ms)')
  const resultA = await handleAskPermission(
    'Bash',
    'npm publish',
    'npm publish requires approval',
    {
      hookDelayMs: 50,
      hookDecision: 'allow',
      classifierDelayMs: 100,
      classifierDecision: 'allow',
      userDelayMs: 300,
      userDecision: 'allow',
    },
  )
  console.log(`  Final decision: ${resultA.behavior} (${resultA.reason})\n`)

  console.log('Scenario B: Classifier wins before hook and user (classifier: 30ms, hook: 80ms, user: 200ms)')
  const resultB = await handleAskPermission(
    'Bash',
    'git push',
    'git push requires approval',
    {
      classifierDelayMs: 30,
      classifierDecision: 'allow',
      hookDelayMs: 80,
      hookDecision: 'allow',
      userDelayMs: 200,
      userDecision: 'deny',
    },
  )
  console.log(`  Final decision: ${resultB.behavior} (${resultB.reason})\n`)

  console.log('Scenario C: User denies before background checks complete')
  const resultC = await handleAskPermission(
    'Bash',
    'sudo rm -rf /var/log',
    'sudo rm requires approval',
    {
      hookDelayMs: 500,
      hookDecision: 'allow',
      classifierDelayMs: 700,
      classifierDecision: 'allow',
      userDelayMs: 100,
      userDecision: 'deny',
    },
  )
  console.log(`  Final decision: ${resultC.behavior} (${resultC.reason})\n`)

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('='.repeat(60))
  console.log('Key Patterns Demonstrated:')
  console.log('1. Rule priority: policySettings > userSettings > projectSettings > session')
  console.log('2. Deny always wins over allow (checked first)')
  console.log('3. Wildcard matching: "git *" matches "git status", "git push", bare "git"')
  console.log('4. Mode overrides: bypassPermissions skips rules; dontAsk converts ask→deny')
  console.log('5. Resolve-once: only the FIRST racer (hook/classifier/user) wins')
  console.log('='.repeat(60))
}

runDemo().catch(console.error)
