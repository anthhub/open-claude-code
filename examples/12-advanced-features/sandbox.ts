/**
 * Chapter 12: Advanced Features — Sandbox System Example
 *
 * This file implements a simplified sandbox that mirrors the architecture
 * of Claude Code's @anthropic-ai/sandbox-runtime integration.
 *
 * Key concepts demonstrated:
 *  1. FilesystemPolicy — allow/deny lists for read and write operations
 *  2. NetworkPolicy    — domain allow/deny lists
 *  3. Path normalization — resolving //, /, ~/ path conventions
 *  4. Violation detection and callbacks
 *  5. Policy composition from multiple sources (user, project, managed)
 *
 * Source references:
 *  - src/utils/sandbox/sandbox-adapter.ts (lines 84–119, 225–350)
 *  - @anthropic-ai/sandbox-runtime (SandboxManager, SandboxViolationEvent)
 */

import { homedir, platform } from 'os'
import { join, resolve } from 'path'

// ============================================================================
// Types — mirroring @anthropic-ai/sandbox-runtime interfaces
// ============================================================================

/** A violation that occurred when a sandboxed operation was attempted. */
export type ViolationEvent = {
  /** Operation type that was attempted */
  type: 'fs_read' | 'fs_write' | 'network'
  /** File path (fs violations) */
  path?: string
  /** Domain (network violations) */
  domain?: string
  /** Which policy rule triggered the denial */
  deniedBy: string
}

/** Callback invoked when a sandbox violation occurs. */
export type ViolationCallback = (event: ViolationEvent) => void

/** Filesystem access policy. */
export type FilesystemPolicy = {
  /** Paths allowed for writing (glob or exact match) */
  allowWrite: string[]
  /** Paths denied for writing — takes precedence over allowWrite */
  denyWrite: string[]
  /** Paths denied for reading */
  denyRead: string[]
  /** Paths explicitly allowed for reading (empty = allow all except denyRead) */
  allowRead: string[]
}

/** Network access policy. */
export type NetworkPolicy = {
  /** Allowed outbound domains (empty = deny all) */
  allowedDomains: string[]
  /** Denied domains — takes precedence over allowedDomains */
  deniedDomains: string[]
}

/** Combined sandbox policy. */
export type SandboxPolicy = {
  filesystem: FilesystemPolicy
  network: NetworkPolicy
}

// ============================================================================
// Path Normalization — replicating resolvePathPatternForSandbox
// ============================================================================

/**
 * Resolve Claude Code-specific path patterns for the sandbox.
 *
 * Conventions (from sandbox-adapter.ts:84–119):
 *  - //path  → /path   (absolute from filesystem root)
 *  - /path   → $settingsDir/path  (relative to settings file directory)
 *  - ~/path  → $HOME/path  (home-relative)
 *  - ./path or bare path → as-is (CWD-relative or absolute)
 *
 * @param pattern    Raw pattern from a permission rule or config
 * @param settingsDir Directory of the settings file that provided this rule
 */
export function resolvePathPattern(
  pattern: string,
  settingsDir: string,
): string {
  // // prefix: strip one slash to get the absolute path
  if (pattern.startsWith('//')) {
    return pattern.slice(1) // "//etc/passwd" → "/etc/passwd"
  }

  // ~/ prefix: expand to home directory
  if (pattern.startsWith('~/')) {
    return join(homedir(), pattern.slice(2))
  }

  // / prefix (but not //): relative to settings file directory
  if (pattern.startsWith('/') && !pattern.startsWith('//')) {
    return resolve(settingsDir, pattern.slice(1))
  }

  // ./path or bare path: return as-is (caller resolves against CWD)
  return pattern
}

/**
 * Resolve paths from sandbox.filesystem.* settings.
 *
 * Unlike permission rules, these settings use standard semantics:
 *  - /path → absolute (NOT settings-relative). This was bug #30067.
 *  - ~/path → home-relative
 *  - //path → absolute (legacy compat)
 *
 * @param pattern    Path pattern from sandbox.filesystem config
 * @param settingsDir Settings file directory (only used for relative paths)
 */
