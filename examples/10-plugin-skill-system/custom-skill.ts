/**
 * Chapter 10: Plugin & Skill System — Custom Skill Example
 *
 * This file demonstrates a simplified implementation of the Skill system,
 * showing how skills are defined, loaded, registered, and executed.
 *
 * Based on:
 * - src/skills/bundledSkills.ts  — BundledSkillDefinition & registration
 * - src/skills/loadSkillsDir.ts  — Filesystem skill loading
 * - src/tools/SkillTool/SkillTool.ts — Skill execution (inline/fork)
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml' // npm install js-yaml @types/js-yaml

// ---------------------------------------------------------------------------
// 1. TYPE DEFINITIONS
// ---------------------------------------------------------------------------

/**
 * Content block returned by a skill's getPromptForCommand.
 * Mirrors @anthropic-ai/sdk ContentBlockParam.
 */
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/**
 * Execution context passed into every skill invocation.
 * In the real implementation this carries AppState, permissions, etc.
 */
interface SkillUseContext {
  cwd: string
  sessionId: string
}

/**
 * The programmatic definition for a bundled skill.
 * Mirrors src/skills/bundledSkills.ts:BundledSkillDefinition (lines 15-41).
 */
interface BundledSkillDefinition {
  name: string
  description: string
  aliases?: string[]
  /**
   * Hint for Claude: when should it proactively invoke this skill?
   * Included verbatim in the SkillTool system prompt.
   */
  whenToUse?: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  /**
   * 'inline': prompt injected into the current conversation turn.
   * 'fork':   an isolated sub-agent is spawned; only its result returns.
   */
  context?: 'inline' | 'fork'
  agent?: string
  /**
   * Reference files extracted to disk on first invocation.
   * Allows model to Read/Grep structured data without embedding it in prompt.
   */
  files?: Record<string, string>
  getPromptForCommand: (
    args: string,
    context: SkillUseContext,
  ) => Promise<ContentBlock[]>
}

/**
 * The normalized Command object stored in the registry.
 * Both bundled and filesystem skills become Commands.
 * Mirrors src/types/command.ts PromptCommand.
 */
interface SkillCommand {
  type: 'prompt'
  name: string
  description: string
  aliases?: string[]
  whenToUse?: string
  argumentHint?: string
  allowedTools: string[]
  model?: string
  disableModelInvocation: boolean
  userInvocable: boolean
  isHidden: boolean
  context?: 'inline' | 'fork'
  agent?: string
  source: 'bundled' | 'userSettings' | 'projectSettings' | 'policySettings'
  loadedFrom: 'bundled' | 'skills' | 'mcp' | 'plugin' | 'managed'
  /** Base directory for this skill (used for ${CLAUDE_SKILL_DIR} substitution) */
  skillRoot?: string
  getPromptForCommand: (
    args: string,
    context: SkillUseContext,
  ) => Promise<ContentBlock[]>
}

// ---------------------------------------------------------------------------
// 2. SKILL REGISTRY
// ---------------------------------------------------------------------------

/**
 * In-memory registry for this example.
 * The real implementation uses a module-level array in bundledSkills.ts.
 */
const skillRegistry: SkillCommand[] = []

/**
 * Register a bundled skill.
 * Mirrors src/skills/bundledSkills.ts:registerBundledSkill (line 53).
 */
function registerBundledSkill(definition: BundledSkillDefinition): void {
  const command: SkillCommand = {
    type: 'prompt',
    name: definition.name,
    description: definition.description,
    aliases: definition.aliases,
    whenToUse: definition.whenToUse,
    argumentHint: definition.argumentHint,
    allowedTools: definition.allowedTools ?? [],
    model: definition.model,
    disableModelInvocation: definition.disableModelInvocation ?? false,
    userInvocable: definition.userInvocable ?? true,
    isHidden: !(definition.userInvocable ?? true),
    context: definition.context,
    agent: definition.agent,
    source: 'bundled',
    loadedFrom: 'bundled',
    getPromptForCommand: definition.getPromptForCommand,
  }
  skillRegistry.push(command)
  console.log(`[registry] Registered bundled skill: ${command.name}`)
}

