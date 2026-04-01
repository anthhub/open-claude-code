/**
 * Chapter 9: Multi-Agent Coordination
 *
 * This example demonstrates a simplified multi-agent coordination system
 * inspired by Claude Code's own architecture. It shows:
 *
 * 1. Agent definition with frontmatter-style configuration
 * 2. Task state management with typed state machines
 * 3. Mailbox communication between agents
 * 4. Coordinator dispatch pattern (Research → Synthesis → Implementation → Verification)
 *
 * Source references:
 *   src/tools/AgentTool/loadAgentsDir.ts   - Agent definition schema
 *   src/coordinator/coordinatorMode.ts      - Coordinator prompt and workflow
 *   src/tasks/types.ts                      - TaskState union type
 *   src/utils/swarm/inProcessRunner.ts      - In-process runner
 *   src/tools/SendMessageTool/SendMessageTool.ts - Mailbox messaging
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'

// ============================================================================
// Section 1: Agent Definition Format
// (mirrors src/tools/AgentTool/loadAgentsDir.ts:73-99)
// ============================================================================

type PermissionMode = 'default' | 'plan' | 'auto' | 'acceptEdits' | 'bypassPermissions' | 'bubble'
type ModelAlias = 'sonnet' | 'opus' | 'haiku' | 'inherit'
type IsolationMode = 'worktree' | 'remote' | 'in-process'

/**
 * Agent definition — the runtime representation of a Markdown frontmatter config.
 * In Claude Code's real implementation, these are loaded from ~/.claude/agents/
 * or project-level .claude/agents/ directories.
 *
 * Example Markdown frontmatter that would produce this:
 *
 *   ---
 *   description: Research agent that reads codebases
 *   tools:
 *     - Read
 *     - Grep
 *     - Glob
 *   model: sonnet
 *   permissionMode: default
 *   maxTurns: 50
 *   ---
 *   You are a research specialist. Find code, understand patterns, report findings.
 */
interface AgentDefinition {
  agentType: string            // Unique identifier (e.g., 'researcher', 'implementer')
  description: string          // Human-readable description shown in tool listing
  systemPrompt: string         // The agent's instructions (the Markdown body)
  tools: string[]              // Allowed tools. '*' = all tools.
  model: ModelAlias            // Model to use. 'inherit' = use parent's model.
  permissionMode: PermissionMode
  maxTurns: number             // Safety limit on agentic turns
  background?: boolean         // If true, always runs as background task
  isolation?: IsolationMode    // Execution environment
}

// ============================================================================
// Section 2: Task State Machine
// (mirrors src/tasks/types.ts and src/tasks/LocalAgentTask/LocalAgentTask.tsx)
// ============================================================================

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

/**
 * Represents a running or completed agent task.
 * In Claude Code's real implementation, this is LocalAgentTaskState which
 * is stored in AppState and tracked via React state updates.
 */
interface AgentTask {
  id: string                   // Unique task ID (e.g., 'agent-a1b2c3')
  agentType: string            // Which agent definition is being used
  status: TaskStatus
  prompt: string               // The task given to the agent
  result?: string              // Output when completed
  error?: string               // Error message when failed
  startedAt?: Date
  completedAt?: Date
  progress: TaskProgress
}

interface TaskProgress {
  turnCount: number            // Current agentic turn number
  tokenCount: number           // Tokens used so far
  lastActivity: string         // Human-readable status update
}

/**
 * Checks if a task is actively running (mirrors tasks/types.ts:37-46).
 * Used to determine if it should appear in the background tasks indicator.
 */
function isBackgroundTask(task: AgentTask): boolean {
  return task.status === 'running' || task.status === 'pending'
}

// ============================================================================
// Section 3: Mailbox Communication System
// (mirrors src/utils/teammateMailbox.ts and SendMessageTool)
// ============================================================================

interface MailboxMessage {
  id: string
  from: string                 // Sender agent name
  to: string                   // Recipient agent name ('*' for broadcast)
  content: string
  summary: string              // 5-10 word preview shown in UI
  timestamp: Date
  read: boolean
}

/**
 * Simple in-memory mailbox system.
 *
 * Claude Code's real implementation uses the filesystem (JSON files in the
 * team directory) so messages survive process restarts. The async API mirrors
 * writeToMailbox() / readMailbox() in src/utils/teammateMailbox.ts.
 */