export function resolveSandboxFilesystemPath(
  pattern: string,
  settingsDir: string,
): string {
  // Legacy //path → /path
  if (pattern.startsWith('//')) return pattern.slice(1)

  // ~/path → home-relative
  if (pattern.startsWith('~/')) return join(homedir(), pattern.slice(2))

  // ./path or relative → resolve against settings dir
  if (!pattern.startsWith('/')) {
    return resolve(settingsDir, pattern)
  }

  // /path → absolute as-is (standard Unix absolute path)
  return pattern
}

// ============================================================================
// Pattern Matching — simplified glob-like matching
// ============================================================================

/**
 * Check if a path matches a pattern.
 *
 * Supports:
 *  - Exact match: "/foo/bar" matches only "/foo/bar"
 *  - Directory glob: "/foo/**" matches "/foo/bar" and "/foo/bar/baz"
 *  - Wildcard: "/foo/*.ts" matches "/foo/a.ts" but not "/foo/bar/a.ts"
 */
export function matchesPattern(path: string, pattern: string): boolean {
  // Exact match
  if (path === pattern) return true

  // Directory prefix: pattern ends with /**
  if (pattern.endsWith('/**')) {
    const dir = pattern.slice(0, -3)
    return path === dir || path.startsWith(dir + '/')
  }

  // Wildcard: pattern contains *
  if (pattern.includes('*')) {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars
      .replace(/\*/g, '[^/]*') // * → match anything except /
    const regex = new RegExp(`^${regexStr}$`)
    return regex.test(path)
  }

  // Directory match: path starts with pattern + /
  return path.startsWith(pattern + '/')
}

/**
 * Check if a path matches any pattern in a list.
 * Returns the first matching pattern, or null if no match.
 */
export function findMatchingPattern(
  path: string,
  patterns: string[],
): string | null {
  for (const pattern of patterns) {
    if (matchesPattern(path, pattern)) return pattern
  }
  return null
}

// ============================================================================
// SimpleSandbox — the core sandbox implementation
// ============================================================================

/**
 * A simplified sandbox that enforces filesystem and network policies.
 *
 * In production Claude Code, the actual enforcement is done at the OS level
 * by @anthropic-ai/sandbox-runtime using Linux namespaces (bwrap) or
 * macOS sandbox profiles (sandbox-exec). This implementation shows the
 * policy evaluation logic that feeds into those mechanisms.
 */
export class SimpleSandbox {
  private policy: SandboxPolicy
  private violations: ViolationEvent[] = []
  private violationCallbacks: ViolationCallback[] = []

  constructor(policy: SandboxPolicy) {
    this.policy = policy
  }

  // --------------------------------------------------------------------------
  // Policy access
  // --------------------------------------------------------------------------

  getPolicy(): Readonly<SandboxPolicy> {
    return this.policy
  }

  // --------------------------------------------------------------------------
  // Violation handling
  // --------------------------------------------------------------------------

  /**
   * Register a callback to receive violation events.
   * Pending violations (collected before handler registration) are replayed.
   */
  onViolation(callback: ViolationCallback): void {
    this.violationCallbacks.push(callback)
    // Replay buffered violations (mirrors hookEvents.ts pending event pattern)
    for (const v of this.violations) {
      callback(v)
    }
  }

  private recordViolation(event: ViolationEvent): void {
    this.violations.push(event)
    for (const cb of this.violationCallbacks) {
      cb(event)
    }
  }

  // --------------------------------------------------------------------------
  // Filesystem checks
  // --------------------------------------------------------------------------