/**
 * Find a skill by name (or alias), stripping any leading '/'.
 * Mirrors src/commands.ts:findCommand.
 */
function findSkill(nameOrAlias: string): SkillCommand | undefined {
  const normalized = nameOrAlias.startsWith('/')
    ? nameOrAlias.slice(1)
    : nameOrAlias
  return skillRegistry.find(
    cmd =>
      cmd.name === normalized ||
      (cmd.aliases && cmd.aliases.includes(normalized)),
  )
}

// ---------------------------------------------------------------------------
// 3. FILESYSTEM SKILL LOADING
// ---------------------------------------------------------------------------

/**
 * YAML frontmatter shape for .claude/skills/<name>/SKILL.md.
 * Mirrors the fields parsed in src/skills/loadSkillsDir.ts:parseSkillFrontmatterFields
 * (lines 185-264).
 */
interface SkillFrontmatter {
  description?: string
  'argument-hint'?: string
  'allowed-tools'?: string | string[]
  model?: string
  context?: 'fork'
  when_to_use?: string
  'user-invocable'?: boolean
  paths?: string | string[]
}

/**
 * Parsed result from a SKILL.md file.
 */
interface ParsedSkillFile {
  frontmatter: SkillFrontmatter
  markdownContent: string
}

/**
 * Parse YAML frontmatter from a Markdown file.
 * Real implementation: src/utils/frontmatterParser.ts:parseFrontmatter.
 *
 * Format:
 * ---
 * description: My skill
 * ---
 * Skill content here
 */
function parseFrontmatter(raw: string): ParsedSkillFile {
  const DELIMITER = '---'
  const lines = raw.split('\n')

  if (lines[0]?.trim() !== DELIMITER) {
    return { frontmatter: {}, markdownContent: raw }
  }

  const closingIdx = lines.slice(1).findIndex(l => l.trim() === DELIMITER)
  if (closingIdx === -1) {
    return { frontmatter: {}, markdownContent: raw }
  }

  const yamlLines = lines.slice(1, closingIdx + 1)
  const contentLines = lines.slice(closingIdx + 2)

  const frontmatter = (yaml.load(yamlLines.join('\n')) as SkillFrontmatter) ?? {}
  const markdownContent = contentLines.join('\n')

  return { frontmatter, markdownContent }
}

/**
 * Normalize the allowed-tools frontmatter value into a string array.
 */
function parseAllowedTools(raw: string | string[] | undefined): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  // Comma-separated: "Read, Grep, Bash"
  return raw.split(',').map(t => t.trim()).filter(Boolean)
}

/**
 * Perform variable substitution in skill content.
 * Real implementation: src/skills/loadSkillsDir.ts:344-370.
 *
 * Substitutes:
 *   $ARGUMENTS             → the args string passed to the skill
 *   ${CLAUDE_SKILL_DIR}    → the skill's base directory
 *   ${CLAUDE_SESSION_ID}   → the current session ID
 */
function substituteVariables(
  content: string,
  args: string,
  skillDir: string | undefined,
  sessionId: string,
): string {
  let result = content
  result = result.replace(/\$ARGUMENTS/g, args)
  if (skillDir) {
    result = result.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
  }
  result = result.replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId)
  return result
}

/**
 * Load skills from a .claude/skills/ directory.
 * Only supports the directory format: <skill-name>/SKILL.md
 *
 * Real implementation: src/skills/loadSkillsDir.ts:loadSkillsFromSkillsDir (line 407).
 *
 * Key behaviors:
 * - Single .md files in /skills/ are IGNORED (only subdirectories are scanned)
 * - SKILL.md filename is case-insensitive
 * - Errors per skill are isolated (one failure doesn't stop others)
 */