class MailboxSystem extends EventEmitter {
  private mailboxes = new Map<string, MailboxMessage[]>()

  /**
   * Send a message to a specific agent or broadcast to all ('*').
   * Mirrors SendMessageTool's handleMessage() and handleBroadcast().
   */
  async send(
    from: string,
    to: string,
    content: string,
    summary: string,
  ): Promise<void> {
    const message: MailboxMessage = {
      id: randomUUID(),
      from,
      to,
      content,
      summary,
      timestamp: new Date(),
      read: false,
    }

    if (to === '*') {
      // Broadcast: write to all mailboxes except sender
      for (const [name] of this.mailboxes) {
        if (name !== from) {
          const inbox = this.mailboxes.get(name) ?? []
          inbox.push({ ...message, to: name })
          this.mailboxes.set(name, inbox)
        }
      }
      console.log(`[Mailbox] Broadcast from ${from}: "${summary}"`)
    } else {
      // Direct message
      const inbox = this.mailboxes.get(to) ?? []
      inbox.push(message)
      this.mailboxes.set(to, inbox)
      console.log(`[Mailbox] ${from} → ${to}: "${summary}"`)
    }

    this.emit('message', message)
  }

  /**
   * Read all unread messages for an agent.
   * Mirrors readMailbox() in src/utils/teammateMailbox.ts.
   */
  async read(agentName: string): Promise<MailboxMessage[]> {
    // Ensure mailbox exists
    if (!this.mailboxes.has(agentName)) {
      this.mailboxes.set(agentName, [])
    }

    const messages = this.mailboxes.get(agentName) ?? []
    const unread = messages.filter(m => !m.read)

    // Mark as read
    for (const msg of unread) {
      msg.read = true
    }

    return unread
  }

  /**
   * Register an agent's mailbox (called when agent starts).
   */
  register(agentName: string): void {
    if (!this.mailboxes.has(agentName)) {
      this.mailboxes.set(agentName, [])
    }
  }
}

// ============================================================================
// Section 4: Agent Registry
// (mirrors how builtInAgents.ts and loadAgentsDir.ts register agents)
// ============================================================================

/**
 * Central registry of all available agent definitions.
 * In Claude Code, agents are loaded from:
 *   - Built-in agents (src/tools/AgentTool/built-in/)
 *   - User agents (~/.claude/agents/*.md)
 *   - Project agents (.claude/agents/*.md)
 *   - Plugin agents (from plugin packages)
 */
class AgentRegistry {
  private agents = new Map<string, AgentDefinition>()

  register(definition: AgentDefinition): void {
    this.agents.set(definition.agentType, definition)
    console.log(`[Registry] Registered agent: ${definition.agentType}`)
  }

  get(agentType: string): AgentDefinition | undefined {
    return this.agents.get(agentType)
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values())
  }
}

// ============================================================================
// Section 5: Agent Executor
// (mirrors the core behavior of runAgent() in src/tools/AgentTool/runAgent.ts)
// ============================================================================

/**
 * Simulates agent execution. In real Claude Code, this calls query() which
 * runs the LLM in a loop, processing tool uses and streaming results.
 *
 * The real runAgent() is an async generator that yields stream events,
 * tracks progress via updateAsyncAgentProgress(), and records transcripts
 * via recordSidechainTranscript().
 */
async function executeAgent(
  definition: AgentDefinition,
  prompt: string,
  taskId: string,
  onProgress: (progress: TaskProgress) => void,
): Promise<string> {
  console.log(`\n[Agent:${definition.agentType}] Starting task: "${prompt.substring(0, 60)}..."`)
  console.log(`[Agent:${definition.agentType}] Tools: ${definition.tools.join(', ')}`)
  console.log(`[Agent:${definition.agentType}] Model: ${definition.model}, Mode: ${definition.permissionMode}`)

  // Simulate multi-turn execution with progress tracking
  const maxTurns = Math.min(definition.maxTurns, 5)
  let tokenCount = 0

  for (let turn = 1; turn <= maxTurns; turn++) {
    await sleep(300) // Simulate LLM call latency

    tokenCount += Math.floor(Math.random() * 500) + 200
    onProgress({
      turnCount: turn,
      tokenCount,
      lastActivity: getActivityDescription(definition.agentType, turn),
    })

    // Simulate early completion for some agents
    if (turn >= 2 && Math.random() > 0.6) break
  }

  // Generate a simulated result based on agent type
  const result = generateResult(definition.agentType, prompt)
  console.log(`[Agent:${definition.agentType}] Completed. Tokens: ${tokenCount}`)
  return result
}