  /**
   * Check whether a read operation is allowed.
   *
   * Logic:
   *  1. denyRead takes precedence over everything
   *  2. If allowRead is non-empty, path must match at least one entry
   *  3. Otherwise, read is allowed
   */
  checkRead(path: string): boolean {
    const absPath = resolve(path)

    // denyRead always wins
    const denyMatch = findMatchingPattern(absPath, this.policy.filesystem.denyRead)
    if (denyMatch) {
      this.recordViolation({
        type: 'fs_read',
        path: absPath,
        deniedBy: `denyRead: ${denyMatch}`,
      })
      return false
    }

    // If allowRead is specified, path must be in it
    if (this.policy.filesystem.allowRead.length > 0) {
      const allowMatch = findMatchingPattern(absPath, this.policy.filesystem.allowRead)
      if (!allowMatch) {
        this.recordViolation({
          type: 'fs_read',
          path: absPath,
          deniedBy: 'not in allowRead',
        })
        return false
      }
    }

    return true
  }

  /**
   * Check whether a write operation is allowed.
   *
   * Logic:
   *  1. denyWrite takes precedence over allowWrite
   *  2. Path must match at least one allowWrite entry
   */
  checkWrite(path: string): boolean {
    const absPath = resolve(path)

    // denyWrite always wins (settings files, bare-git-repo files, etc.)
    const denyMatch = findMatchingPattern(absPath, this.policy.filesystem.denyWrite)
    if (denyMatch) {
      this.recordViolation({
        type: 'fs_write',
        path: absPath,
        deniedBy: `denyWrite: ${denyMatch}`,
      })
      return false
    }

    // Must match at least one allowWrite pattern
    const allowMatch = findMatchingPattern(absPath, this.policy.filesystem.allowWrite)
    if (!allowMatch) {
      this.recordViolation({
        type: 'fs_write',
        path: absPath,
        deniedBy: 'not in allowWrite',
      })
      return false
    }

    return true
  }

  // --------------------------------------------------------------------------
  // Network checks
  // --------------------------------------------------------------------------

  /**
   * Check whether a network request to a domain is allowed.
   *
   * Logic:
   *  1. deniedDomains takes precedence
   *  2. Must match at least one allowedDomains entry (suffix match)
   */
  checkNetwork(domain: string): boolean {
    // Denied domains win
    for (const denied of this.policy.network.deniedDomains) {
      if (domain === denied || domain.endsWith('.' + denied)) {
        this.recordViolation({
          type: 'network',
          domain,
          deniedBy: `deniedDomains: ${denied}`,
        })
        return false
      }
    }

    // Must be in allowed domains (or subdomain thereof)
    for (const allowed of this.policy.network.allowedDomains) {
      if (domain === allowed || domain.endsWith('.' + allowed)) {
        return true
      }
    }

    this.recordViolation({
      type: 'network',
      domain,
      deniedBy: 'not in allowedDomains',
    })
    return false
  }

  getViolations(): ReadonlyArray<ViolationEvent> {
    return this.violations
  }
}

// ============================================================================
// Policy Builder — composing policies from multiple sources
// ============================================================================

export type PolicySource = {
  name: string
  settingsDir: string
  /**
   * Permission-rule style entries (/ = settings-relative)
   * e.g., ["Edit(/src/**)", "Read(~/.config/**)", "WebFetch(domain:api.example.com)"]
   */
  allowRules?: string[]
  denyRules?: string[]
  /**
   * sandbox.filesystem.* style entries (/ = absolute)
   */
  sandboxFilesystem?: {
    allowWrite?: string[]
    denyWrite?: string[]
    denyRead?: string[]
    allowRead?: string[]
  }
  /**
   * sandbox.network.* style entries
   */
  sandboxNetwork?: {
    allowedDomains?: string[]
    deniedDomains?: string[]
  }
}

/**
 * Build a merged SandboxPolicy from multiple configuration sources.
 *
 * This mirrors how sandbox-adapter.ts iterates SETTING_SOURCES (lines 303–348)
 * and merges rules from userSettings, projectSettings, localSettings, and policySettings.
 *
 * Priority:
 *  - denyWrite always wins (settings files are always in denyWrite)
 *  - allowWrite entries from all sources are merged
 *  - managedOnly: when true, only the managed/admin source contributes allowRead
 */