async function loadSkillsFromDirectory(
  skillsDir: string,
  source: SkillCommand['source'],
): Promise<SkillCommand[]> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true })
  } catch {
    // Directory doesn't exist — not an error in normal operation
    return []
  }

  const results = await Promise.all(
    entries.map(async (entry): Promise<SkillCommand | null> => {
      // Only process directories (or symlinks that resolve to directories)
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return null

      const skillDirPath = path.join(skillsDir, entry.name)
      const skillFilePath = path.join(skillDirPath, 'SKILL.md')

      let raw: string
      try {
        raw = await fs.readFile(skillFilePath, 'utf-8')
      } catch {
        return null // No SKILL.md — skip silently
      }

      try {
        const { frontmatter, markdownContent } = parseFrontmatter(raw)
        const skillName = entry.name
        const allowedTools = parseAllowedTools(frontmatter['allowed-tools'])

        const description =
          frontmatter.description ??
          // Fall back to first non-empty, non-heading line
          markdownContent.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() ??
          `Skill: ${skillName}`

        const command: SkillCommand = {
          type: 'prompt',
          name: skillName,
          description,
          whenToUse: frontmatter.when_to_use,
          argumentHint: frontmatter['argument-hint'],
          allowedTools,
          model: frontmatter.model,
          disableModelInvocation: false,
          userInvocable: frontmatter['user-invocable'] ?? true,
          isHidden: !(frontmatter['user-invocable'] ?? true),
          context: frontmatter.context === 'fork' ? 'fork' : undefined,
          source,
          loadedFrom: 'skills',
          skillRoot: skillDirPath,
          async getPromptForCommand(args, ctx) {
            const finalContent = substituteVariables(
              markdownContent,
              args,
              skillDirPath,
              ctx.sessionId,
            )
            return [{ type: 'text', text: finalContent }]
          },
        }

        console.log(`[loader] Loaded filesystem skill: ${skillName} (from ${skillFilePath})`)
        return command
      } catch (err) {
        console.error(`[loader] Error parsing skill ${entry.name}:`, err)
        return null
      }
    }),
  )

  return results.filter((r): r is SkillCommand => r !== null)
}

/**
 * Deduplicate skills using realpath-resolved paths.
 * Mirrors src/skills/loadSkillsDir.ts:726-763.
 *
 * Why realpath instead of inode?
 * Inode numbers are unreliable on NFS, ExFAT, and some container mounts
 * (inode 0 reported for all files). realpath is filesystem-agnostic.
 * See: src/skills/loadSkillsDir.ts:113-117
 */
async function deduplicateSkills(
  skills: Array<{ skill: SkillCommand; filePath: string }>,
): Promise<SkillCommand[]> {
  const seen = new Map<string, string>() // canonical path → skill name
  const result: SkillCommand[] = []

  for (const { skill, filePath } of skills) {
    let canonical: string
    try {
      canonical = await fs.realpath(filePath)
    } catch {
      // File inaccessible — include without dedup (can't resolve)
      result.push(skill)
      continue
    }

    if (seen.has(canonical)) {
      console.log(
        `[dedup] Skipping duplicate skill '${skill.name}' (same file as '${seen.get(canonical)}')`,
      )
      continue
    }

    seen.set(canonical, skill.name)
    result.push(skill)
  }

  return result
}

// ---------------------------------------------------------------------------
// 4. SKILL EXECUTION ENGINE
// ---------------------------------------------------------------------------

/**
 * Result for inline skill execution.
 * Claude receives the prompt and immediately starts using the allowedTools.
 */
interface InlineSkillResult {
  status: 'inline'
  success: true
  commandName: string
  allowedTools: string[]
  model?: string
  /** The expanded prompt content blocks */
  promptBlocks: ContentBlock[]
}

/**
 * Result for forked skill execution.
 * A sub-agent ran in isolation; only its text summary propagates back.
 */
interface ForkedSkillResult {
  status: 'forked'
  success: boolean
  commandName: string
  agentId: string
  /** Final result extracted from the sub-agent's messages */
  result: string
}

type SkillResult = InlineSkillResult | ForkedSkillResult