function getActivityDescription(agentType: string, turn: number): string {
  const activities: Record<string, string[]> = {
    researcher: [
      'Reading source files...',
      'Searching for patterns with Grep...',
      'Analyzing dependencies...',
      'Summarizing findings...',
    ],
    implementer: [
      'Reading existing code...',
      'Planning changes...',
      'Writing implementation...',
      'Running tests...',
    ],
    verifier: [
      'Running test suite...',
      'Checking type errors...',
      'Verifying edge cases...',
      'Generating report...',
    ],
  }
  const steps = activities[agentType] ?? ['Working...']
  return steps[Math.min(turn - 1, steps.length - 1)]!
}

function generateResult(agentType: string, prompt: string): string {
  switch (agentType) {
    case 'researcher':
      return `Research findings for "${prompt.substring(0, 40)}...":
- Found auth module in src/auth/validate.ts (lines 38-65)
- Session.user field is typed as User | undefined (src/auth/types.ts:15)
- Null pointer occurs when session.expired === true but token is still cached
- 3 test files found: validate.test.ts, session.test.ts, auth.integration.test.ts
- Existing tests do NOT cover the expired-token scenario (gap identified)`

    case 'implementer':
      return `Implementation complete:
- Added null check at src/auth/validate.ts:42: \`if (!session.user) return { status: 401, error: 'Session expired' }\`
- Updated Session type to make .user non-nullable after the check (type narrowing)
- Committed: abc1234 "fix: handle expired session in token validation"
- Tests pass: 47/47`

    case 'verifier':
      return `Verification report:
- All 47 existing tests pass
- Added 2 new test cases for expired session scenario
- Typecheck: 0 errors
- Edge cases verified: concurrent expiry, race condition with refresh token
- Recommendation: LGTM — the fix correctly handles the null pointer`

    default:
      return `Task completed for: ${prompt}`
  }
}

// ============================================================================
// Section 6: Task Manager
// (mirrors the task registration and lifecycle in LocalAgentTask.tsx)
// ============================================================================

/**
 * Manages all running and completed tasks.
 * In Claude Code, this state lives in AppState and is updated via setAppState().
 * The UI reads from AppState to show the background tasks indicator.
 */
class TaskManager extends EventEmitter {
  private tasks = new Map<string, AgentTask>()

  /**
   * Register a new task (mirrors registerAsyncAgent() in LocalAgentTask.tsx).
   */
  create(agentType: string, prompt: string): AgentTask {
    const task: AgentTask = {
      id: `agent-${randomUUID().substring(0, 6)}`,
      agentType,
      status: 'pending',
      prompt,
      progress: { turnCount: 0, tokenCount: 0, lastActivity: 'Initializing...' },
    }
    this.tasks.set(task.id, task)
    this.emit('taskCreated', task)
    return task
  }

  /**
   * Transition task to running (mirrors the start of runAsyncAgentLifecycle).
   */
  start(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    task.status = 'running'
    task.startedAt = new Date()
    this.emit('taskUpdated', task)
  }

  /**
   * Update progress (mirrors updateAsyncAgentProgress()).
   */
  updateProgress(taskId: string, progress: TaskProgress): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.progress = progress
    this.emit('taskProgress', task)
  }

  /**
   * Complete a task (mirrors completeAsyncAgent()).
   * In Claude Code, this enqueues a <task-notification> XML message.
   */
  complete(taskId: string, result: string): void {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    task.status = 'completed'
    task.result = result
    task.completedAt = new Date()
    this.emit('taskCompleted', task)
  }

  /**
   * Fail a task (mirrors failAsyncAgent()).
   */
  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    task.status = 'failed'
    task.error = error
    task.completedAt = new Date()
    this.emit('taskFailed', task)
  }

  get(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId)
  }

  getRunning(): AgentTask[] {
    return Array.from(this.tasks.values()).filter(isBackgroundTask)
  }
}

// ============================================================================
// Section 7: Coordinator
// (mirrors the Coordinator pattern from src/coordinator/coordinatorMode.ts)
// ============================================================================

