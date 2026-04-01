# Chapter 12: Advanced Features

> **Difficulty:** Advanced | **Reading time:** ~90 minutes

---

## Table of Contents

1. [Introduction: The Advanced Layer](#1-introduction-the-advanced-layer)
2. [Sandbox System](#2-sandbox-system)
3. [Hook System](#3-hook-system)
4. [Bridge & IDE Integration](#4-bridge--ide-integration)
5. [Remote Execution](#5-remote-execution)
6. [Voice Mode](#6-voice-mode)
7. [Git Integration](#7-git-integration)
8. [Vim Mode & Keybindings](#8-vim-mode--keybindings)
9. [Server Mode](#9-server-mode)
10. [Hands-on: Build a Sandbox](#10-hands-on-build-a-sandbox)
11. [Key Takeaways & Journey Recap](#11-key-takeaways--journey-recap)

---

## 1. Introduction: The Advanced Layer

You've made it to Chapter 12. At this point you understand Claude Code's CLI entrypoint, its tool system, permission model, MCP integration, agent coordination, plugin/skill architecture, and state management. This final chapter covers the systems that sit at the edges — mechanisms that either protect the core (sandbox), extend it into new environments (bridge, remote, voice), or give power users fine-grained control (hooks, vim mode, keybindings).

These systems share a design philosophy: **opt-in capability with safe defaults**. None of them are on by default. Each is explicitly enabled by the user or deployment administrator, and each has fail-safe behavior when its dependencies are unavailable.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Claude Code Core                              │
│                   (CLI, Tools, Permissions, MCP)                    │
├─────────────┬───────────────┬────────────────┬───────────────────── ┤
│   Sandbox   │     Hooks     │  Bridge/Remote │  Voice / Vim / Keys  │
│  (isolation)│ (automation)  │  (IDE/cloud)   │  (input experience)  │
└─────────────┴───────────────┴────────────────┴─────────────────────-┘
```

---

## 2. Sandbox System

The sandbox is Claude Code's OS-level isolation layer. When enabled, every `Bash` tool invocation runs inside a restricted environment that limits filesystem access, network connectivity, and process capabilities.

### 2.1 Architecture

The sandbox is implemented in the `@anthropic-ai/sandbox-runtime` package, wrapped by Claude Code's adapter at `src/utils/sandbox/sandbox-adapter.ts`.

```
Claude Code (src/utils/sandbox/sandbox-adapter.ts)
      │
      ▼
SandboxManager (from @anthropic-ai/sandbox-runtime)
      │
      ├── FsReadRestrictionConfig    ─► bwrap / sandbox-exec mounts
      ├── FsWriteRestrictionConfig   ─► read-only binds vs. writable binds
      ├── NetworkRestrictionConfig   ─► HTTP proxy intercept
      └── SandboxViolationStore      ─► violation callbacks
```

The exported `SandboxManager` (line 19 of `sandbox-adapter.ts`) is a singleton that wraps `BaseSandboxManager` from the runtime package with:

- **Settings integration** — reads `~/.claude/settings.json` and `.claude/settings.json`
- **Permission rule mapping** — converts `Edit(path)` and `Read(path)` rules to filesystem allow/deny lists
- **Path convention resolution** — translates Claude Code's `//path`, `/path`, `~/path` conventions
- **Security hardening** — additional deny-writes for settings files, bare-git-repo attack surfaces

### 2.2 Filesystem Restrictions

The sandbox constructs two lists for each direction (read/write): allow and deny.

```typescript
// From sandbox-adapter.ts:225-235
const allowWrite: string[] = ['.', getClaudeTempDir()]
const denyWrite: string[] = []
const denyRead: string[] = []
const allowRead: string[] = []

// Always deny writes to settings files to prevent sandbox escape
const settingsPaths = SETTING_SOURCES.map(source =>
  getSettingsFilePathForSource(source),
).filter((p): p is string => p !== undefined)
denyWrite.push(...settingsPaths)
```

The current working directory (`.`) is always writable. The Claude temp directory is always writable (needed for Shell.ts CWD tracking). Settings files are always read-only — this prevents a malicious prompt from instructing Claude to write a hook into `settings.json` that executes on the next session.

**Permission rule mapping** (lines 308–327):

```typescript
// Edit(path) rules → allowWrite or denyWrite
if (rule.toolName === FILE_EDIT_TOOL_NAME && rule.ruleContent) {
  allowWrite.push(resolvePathPatternForSandbox(rule.ruleContent, source))
}

// Read(path) deny rules → denyRead
if (rule.toolName === FILE_READ_TOOL_NAME && rule.ruleContent) {
  denyRead.push(resolvePathPatternForSandbox(rule.ruleContent, source))
}
```

### 2.3 Path Resolution Conventions

Claude Code uses three path conventions in permission rules, each with different semantics (lines 84–119):

| Prefix | Example | Resolves to |
|--------|---------|-------------|
| `//` | `//etc/passwd` | `/etc/passwd` (absolute from root) |
| `/` | `/config/*.json` | `$SETTINGS_DIR/config/*.json` (settings-relative) |
| `~/` | `~/.ssh/**` | `/home/user/.ssh/**` (home-relative, via sandbox-runtime) |
| `./` or bare | `src/**` | `$CWD/src/**` (CWD-relative) |

The `//` convention exists because `/` alone means "relative to the settings file directory" — useful for project-scoped rules. If you want an absolute path in a rule, you must escape it with `//`.

However, in the `sandbox.filesystem.*` settings (as opposed to permission rules), `/path` means the literal absolute path. This distinction was the root cause of bug #30067, fixed in `resolveSandboxFilesystemPath` (line 138).

```
resolvePathPatternForSandbox  →  for permission rules  (/ = settings-relative)
resolveSandboxFilesystemPath  →  for sandbox.filesystem.*  (/ = absolute)
```

### 2.4 Network Restrictions

Network restrictions are implemented as a transparent HTTP proxy. All outbound HTTP/HTTPS from sandboxed processes routes through the proxy, which enforces the allowlist and denylist.

The allowed domains come from two sources:

1. `WebFetch(domain:example.com)` permission rules
2. `sandbox.network.allowedDomains` in settings

When `allowManagedDomainsOnly: true` is set in `policySettings` (enterprise deployments), only the admin-controlled domains are effective — user settings are ignored (lines 182–196).

Unix socket access is off by default and requires explicit opt-in:
```json
{
  "sandbox": {
    "network": {
      "allowUnixSockets": true
    }
  }
}
```

### 2.5 Violation Callbacks

The `SandboxViolationStore` from `@anthropic-ai/sandbox-runtime` collects violation events when a sandboxed process tries to access a denied path or network endpoint. These events flow up to the UI as warnings.

```typescript
export type SandboxViolationEvent = {
  type: 'fs_read' | 'fs_write' | 'network'
  path?: string         // for fs violations
  domain?: string       // for network violations
  process?: string      // which process triggered the violation
}
```

### 2.6 Security Hardening: Bare-Git-Repo Attack

Lines 257–280 implement a defense against a subtle attack: an attacker who can plant files in the current working directory could create a fake git repository (`HEAD` + `objects/` + `refs/`) with a `core.fsmonitor` hook pointing to a malicious script. When Claude's unsandboxed `git` runs next, it would execute that script.

The defense:
1. If the bare-repo files exist, add them to `denyWrite` (sandbox mounts them read-only)
2. If they don't exist yet, add their paths to `bareGitRepoScrubPaths`
3. After every sandboxed command, `scrubBareGitRepoFiles()` deletes any newly-created bare-repo files before Claude's git runs (line 404)

### 2.7 Enabling the Sandbox

```json
// ~/.claude/settings.json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "failIfUnavailable": false
  }
}
```

`autoAllowBashIfSandboxed: true` (default) means that when the sandbox is enabled, Bash commands that would normally require explicit permission are auto-approved — because the sandbox itself provides OS-level enforcement.

`failIfUnavailable: false` (default) means if dependencies are missing, Claude Code runs unsandboxed rather than refusing to start.

Platform support: macOS (sandbox-exec), Linux (bwrap), WSL2+. WSL1 is not supported.

---

## 3. Hook System

Hooks allow you to intercept Claude Code's lifecycle events and run custom logic — shell commands, LLM prompts, or HTTP requests — at specific points.

### 3.1 Hook Types

There are four hook types, defined in `src/utils/settings/types.ts`:

| Type | Execution | Use case |
|------|-----------|----------|
| `command` | Shell subprocess | Run scripts, linters, formatters |
| `prompt` | LLM call (Haiku by default) | Semantic validation, AI-powered gates |
| `agent` | Claude Code sub-agent | Complex multi-step automation |
| `http` | HTTP POST request | Webhooks, external services |

### 3.2 Hook Events

Hooks fire on these events (from `src/entrypoints/agentSdkTypes.ts`):

```
PreToolUse        — before any tool call executes
PostToolUse       — after a tool call completes
UserPromptSubmit  — when the user sends a message
AssistantResponse — when Claude generates a response
SessionStart      — once at session initialization
Setup             — configuration/startup phase
Stop              — when the session ends
```

### 3.3 Hook Sources and Priority

Hooks come from 7 sources, iterated in this priority order (from `src/utils/hooks/hooksSettings.ts`):

```typescript
// Lines 102-107
const sources = [
  'userSettings',    // ~/.claude/settings.json
  'projectSettings', // .claude/settings.json
  'localSettings',   // .claude/settings.local.json
] as EditableSettingSource[]

// Plus:
// 'policySettings'  — managed/enterprise settings (admin-only)
// 'pluginHook'      — ~/.claude/plugins/*/hooks/hooks.json
// 'sessionHook'     — in-memory hooks registered via SDK
// 'builtinHook'     — Claude Code internals
```

When `allowManagedHooksOnly: true` is set in policy settings, only `policySettings` hooks run. All user/project/plugin hooks are suppressed.

### 3.4 Hook Configuration

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'About to run bash' | logger"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Did the tool call $ARGUMENTS succeed without side effects outside the project? Return {\"ok\": true} if yes."
          }
        ]
      }
    ]
  }
}
```

The `matcher` is a regex matched against the tool name.

### 3.5 Prompt Hooks

Prompt hooks use an LLM (Haiku by default) to evaluate whether a hook condition is met. The `execPromptHook` function (line 21 of `src/utils/hooks/execPromptHook.ts`) replaces `$ARGUMENTS` in the prompt with the hook's JSON input and queries the model.

The model is instructed to return either `{"ok": true}` or `{"ok": false, "reason": "..."}`. A `false` response blocks the operation and surfaces the reason to the user.

Prompt hooks have a default timeout of 30 seconds (line 55).

### 3.6 HTTP Hooks

HTTP hooks POST to an external URL. They flow through the sandbox network proxy when sandboxing is enabled — the proxy enforces the same domain allowlist as Bash commands (lines 21–41 of `execHttpHook.ts`).

URL allowlisting is available via `allowedHttpHookUrls` in settings to restrict which endpoints hooks can reach.

### 3.7 Hook Event System

The hook event system (`src/utils/hooks/hookEvents.ts`) allows SDK consumers to observe hook executions in real time:

```typescript
// Three event types
type HookStartedEvent  = { type: 'started'; hookId; hookName; hookEvent }
type HookProgressEvent = { type: 'progress'; hookId; ...; stdout; stderr; output }
type HookResponseEvent = { type: 'response'; hookId; ...; exitCode; outcome }
```

Events buffer in `pendingEvents` (max 100) until a handler is registered, then flush immediately (lines 61–70). This prevents races between hook execution and SDK consumer registration.

Two events always emit regardless of `includeHookEvents` setting: `SessionStart` and `Setup` (line 18).

---

## 4. Bridge & IDE Integration

The bridge is how Claude Code integrates with IDEs (VS Code, JetBrains) and the claude.ai web UI. It establishes a bidirectional channel between the CLI process and the remote environment.

### 4.1 Long-Polling Architecture

```
┌──────────────┐          ┌──────────────────┐          ┌───────────┐
│   IDE Plugin │          │  Bridge Server   │          │  Claude   │
│  (VS Code /  │◄────────►│  (claude.ai)     │◄────────►│   CLI     │
│  JetBrains)  │  HTTP WS │                  │  HTTP WS │  Process  │
└──────────────┘          └──────────────────┘          └───────────┘
                                   │
                            WorkSecret JWT
                         (base64url-encoded)
```

The CLI side is implemented in `src/bridge/replBridge.ts`. It polls the bridge server at two different intervals (from `src/bridge/pollConfigDefaults.ts`):

| Condition | Interval |
|-----------|----------|
| Not at capacity (seeking work) | 2,000 ms |
| At capacity (transport connected) | 600,000 ms (10 min) |

The 10-minute at-capacity interval is a liveness signal plus a backstop for permanent connection loss. The transport auto-reconnects internally for 10 minutes on transient WebSocket failures.

### 4.2 WorkSecret

The `WorkSecret` (line 6 of `src/bridge/workSecret.ts`) is a base64url-encoded JSON blob that the bridge server sends to the CLI to authenticate the connection:

```typescript
type WorkSecret = {
  version: 1
  session_ingress_token: string    // JWT for this session
  api_base_url: string             // Where to connect
}
```

The CLI decodes and validates the work secret, then uses `session_ingress_token` as a Bearer token for all bridge API calls.

### 4.3 WebSocket URL Building

The `buildSdkUrl` function (line 41 of `workSecret.ts`) constructs the WebSocket URL:

```typescript
function buildSdkUrl(apiBaseUrl: string, sessionId: string): string {
  const isLocalhost = apiBaseUrl.includes('localhost') || ...
  const version = isLocalhost ? 'v2' : 'v1'
  // Production: Envoy rewrites /v1/ → /v2/ internally
  // Localhost: direct to session-ingress, no rewrite needed
  return `${protocol}://${host}/${version}/session_ingress/ws/${sessionId}`
}
```

### 4.4 Session ID Compatibility

Bridge sessions have tagged IDs of the form `{tag}_{body}` (e.g., `session_abc123`, `cse_abc123`). The CCR v2 compat layer may return different tag prefixes to different API versions. The `sameSessionId` function (line 62 of `workSecret.ts`) compares only the body (the UUID part after the last underscore), allowing the CLI to recognize its own session regardless of tag prefix.

### 4.5 ReplBridgeHandle

The `ReplBridgeHandle` type (line 70 of `replBridge.ts`) is the public interface returned by the bridge setup:

```typescript
type ReplBridgeHandle = {
  bridgeSessionId: string
  environmentId: string
  sessionIngressUrl: string
  writeMessages(messages: Message[]): void
  writeSdkMessages(messages: SDKMessage[]): void
  sendControlRequest(request: SDKControlRequest): void
  sendControlResponse(response: SDKControlResponse): void
  teardown(): Promise<void>
}
```

### 4.6 Permission Proxying

When an IDE plugin is in control, permission requests (tool approvals) are proxied back to the IDE's UI rather than shown in the terminal. The `bridgePermissionCallbacks.ts` module handles translating between Claude Code's internal `PermissionResult` type and the bridge protocol's control messages.

---

## 5. Remote Execution

Remote execution allows Claude Code to connect to a session running in Anthropic's cloud (CCR — Claude Code Remote) and receive its output or control it from a different client.

### 5.1 RemoteSessionManager

`src/remote/RemoteSessionManager.ts` (line 95) is the client-side manager for remote CCR sessions:

```typescript
class RemoteSessionManager {
  private websocket: SessionsWebSocket | null = null
  private pendingPermissionRequests: Map<string, SDKControlPermissionRequest>

  constructor(config: RemoteSessionConfig, callbacks: RemoteSessionCallbacks)
}
```

It coordinates:
1. **WebSocket subscription** — receives `SDKMessage` stream from CCR
2. **HTTP POST** — sends user messages to CCR
3. **Permission request/response** — proxies tool approval dialogs from cloud to local client

### 5.2 Viewer Mode

The `viewerOnly` flag in `RemoteSessionConfig` (line 59) creates a read-only connection. In viewer mode:
- Ctrl+C / Escape do **not** send interrupt signals to the remote agent
- The 60-second reconnect timeout is disabled
- The session title is never updated

This is used by `claude assistant` — a mode for observing an ongoing session.

### 5.3 SessionsWebSocket

`src/remote/SessionsWebSocket.ts` implements the WebSocket client with exponential backoff reconnection. It handles:
- Connection lifecycle (open, message, close, error)
- Reconnection with configurable backoff
- Permission request/response message routing

### 5.4 Remote Task Types

Remote sessions support specialized task types beyond standard chat:

| Type | Description |
|------|-------------|
| `remote-agent` | Standard autonomous agent task |
| `ultraplan` | Extended planning task with longer reasoning |
| `ultrareview` | Code review with structured output |
| `autofix-pr` | Automated PR fix from issue description |

These map to different system prompts and tool configurations on the CCR side.

### 5.5 DirectConnectManager

`src/server/directConnectManager.ts` and `directConnectSessionManager` provide a simpler connection mode that bypasses the bridge server entirely — the client connects directly to a session via WebSocket with an auth token. Used for local development and testing scenarios.

---

## 6. Voice Mode

Voice mode allows users to speak their prompts instead of typing them.

### 6.1 Dual Kill-Switch Design

Voice mode has two independent gate conditions (from `src/voice/voiceModeEnabled.ts`):

```typescript
// Kill-switch 1: GrowthBook feature flag (line 16)
export function isVoiceGrowthBookEnabled(): boolean {
  return feature('VOICE_MODE')
    ? !getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_quartz_disabled', false)
    : false
}

// Kill-switch 2: Auth check (line 32)
export function hasVoiceAuth(): boolean {
  if (!isAnthropicAuthEnabled()) return false
  const tokens = getClaudeAIOAuthTokens()
  return Boolean(tokens?.accessToken)
}

// Both must pass (line 52)
export function isVoiceModeEnabled(): boolean {
  return hasVoiceAuth() && isVoiceGrowthBookEnabled()
}
```

**Kill-switch 1** (`tengu_amber_quartz_disabled`) is a GrowthBook emergency off-switch. When flipped to `true` by Anthropic, voice mode is disabled fleet-wide without a code deployment. The default `false` means fresh installs have voice working immediately without waiting for GrowthBook initialization.

**Kill-switch 2** requires a valid Anthropic OAuth token (`claude.ai` login). Voice mode uses the `voice_stream` endpoint on `claude.ai`, which is not available with:
- API keys
- AWS Bedrock
- Google Vertex AI
- Anthropic Foundry

### 6.2 The `isAnthropicAuthEnabled()` Check

This check verifies the auth *provider* (OAuth vs. API key), not whether a token exists. Without the subsequent token check, the voice UI would render but `connectVoiceStream` would fail silently if the user is logged out (comment at line 39).

### 6.3 Performance Characteristics

The `getClaudeAIOAuthTokens()` call is memoized. The first invocation spawns the macOS `security` keychain process (~20-50ms). Subsequent calls are cache hits. The cache clears on token refresh (roughly once per hour), so one cold keychain read per refresh cycle is expected.

For React render paths where re-renders happen frequently, the code recommends using `useVoiceEnabled()` hook instead of calling `isVoiceModeEnabled()` directly, since the hook memoizes the auth half.

---

## 7. Git Integration

Claude Code reads git state without spawning git subprocesses — it parses the `.git` directory directly. This is faster (no subprocess overhead), safer (no risk of git hooks running), and works without git being installed.

### 7.1 Architecture

The implementation lives in `src/utils/git/gitFilesystem.ts`:

```
resolveGitDir()     — find the actual .git directory (handles worktrees/submodules)
readGitHead()       — parse .git/HEAD → branch name or SHA
resolveRef()        — resolve a ref via loose files, then packed-refs
GitFileWatcher      — caches derived values, invalidates on fs.watchFile events
```

### 7.2 Resolving the `.git` Directory

`resolveGitDir` (line 40) handles three cases:

1. **Regular repo** — `.git` is a directory → return its path
2. **Worktree/submodule** — `.git` is a file containing `gitdir: <path>` → follow the pointer
3. **No git** → return `null`

Results are memoized in `resolveGitDirCache` (line 28).

### 7.3 Parsing HEAD

`readGitHead` (line 149) parses the HEAD file format documented in git source (`refs/files-backend.c`):

```
ref: refs/heads/main\n    →  { type: 'branch', name: 'main' }
ref: refs/heads/feature\n  →  { type: 'branch', name: 'feature' }
a1b2c3d4...(40 hex)\n      →  { type: 'detached', sha: '...' }
```

### 7.4 Security: Ref Name Validation

`isSafeRefName` (line 98) validates branch/ref names read from `.git/` before using them in path joins, git arguments, or shell interpolation:

- Rejects names starting with `-` (argument injection) or `/` (absolute path)
- Rejects `..` (path traversal)
- Allowlist: `[a-zA-Z0-9/._+@-]` only — covers all legitimate branch names while blocking shell metacharacters

This matters because `.git/HEAD` is a plain text file that can be written without git's own validation. An attacker with filesystem write access could craft a malicious branch name.

### 7.5 Packed-Refs Parsing

When a loose ref file doesn't exist, `resolveRef` falls back to `packed-refs` (lines 246–263):

```
# pack-refs with: peeled fully-peeled sorted
a1b2c3d4... refs/heads/main
^d5e6f7a8...    ← peeled tag (skip)
```

Lines starting with `#` (header) or `^` (peeled tag) are skipped. Each remaining line is split at the first space: left is SHA, right is ref name.

### 7.6 GitFileWatcher

`GitFileWatcher` (line 333) is a cache with file-system-watch invalidation:

```
Watched files:
  .git/HEAD              → invalidate all + update branch ref watcher
  .git/config            → invalidate all (remote URL changes)
  .git/refs/heads/<branch> → invalidate branch-specific cache

Watch interval: 1000ms (10ms in tests)
```

Cached values use a dirty flag. When a watched file changes, the dirty flag is set. The next `get()` recomputes the value asynchronously. This design avoids blocking renders on disk reads.

---

## 8. Vim Mode & Keybindings

### 8.1 Vim Mode State Machine

Vim mode (`src/vim/`) implements a state machine for the chat input. The state is defined in `src/vim/types.ts`:

```typescript
type VimState =
  | { mode: 'INSERT'; insertedText: string }
  | { mode: 'NORMAL'; command: CommandState }

type CommandState =
  | { type: 'idle' }
  | { type: 'count'; digits: string }
  | { type: 'operator'; op: Operator; count: number }
  | { type: 'operatorCount'; op: Operator; count: number; digits: string }
  | { type: 'operatorFind'; op: Operator; count: number; find: FindType }
  | { type: 'operatorTextObj'; op: Operator; count: number; scope: TextObjScope }
  | { type: 'find'; find: FindType; count: number }
  | { type: 'g'; count: number }
  | { type: 'replace'; count: number }
  | { type: 'indent'; dir: '>' | '<'; count: number }
```

The state machine is entirely expressed in TypeScript's type system. `switch` statements on `CommandState.type` get exhaustiveness checking — adding a new state without handling it is a compile error.

### 8.2 State Machine Transitions

```
NORMAL mode transitions:
  idle ──[d/c/y]──► operator       (begin an operator)
  idle ──[1-9]────► count          (begin a count)
  idle ──[f/F/t/T]─► find          (find motion)
  idle ──[g]──────► g              (g-prefix commands: gg, gj, gk)
  idle ──[r]──────► replace        (single character replace)
  idle ──[>/< ]───► indent         (indent/dedent)

  operator ──[motion]──► execute   (complete the command)
  operator ──[0-9]────► operatorCount
  operator ──[i/a]────► operatorTextObj
  operator ──[f/F/t/T]─► operatorFind
```

### 8.3 Persistent State (Dot-Repeat)

`PersistentState` (line 81 of types.ts) survives across commands:

```typescript
type PersistentState = {
  lastChange: RecordedChange | null  // for dot-repeat (.)
  lastFind: { type: FindType; char: string } | null  // for ; and ,
  register: string           // unnamed register (yank/delete buffer)
  registerIsLinewise: boolean
}
```

### 8.4 Supported Operators and Text Objects

```
Operators: d (delete), c (change), y (yank)
Motions:   h, l, j, k, w, b, e, W, B, E, 0, ^, $
Find:      f{char}, F{char}, t{char}, T{char}; repeated with ; and ,
TextObjs:  iw, aw, i", a", i', a', i(, a(, i[, a[, i{, a{, i<, a<
G-prefix:  gg (start of buffer), G (end)
Other:     r{char} (replace), >>, << (indent), . (dot repeat)
```

`MAX_VIM_COUNT = 10000` (line 182) prevents runaway repeat counts.

### 8.5 Keybinding System

The keybinding system (`src/keybindings/`) allows customizing every keyboard shortcut in Claude Code.

**Contexts** (from `src/keybindings/schema.ts`, lines 12–32):

```
Global       Chat         Autocomplete    Confirmation
Help         Transcript   HistorySearch   Task
ThemePicker  Settings     Tabs            Attachments
Footer       MessageSelector  DiffDialog  ModelPicker
Select       Plugin
```

**Actions** include (lines 64+):

```
app:interrupt      app:exit           app:toggleTodos
app:toggleTranscript  history:search  history:previous
chat:submit        chat:newline       transcript:scroll
```

### 8.6 Configuration

```json
// ~/.claude/keybindings.json
[
  {
    "context": "Chat",
    "action": "chat:submit",
    "key": "ctrl+enter"
  },
  {
    "context": "Global",
    "action": "app:interrupt",
    "key": "ctrl+c"
  }
]
```

Chords (multi-key sequences) are supported by the parser in `src/keybindings/parser.ts`.

---

## 9. Server Mode

Server mode allows Claude Code to run as a local HTTP server rather than an interactive CLI session. It is used by IDE extensions that want to communicate with Claude Code over a local socket rather than via the bridge (cloud) protocol.

### 9.1 DirectConnect

`src/server/createDirectConnectSession.ts` and `src/server/directConnectManager.ts` implement a local connection mode where:

1. Claude Code starts with `--server` flag and listens on a local port
2. The IDE plugin connects via WebSocket with an auth token
3. Messages flow directly without going through claude.ai

```typescript
// DirectConnectConfig (directConnectManager.ts:13)
type DirectConnectConfig = {
  serverUrl: string
  sessionId: string
  wsUrl: string
  authToken?: string
}
```

### 9.2 Message Protocol

Messages arrive as newline-delimited JSON over the WebSocket (lines 65–79 of `directConnectManager.ts`):

```typescript
ws.addEventListener('message', event => {
  const lines = data.split('\n').filter((l: string) => l.trim())
  for (const line of lines) {
    const raw = jsonParse(line)
    // Route to onMessage or onPermissionRequest callbacks
  }
})
```

The protocol matches the SDK message format — `SDKMessage` for agent output and `SDKControlPermissionRequest` for tool approval dialogs.

---

## 10. Hands-on: Build a Sandbox

See the companion example at `examples/12-advanced-features/sandbox.ts`.

The example demonstrates:
1. A simplified `SimpleSandbox` class with read/write allow/deny lists
2. Path normalization (handling `//`, `/`, `~/` conventions)
3. Violation detection and callbacks
4. Policy composition from multiple sources

### 10.1 Running the Example

```bash
cd /path/to/learn-claude-code
npx ts-node examples/12-advanced-features/sandbox.ts
```

### 10.2 What to Observe

Run the example and notice:
- How `//etc/passwd` resolves to `/etc/passwd` while `/config.json` resolves to the settings-relative path
- How the deny list takes precedence over the allow list
- How violations are buffered and surfaced through callbacks
- How policy from multiple sources (user, project, managed) is merged with the correct precedence

---

## 11. Key Takeaways & Journey Recap

### Chapter 12 Key Takeaways

**Sandbox System:**
- OS-level isolation via `@anthropic-ai/sandbox-runtime` (bwrap on Linux, sandbox-exec on macOS)
- Filesystem allow/deny lists derived from permission rules + explicit config
- Path convention: `//` = absolute, `/` = settings-relative, `~/` = home-relative
- Security-critical: settings files and bare-git-repo attack surfaces are always denied writes
- GrowthBook + auth dual kill-switch pattern for safe feature rollout

**Hook System:**
- 4 hook types: `command`, `prompt`, `agent`, `http`
- 7 sources with priority: policySettings > userSettings > projectSettings > localSettings > pluginHook > sessionHook > builtinHook
- Hook events buffer until a handler registers, preventing lost events
- Prompt hooks use Haiku (fast, cheap) as the evaluation model

**Bridge & IDE Integration:**
- Long-polling at 2s (seeking work) and 10min (connected) intervals
- WorkSecret is a base64url JWT carrying the session ingress token
- Session IDs are tag-prefixed UUIDs; comparison ignores the tag
- ReplBridgeHandle is the clean interface returned to the REPL layer

**Remote Execution:**
- RemoteSessionManager coordinates WebSocket + HTTP for CCR sessions
- Viewer-only mode: read without interrupt capability
- DirectConnect bypasses the bridge for local IDE integration

**Voice Mode:**
- Requires Anthropic OAuth (not API key / Bedrock / Vertex)
- Two independent kill-switches: GrowthBook flag + auth check
- Keychain read is memoized; clears on token refresh (~1/hour)

**Git Integration:**
- Pure filesystem reads — no subprocess, no git hook execution
- Validates branch/ref names from `.git/HEAD` against allowlist to prevent injection
- GitFileWatcher caches with dirty-flag invalidation via `fs.watchFile`

**Vim Mode & Keybindings:**
- Complete vim state machine expressed entirely in TypeScript's type system
- 10 contexts, 18+ keybinding contexts, chord support
- Dot-repeat implemented via `RecordedChange` in persistent state

---

### The Full Journey: 12 Chapters

You have now studied Claude Code's source from multiple angles. Here is a recap of the learning path:

```
Chapter 1   Overview & Architecture
            ↓
Chapter 2   CLI Entrypoint & Startup Sequence
            ↓
Chapter 3   Tool System (File, Bash, Search, MCP)
            ↓
Chapter 4   Command System (/slash commands)
            ↓
Chapter 5   Ink Terminal Rendering (React → terminal)
            ↓
Chapter 6   Service Layer (API, streaming, cost tracking)
            ↓
Chapter 7   Permission System (rules, sandbox, approval UI)
            ↓
Chapter 8   MCP Integration (server management, tool dispatch)
            ↓
Chapter 9   Agent Coordination (sub-agents, swarms, todo)
            ↓
Chapter 10  Plugin & Skill System (auto-discovery, lifecycle)
            ↓
Chapter 11  State & Context Management (sessions, settings)
            ↓
Chapter 12  Advanced Features (sandbox, hooks, bridge, remote, voice, git, vim)
```

Each chapter built on the previous. The tool system depends on the permission system. The permission system depends on the settings/state system. The agent coordinator depends on the tool system and the permission system. The sandbox depends on the settings system and the permission rules. The bridge depends on the session state.

### What to Explore Next

Now that you understand the full architecture, some directions for deeper exploration:

**Contribute to the project:**
The codebase has clear module boundaries enforced by ESLint. Pick a subsystem you understand well and look for issues tagged `good first issue`.

**Build your own tools:**
The MCP protocol is standardized. Build an MCP server that exposes your team's internal APIs as Claude Code tools.

**Build custom hooks:**
The hook system is powerful. A `PreToolUse` hook that validates all shell commands against a company policy, or a `PostToolUse` hook that logs every file edit to an audit trail — these are production-ready capabilities you can implement today.

**Study the permission model:**
`src/utils/permissions/` is the most security-critical part of the codebase. Understanding it deeply will make you a better systems engineer.

**Run with the sandbox enabled:**
Enable `sandbox.enabled: true` in your settings and observe how it changes which operations require explicit approval. Watch the violation events surface in the UI.

**Extend vim mode:**
Vim mode only implements the most common motions. The state machine is easy to extend — add `q@` macro recording, visual mode, or `:` command mode as a learning exercise.

The source code is always the ground truth. When in doubt, read it.

---

*This concludes the Learn Claude Code series. The journey from Chapter 1's architecture overview to Chapter 12's advanced internals has covered one of the most sophisticated production AI agent systems available for study. You now have the mental model to read any part of the codebase with confidence.*