/**
 * Simulate running a forked sub-agent.
 * Real implementation: src/tools/SkillTool/SkillTool.ts:executeForkedSkill (line 122).
 *
 * The real version:
 * 1. Calls prepareForkedCommandContext() to build agent config + prompt messages
 * 2. Runs runAgent() which streams message events
 * 3. Collects messages, calls extractResultText() for the final summary
 * 4. Discards intermediate messages (agentMessages.length = 0)
 */
async function executeForkedSkill(
  command: SkillCommand,
  args: string,
  context: SkillUseContext,
): Promise<ForkedSkillResult> {
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  console.log(`[fork] Spawning sub-agent ${agentId} for skill '${command.name}'`)

  // Get the skill prompt
  const promptBlocks = await command.getPromptForCommand(args, context)
  const promptText = promptBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  // --- Simulated sub-agent execution ---
  // In the real code, runAgent() streams message events and the result is
  // extracted via extractResultText(agentMessages, 'Skill execution completed').
  // Here we simulate a simple result.
  console.log(`[fork] Agent ${agentId} processing prompt (${promptText.length} chars)`)
  const simulatedResult = `[Simulated] Skill '${command.name}' completed successfully.\nPrompt length: ${promptText.length} chars.`

  console.log(`[fork] Agent ${agentId} completed`)
  return {
    status: 'forked',
    success: true,
    commandName: command.name,
    agentId,
    result: simulatedResult,
  }
}

/**
 * Main SkillTool execution function.
 * Mirrors src/tools/SkillTool/SkillTool.ts call() implementation.
 *
 * Decision flow:
 * 1. Validate input (name non-empty, skill exists, is prompt type)
 * 2. Check permissions (simplified here)
 * 3. Dispatch: fork if command.context === 'fork', else inline
 */
async function executeSkill(
  skillName: string,
  args: string | undefined,
  context: SkillUseContext,
): Promise<SkillResult> {
  // --- Validation (mirrors validateInput, lines 354-429) ---
  const trimmed = skillName.trim()
  if (!trimmed) {
    throw new Error('Skill name must not be empty')
  }

  const normalizedName = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const command = findSkill(normalizedName)

  if (!command) {
    throw new Error(`Unknown skill: ${normalizedName}`)
  }
  if (command.type !== 'prompt') {
    throw new Error(`Skill '${normalizedName}' is not a prompt-based skill`)
  }
  if (command.disableModelInvocation) {
    throw new Error(`Skill '${normalizedName}' has disableModelInvocation set`)
  }

  const effectiveArgs = args ?? ''

  // --- Dispatch by execution context ---
  if (command.context === 'fork') {
    return executeForkedSkill(command, effectiveArgs, context)
  }

  // --- Inline execution ---
  // Returns prompt blocks + allowedTools; the caller (Claude) processes them
  // within the current conversation turn.
  // Real output schema: src/tools/SkillTool/SkillTool.ts:301-313
  const promptBlocks = await command.getPromptForCommand(effectiveArgs, context)
  console.log(`[inline] Skill '${normalizedName}' prompt ready (${command.allowedTools.join(', ')})`)

  return {
    status: 'inline',
    success: true,
    commandName: command.name,
    allowedTools: command.allowedTools,
    model: command.model,
    promptBlocks,
  }
}

// ---------------------------------------------------------------------------
// 5. EXAMPLE SKILLS
// ---------------------------------------------------------------------------

/**
 * Example 1: Inline skill — shows current git status.
 *
 * Because context is 'inline' (default), Claude receives the prompt and
 * continues in the same conversation turn using the allowed Bash tool.
 */
registerBundledSkill({
  name: 'git-status',
  description: 'Show the current git repository status',
  aliases: ['gs'],
  allowedTools: ['Bash'],
  whenToUse: 'Use when the user asks about git status, changed files, or repo state',
  // No context field → defaults to 'inline'
  async getPromptForCommand(_args, _ctx) {
    return [
      {
        type: 'text',
        text: `Run \`git status --short\` and \`git log --oneline -5\` to show the current repository state.
Present the results clearly, grouping staged and unstaged changes separately.`,
      },
    ]
  },
})