/**
 * The Coordinator orchestrates multi-agent workflows.
 *
 * This implements the four-phase workflow described in coordinatorMode.ts:
 * 1. Research  — parallel workers investigate the codebase
 * 2. Synthesis — coordinator reads findings and crafts implementation spec
 * 3. Implementation — workers make targeted changes
 * 4. Verification — workers prove the code works
 *
 * Key principle from coordinatorMode.ts:252-268:
 *   "Workers can't see your conversation. Every prompt must be self-contained."
 *   The coordinator synthesizes research BEFORE writing worker prompts.
 */
class Coordinator {
  constructor(
    private registry: AgentRegistry,
    private taskManager: TaskManager,
    private mailbox: MailboxSystem,
  ) {}

  /**
   * Spawn and run an agent, managing the full task lifecycle.
   *
   * Mirrors AgentTool.call() → runAsyncAgentLifecycle() → runAgent()
   * with the simplified task notification pattern from LocalAgentTask.tsx.
   */
  async runAgent(agentType: string, prompt: string): Promise<string> {
    const definition = this.registry.get(agentType)
    if (!definition) {
      throw new Error(`Agent type "${agentType}" not found in registry`)
    }

    // Create task (registerAsyncAgent equivalent)
    const task = this.taskManager.create(agentType, prompt)
    this.taskManager.start(task.id)

    try {
      // Execute agent with progress tracking
      const result = await executeAgent(
        definition,
        prompt,
        task.id,
        (progress) => {
          this.taskManager.updateProgress(task.id, progress)
          console.log(`  [${agentType}] Turn ${progress.turnCount}: ${progress.lastActivity}`)
        },
      )

      // Complete task and emit notification (completeAsyncAgent equivalent)
      this.taskManager.complete(task.id, result)
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.taskManager.fail(task.id, msg)
      throw error
    }
  }