export function buildPolicy(
  sources: PolicySource[],
  options: { cwd?: string; managedOnlySource?: string } = {},
): SandboxPolicy {
  const cwd = options.cwd ?? process.cwd()
  const managedOnlySource = options.managedOnlySource

  const policy: SandboxPolicy = {
    filesystem: {
      allowWrite: [cwd], // CWD is always writable
      denyWrite: [],
      denyRead: [],
      allowRead: [],
    },
    network: {
      allowedDomains: [],
      deniedDomains: [],
    },
  }

  for (const source of sources) {
    const { settingsDir } = source

    // Process permission-rule style allow/deny
    for (const rule of source.allowRules ?? []) {
      // Edit(path) → allowWrite
      const editMatch = rule.match(/^Edit\((.+)\)$/)
      if (editMatch?.[1]) {
        policy.filesystem.allowWrite.push(
          resolvePathPattern(editMatch[1], settingsDir),
        )
      }
      // WebFetch(domain:x) → allowedDomains
      const fetchMatch = rule.match(/^WebFetch\(domain:(.+)\)$/)
      if (fetchMatch?.[1]) {
        policy.network.allowedDomains.push(fetchMatch[1])
      }
    }

    for (const rule of source.denyRules ?? []) {
      // Edit(path) deny → denyWrite
      const editMatch = rule.match(/^Edit\((.+)\)$/)
      if (editMatch?.[1]) {
        policy.filesystem.denyWrite.push(
          resolvePathPattern(editMatch[1], settingsDir),
        )
      }
      // Read(path) deny → denyRead
      const readMatch = rule.match(/^Read\((.+)\)$/)
      if (readMatch?.[1]) {
        policy.filesystem.denyRead.push(
          resolvePathPattern(readMatch[1], settingsDir),
        )
      }
      // WebFetch deny → deniedDomains
      const fetchMatch = rule.match(/^WebFetch\(domain:(.+)\)$/)
      if (fetchMatch?.[1]) {
        policy.network.deniedDomains.push(fetchMatch[1])
      }
    }

    // Process sandbox.filesystem.* style config (/ = absolute)
    const fs = source.sandboxFilesystem
    if (fs) {
      for (const p of fs.allowWrite ?? []) {
        policy.filesystem.allowWrite.push(
          resolveSandboxFilesystemPath(p, settingsDir),
        )
      }
      for (const p of fs.denyWrite ?? []) {
        policy.filesystem.denyWrite.push(
          resolveSandboxFilesystemPath(p, settingsDir),
        )
      }
      for (const p of fs.denyRead ?? []) {
        policy.filesystem.denyRead.push(
          resolveSandboxFilesystemPath(p, settingsDir),
        )
      }
      // allowRead: only include from managed source when managedOnlySource is set
      const isManaged = managedOnlySource && source.name === managedOnlySource
      if (!managedOnlySource || isManaged) {
        for (const p of fs.allowRead ?? []) {
          policy.filesystem.allowRead.push(
            resolveSandboxFilesystemPath(p, settingsDir),
          )
        }
      }
    }

    // Process sandbox.network.* style config
    const net = source.sandboxNetwork
    if (net) {
      policy.network.allowedDomains.push(...(net.allowedDomains ?? []))
      policy.network.deniedDomains.push(...(net.deniedDomains ?? []))
    }
  }

  return policy
}

// ============================================================================
// Demo — run with: npx ts-node examples/12-advanced-features/sandbox.ts
// ============================================================================