/**
 * Example 2: Forked skill — generate a conventional commit message.
 *
 * Uses context: 'fork' so it runs in an isolated sub-agent.
 * The sub-agent can use Bash and Read tools freely, then returns a summary.
 */
registerBundledSkill({
  name: 'smart-commit',
  description: 'Generate a conventional commit message from staged changes',
  aliases: ['commit'],
  allowedTools: ['Bash', 'Read'],
  argumentHint: '[scope or type override]',
  whenToUse: 'Use when the user wants to commit staged changes with a proper message',
  context: 'fork', // Spawns an isolated sub-agent
  async getPromptForCommand(args, _ctx) {
    const typeOverride = args.trim()

    return [
      {
        type: 'text',
        text: `You are a git commit message expert. Generate a conventional commit message.

Steps:
1. Run \`git diff --cached --stat\` to see changed files
2. Run \`git diff --cached\` to see the full diff
3. Determine the commit type:
   ${typeOverride ? `User specified: "${typeOverride}"` : ''}
   - fix: for bug fixes
   - feat: for new features
   - refactor: for code restructuring (no behavior change)
   - test: for test additions/changes
   - docs: for documentation changes
   - chore: for build, tooling, or config changes

4. Write the commit message in this format:
   type(scope): short description (max 72 chars)

   Optional longer body explaining WHY (not what)

5. Execute: \`git commit -m "..."\`

Important: Keep the subject line under 72 characters.`,
      },
    ]
  },
})

/**
 * Example 3: Skill with reference files.
 *
 * The 'files' field causes reference data to be extracted to disk
 * on first invocation. The model can then Read/Grep these files.
 * Real implementation: src/skills/bundledSkills.ts:59-73
 */
registerBundledSkill({
  name: 'security-review',
  description: 'Review code for common security vulnerabilities',
  allowedTools: ['Read', 'Grep', 'Bash'],
  whenToUse: 'Use when reviewing code changes for security issues before merging',
  context: 'fork',
  // These files are extracted to a temp directory on first use
  files: {
    'checklist.md': `# Security Review Checklist

## Injection
- [ ] SQL injection via string concatenation
- [ ] Command injection via unsanitized user input
- [ ] XSS via unescaped user content in HTML

## Authentication
- [ ] Missing authentication on sensitive endpoints
- [ ] Hardcoded credentials or API keys
- [ ] Weak password hashing

## Authorization
- [ ] Missing authorization checks (IDOR)
- [ ] Privilege escalation paths

## Cryptography
- [ ] Use of weak algorithms (MD5, SHA1 for passwords)
- [ ] Improper IV/nonce reuse
`,
    'patterns/dangerous.md': `# Dangerous Code Patterns

## JavaScript/TypeScript
- \`eval(\`
- \`innerHTML =\`
- \`document.write(\`
- \`dangerouslySetInnerHTML\`
- \`child_process.exec(\` with user input

## SQL
- String template literals in queries
- \`EXECUTE\` with dynamic SQL
`,
  },
  async getPromptForCommand(args, _ctx) {
    // When files are present, the real implementation prepends:
    // "Base directory for this skill: <extracted-dir>"
    // so the model knows where to find the reference files.
    const target = args.trim() || 'the provided code'
    return [
      {
        type: 'text',
        text: `Review ${target} for security vulnerabilities.

Use the checklist at \${CLAUDE_SKILL_DIR}/checklist.md as your guide.
Also check for patterns listed in \${CLAUDE_SKILL_DIR}/patterns/dangerous.md.

For each issue found, report:
- Severity (Critical/High/Medium/Low)
- Location (file:line)
- Description of the vulnerability
- Recommended fix`,
      },
    ]
  },
})