  /**
   * Execute the full four-phase coordination workflow.
   *
   * This mirrors how the coordinator system prompt (coordinatorMode.ts:200-215)
   * structures work: parallel research → synthesis → implementation → verification.
   *
   * Key: The coordinator synthesizes BEFORE delegating (coordinatorMode.ts:252-268).
   * It never writes "Based on your findings, fix the bug" — it reads the findings
   * and writes specific file paths, line numbers, and exact changes needed.
   */
  async dispatch(userRequest: string): Promise<void> {
    console.log('\n' + '='.repeat(70))
    console.log('COORDINATOR: Starting multi-agent workflow')
    console.log(`Request: "${userRequest}"`)
    console.log('='.repeat(70))

    // ── Phase 1: Research (parallel) ──────────────────────────────────────────
    // coordinatorMode.ts: "Parallelism is your superpower. Launch independent
    // workers concurrently whenever possible."
    console.log('\n[Phase 1] RESEARCH — Launching parallel workers...')

    const [codeFindings, testFindings] = await Promise.all([
      this.runAgent(
        'researcher',
        [
          `Research the auth module in relation to: "${userRequest}"`,
          'Find specific file paths, line numbers, and types involved.',
          'This research will inform a bug fix — focus on null/undefined scenarios.',
          'Report findings only. Do NOT modify files.',
        ].join('\n'),
      ),
      this.runAgent(
        'researcher',
        [
          `Find all test files related to the auth module for: "${userRequest}"`,
          'Report test file paths, what scenarios are covered, and any gaps.',
          'This research will inform where to add regression tests.',
          'Report findings only. Do NOT modify files.',
        ].join('\n'),
      ),
    ])

    // ── Phase 2: Synthesis ────────────────────────────────────────────────────
    // coordinatorMode.ts: "When workers report research findings, you must
    // understand them before directing follow-up work."
    // "Never write 'based on your findings' or 'based on the research.'"
    console.log('\n[Phase 2] SYNTHESIS — Coordinator reads findings and crafts spec...')

    // The coordinator reads and understands the research
    console.log('\n  Research findings received:')
    console.log('  --- Code findings ---')
    console.log(codeFindings.split('\n').map(l => '  ' + l).join('\n'))
    console.log('\n  --- Test findings ---')
    console.log(testFindings.split('\n').map(l => '  ' + l).join('\n'))

    // Craft a specific, synthesized implementation spec
    // (NOT "based on findings" — the coordinator proves it understood)
    const implementationSpec = [
      `Fix the null pointer in src/auth/validate.ts:42.`,
      ``,
      `Root cause: The user field on Session (src/auth/types.ts:15) is undefined`,
      `when sessions expire but the token remains cached in Redis. The validate()`,
      `function accesses session.user.id without checking for null first.`,
      ``,
      `Change: Add a null check before user.id access.`,
      `If session.user is null/undefined, return { status: 401, error: 'Session expired' }.`,
      ``,
      `Test: Add 2 test cases to validate.test.ts:`,
      `  1. expired session returns 401 with 'Session expired' message`,
      `  2. concurrent expiry race condition (session.user becomes null mid-request)`,
      ``,
      `Commit and report the commit hash.`,
    ].join('\n')

    console.log('\n  Synthesized spec created:')
    console.log(implementationSpec.split('\n').map(l => '  ' + l).join('\n'))

    // ── Phase 3: Implementation ───────────────────────────────────────────────
    console.log('\n[Phase 3] IMPLEMENTATION — Dispatching implementer worker...')

    const implementationResult = await this.runAgent('implementer', implementationSpec)

    console.log('\n  Implementation result:')
    console.log(implementationResult.split('\n').map(l => '  ' + l).join('\n'))

    // ── Phase 4: Verification ─────────────────────────────────────────────────
    // coordinatorMode.ts: "Verification means proving the code works, not
    // confirming it exists. A verifier that rubber-stamps weak work undermines everything."
    // "Spawn fresh" — verifier sees the code with fresh eyes (coordinatorMode.ts:287)
    console.log('\n[Phase 4] VERIFICATION — Spawning fresh verifier (independent review)...')

    const verificationSpec = [
      `Verify the fix for the null pointer in src/auth/validate.ts.`,
      ``,
      `A null check was added at line 42 that returns 401 with 'Session expired'`,
      `when session.user is null/undefined.`,
      ``,
      `Prove the code works:`,
      `- Run ALL tests: npm test (or equivalent) — report full output`,
      `- Run typecheck: tsc --noEmit — investigate any errors (don't dismiss)`,
      `- Verify the happy path still works (valid session → normal auth flow)`,
      `- Verify the expired session path: returns 401 with correct message`,
      `- Check for edge cases: concurrent requests, null vs undefined, race conditions`,
      ``,
      `Be skeptical. If something looks off, dig in.`,
      `Report: PASS or FAIL with specific evidence.`,
    ].join('\n')

    const verificationResult = await this.runAgent('verifier', verificationSpec)

    console.log('\n  Verification result:')
    console.log(verificationResult.split('\n').map(l => '  ' + l).join('\n'))

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(70))
    console.log('COORDINATOR: Workflow complete')
    console.log('='.repeat(70))

    const allTasks = this.taskManager.getRunning()
    console.log(`Active background tasks: ${allTasks.length}`)

    // Send summary to user via mailbox
    await this.mailbox.send(
      'coordinator',
      'user',
      [
        `Completed: ${userRequest}`,
        ``,
        `- Researched: auth module and test coverage (2 parallel workers)`,
        `- Fixed: null pointer in src/auth/validate.ts:42`,
        `- Committed: abc1234`,
        `- Verified: all 47 tests pass + 2 new regression tests`,
      ].join('\n'),
      'Fix complete: all tests pass',
    )
  }
}

// ============================================================================
// Section 8: Demonstration
// ============================================================================