function demo(): void {
  console.log('=== Chapter 12: Sandbox System Demo ===\n')

  // 1. Path normalization
  console.log('--- Path Normalization ---')
  const settingsDir = '/home/user/.claude'
  const examples = [
    '//etc/passwd',
    '/config/*.json',
    '~/Documents/**',
    './src/**',
    'build/**',
  ]
  for (const p of examples) {
    const resolved = resolvePathPattern(p, settingsDir)
    console.log(`  ${p.padEnd(20)} → ${resolved}`)
  }

  console.log()

  // 2. Policy composition from multiple sources
  console.log('--- Policy Composition ---')
  const sources: PolicySource[] = [
    {
      name: 'userSettings',
      settingsDir: '/home/user/.claude',
      allowRules: [
        'WebFetch(domain:api.github.com)',
        'WebFetch(domain:npmjs.com)',
      ],
      sandboxFilesystem: {
        allowWrite: ['~/projects/**'],
        denyRead: ['~/.ssh/**'],
      },
    },
    {
      name: 'projectSettings',
      settingsDir: '/home/user/projects/myapp/.claude',
      allowRules: ['Edit(/src/**)', 'Edit(/tests/**)'],
      denyRules: ['Edit(/secrets/*)'],
      sandboxNetwork: {
        allowedDomains: ['localhost'],
      },
    },
    {
      name: 'managed',
      settingsDir: '/etc/claude',
      sandboxNetwork: {
        deniedDomains: ['malware.example.com'],
      },
    },
  ]

  const policy = buildPolicy(sources, { cwd: '/home/user/projects/myapp' })

  console.log('  Merged policy:')
  console.log('  allowWrite:', policy.filesystem.allowWrite)
  console.log('  denyWrite: ', policy.filesystem.denyWrite)
  console.log('  denyRead:  ', policy.filesystem.denyRead)
  console.log('  allowDomains:', policy.network.allowedDomains)
  console.log('  denyDomains: ', policy.network.deniedDomains)

  console.log()

  // 3. Sandbox enforcement with violation detection
  console.log('--- Sandbox Enforcement ---')
  const sandbox = new SimpleSandbox(policy)

  const violations: ViolationEvent[] = []
  sandbox.onViolation(v => {
    violations.push(v)
    console.log(`  VIOLATION: ${v.type} — ${v.path ?? v.domain} (${v.deniedBy})`)
  })

  // Filesystem checks
  const fsChecks: Array<{ op: 'read' | 'write'; path: string }> = [
    { op: 'write', path: '/home/user/projects/myapp/src/index.ts' }, // allowed
    { op: 'write', path: '/home/user/projects/myapp/secrets/key.pem' }, // denied
    { op: 'read', path: '/home/user/.ssh/id_rsa' }, // denied (denyRead)
    { op: 'read', path: '/home/user/projects/myapp/package.json' }, // allowed
    { op: 'write', path: '/etc/hosts' }, // denied (not in allowWrite)
  ]

  console.log('  Filesystem checks:')
  for (const check of fsChecks) {
    const allowed =
      check.op === 'read'
        ? sandbox.checkRead(check.path)
        : sandbox.checkWrite(check.path)
    const status = allowed ? 'ALLOW' : 'DENY '
    console.log(`    [${status}] ${check.op} ${check.path}`)
  }

  console.log()

  // Network checks
  const networkChecks = [
    'api.github.com',
    'npmjs.com',
    'subdomain.npmjs.com',
    'malware.example.com', // denied
    'unknown.example.com', // not in allowList
    'localhost',
  ]

  console.log('  Network checks:')
  for (const domain of networkChecks) {
    const allowed = sandbox.checkNetwork(domain)
    const status = allowed ? 'ALLOW' : 'DENY '
    console.log(`    [${status}] ${domain}`)
  }

  console.log()

  // 4. Violation summary
  console.log('--- Violation Summary ---')
  console.log(`  Total violations: ${violations.length}`)
  const byType = violations.reduce(
    (acc, v) => {
      acc[v.type] = (acc[v.type] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`)
  }

  console.log()

  // 5. Platform info (sandbox runtime differs by OS)
  console.log('--- Platform Info ---')
  const os = platform()
  const sandboxMechanism = {
    darwin: 'sandbox-exec (macOS sandbox profiles)',
    linux: 'bwrap (Linux user namespaces)',
    win32: 'not supported',
  }[os] ?? 'not supported'
  console.log(`  OS: ${os}`)
  console.log(`  Sandbox mechanism: ${sandboxMechanism}`)
  console.log(
    `  Production enforcement: @anthropic-ai/sandbox-runtime wraps ${sandboxMechanism}`,
  )

  console.log('\n=== Demo Complete ===')
}

demo()