// ---------------------------------------------------------------------------
// 6. DEMO — MAIN
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Chapter 10: Plugin & Skill System Demo ===\n')

  const ctx: SkillUseContext = {
    cwd: process.cwd(),
    sessionId: `session-${Date.now()}`,
  }

  // --- List all registered skills ---
  console.log('Registered skills:')
  for (const skill of skillRegistry) {
    const contextLabel = skill.context === 'fork' ? '[fork]' : '[inline]'
    console.log(`  /${skill.name} ${contextLabel} — ${skill.description}`)
  }
  console.log()

  // --- Load filesystem skills from .claude/skills/ if present ---
  const fsSkillsDir = path.join(process.cwd(), '.claude', 'skills')
  console.log(`Loading filesystem skills from: ${fsSkillsDir}`)
  const fsSkills = await loadSkillsFromDirectory(fsSkillsDir, 'projectSettings')
  for (const skill of fsSkills) {
    skillRegistry.push(skill)
  }
  if (fsSkills.length === 0) {
    console.log('  (no .claude/skills/ directory found — skipped)\n')
  } else {
    console.log()
  }

  // --- Execute: inline skill ---
  console.log('--- Executing inline skill: /git-status ---')
  try {
    const result = await executeSkill('git-status', undefined, ctx)
    if (result.status === 'inline') {
      console.log('Inline result:')
      console.log('  allowedTools:', result.allowedTools)
      console.log('  prompt preview:', result.promptBlocks[0]?.type === 'text'
        ? result.promptBlocks[0].text.slice(0, 80) + '...'
        : '(non-text block)')
    }
  } catch (err) {
    console.error('Error:', err)
  }
  console.log()

  // --- Execute: forked skill ---
  console.log('--- Executing forked skill: /smart-commit ---')
  try {
    const result = await executeSkill('smart-commit', 'feat', ctx)
    if (result.status === 'forked') {
      console.log('Forked result:')
      console.log('  agentId:', result.agentId)
      console.log('  result:', result.result)
    }
  } catch (err) {
    console.error('Error:', err)
  }
  console.log()

  // --- Execute: alias resolution ---
  console.log('--- Alias resolution: /gs → git-status ---')
  try {
    const result = await executeSkill('/gs', undefined, ctx)
    console.log('Alias resolved:', result.commandName, '| status:', result.status)
  } catch (err) {
    console.error('Error:', err)
  }
  console.log()

  // --- Execute: unknown skill ---
  console.log('--- Unknown skill: /nonexistent ---')
  try {
    await executeSkill('nonexistent', undefined, ctx)
  } catch (err) {
    console.log('Expected error:', (err as Error).message)
  }

  console.log('\n=== Demo complete ===')
}

main().catch(console.error)

// ---------------------------------------------------------------------------
// ARCHITECTURE NOTES
// ---------------------------------------------------------------------------
//
// INLINE vs FORK — when to choose:
//
//   Inline:
//   - Short tasks that benefit from shared conversation context
//   - Skills that need to ask clarifying questions
//   - Low overhead, shares token budget with parent
//
//   Fork:
//   - Long-running autonomous tasks (e.g., full code review)
//   - Tasks that don't need to see the conversation history
//   - Provides isolation — sub-agent failures don't corrupt parent state
//
// REAL vs SIMPLIFIED differences in this demo:
//
//   Real loadSkillsDir.ts:
//   - Uses realpath() for deduplication (symlink-safe)
//   - Supports .skillsignore exclusions
//   - Handles managed/user/project/additional dirs in one pass
//   - Memoized per cwd (lodash-es/memoize)
//   - Supports bare mode (--bare flag skips auto-discovery)
//   - Supports conditional skills (paths frontmatter)
//
//   Real SkillTool.ts:
//   - Full analytics events (tengu_skill_tool_invocation)
//   - Permission system (allow/deny rules with prefix wildcards)
//   - Remote skill search (experimental, ant-only)
//   - Shell command execution in prompt (!`...` syntax)
//   - Variable substitution via substituteArguments()
//   - Model override resolution
//   - Effort level propagation to sub-agents