async function main(): Promise<void> {
  console.log('Claude Code Multi-Agent Coordination — Chapter 9 Example')
  console.log('='.repeat(70))

  // Initialize subsystems
  const registry = new AgentRegistry()
  const taskManager = new TaskManager()
  const mailbox = new MailboxSystem()

  // Register the coordinator's mailbox
  mailbox.register('coordinator')
  mailbox.register('user')

  // Register agent definitions
  // (In real Claude Code, these are loaded from Markdown files in .claude/agents/)
  registry.register({
    agentType: 'researcher',
    description: 'Investigates code, finds files, reads patterns. Reports only.',
    systemPrompt: `You are a research specialist. Your job is to investigate code and report findings.

    You NEVER modify files. You read, grep, and understand, then report with:
    - Exact file paths and line numbers
    - Type signatures and data flow
    - Test coverage gaps

    This information will inform the coordinator's synthesis.`,
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    model: 'sonnet',
    permissionMode: 'default',
    maxTurns: 50,
  })

  registry.register({
    agentType: 'implementer',
    description: 'Makes targeted code changes per specification. Self-verifies with tests.',
    systemPrompt: `You are an implementation specialist. You receive precise specs and execute them.

    Workflow:
    1. Read the relevant files to understand context
    2. Make the exact change specified (no scope creep)
    3. Run relevant tests and typecheck — fix any failures
    4. Commit with a clear message and report the hash

    Never exceed the specified scope. Fix the root cause, not the symptom.`,
    tools: ['Read', 'Edit', 'Bash', 'Grep'],
    model: 'sonnet',
    permissionMode: 'acceptEdits',
    maxTurns: 30,
  })

  registry.register({
    agentType: 'verifier',
    description: 'Proves code works via tests, typechecks, and edge case analysis.',
    systemPrompt: `You are a verification specialist. You prove code works — you do NOT rubber-stamp.

    Verification means:
    - Running the FULL test suite (not just changed files)
    - Running typechecks and investigating errors (don't dismiss as "unrelated")
    - Testing edge cases and error paths
    - Being skeptical — if something looks off, dig in

    Report: PASS or FAIL with specific evidence. Never report PASS without running tests.`,
    tools: ['Read', 'Bash', 'Grep'],
    model: 'opus',    // Higher capability for critical verification
    permissionMode: 'default',
    maxTurns: 40,
  })

  // Show registered agents
  console.log('\nRegistered agents:')
  for (const agent of registry.list()) {
    console.log(`  - ${agent.agentType} (model: ${agent.model}, tools: ${agent.tools.join(', ')})`)
  }

  // Set up task monitoring (equivalent to the background tasks indicator in the TUI)
  taskManager.on('taskCreated', (task: AgentTask) => {
    console.log(`\n[TaskManager] New task: ${task.id} (${task.agentType})`)
  })

  taskManager.on('taskCompleted', (task: AgentTask) => {
    const duration = task.completedAt && task.startedAt
      ? Math.round((task.completedAt.getTime() - task.startedAt.getTime()) / 100) / 10
      : '?'
    console.log(`[TaskManager] Completed: ${task.id} (${task.agentType}) in ${duration}s`)
  })

  taskManager.on('taskFailed', (task: AgentTask) => {
    console.log(`[TaskManager] FAILED: ${task.id} (${task.agentType}): ${task.error}`)
  })

  // Run the coordinator
  const coordinator = new Coordinator(registry, taskManager, mailbox)

  await coordinator.dispatch(
    'There is a null pointer exception in the auth module when sessions expire',
  )

  // Show final task summary
  console.log('\n' + '-'.repeat(70))
  console.log('Final Task Summary:')
  const allTasks = Array.from({ length: 3 }, (_, i) => i)  // We ran 3 agents
  const completedCount = 3  // All completed in this example
  console.log(`  Completed: ${completedCount} / ${completedCount + taskManager.getRunning().length}`)

  // Check coordinator's outbox
  const userMessages = await mailbox.read('user')
  if (userMessages.length > 0) {
    console.log('\n' + '-'.repeat(70))
    console.log('Coordinator message to user:')
    for (const msg of userMessages) {
      console.log(`  From: ${msg.from} | Summary: "${msg.summary}"`)
      console.log(msg.content.split('\n').map(l => '  ' + l).join('\n'))
    }
  }

  // ── Bonus: Demonstrate Mailbox Broadcast ──────────────────────────────────
  console.log('\n' + '-'.repeat(70))
  console.log('Bonus: Demonstrating Mailbox Broadcast')
  console.log('(mirrors SendMessage({ to: "*", ... }) in SendMessageTool.ts)')

  mailbox.register('researcher')
  mailbox.register('implementer')
  mailbox.register('verifier')

  await mailbox.send(
    'coordinator',
    '*',
    'New priority task: security audit required before the deploy. Please stand by.',
    'Security audit requested — stand by',
  )

  // Read broadcast messages
  for (const agentName of ['researcher', 'implementer', 'verifier']) {
    const messages = await mailbox.read(agentName)
    if (messages.length > 0) {
      console.log(`  ${agentName} received: "${messages[0]!.summary}"`)
    }
  }

  console.log('\nDone. See docs/en/09-agent-coordination.md for full architectural details.')
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Run the example
main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
