# 第 12 章：高级特性

> **难度：** 高级 | **阅读时间：** 约 90 分钟

---

## 目录

1. [引言：高级层的全景](#1-引言高级层的全景)
2. [沙箱系统](#2-沙箱系统)
3. [钩子系统](#3-钩子系统)
4. [桥接与 IDE 集成](#4-桥接与-ide-集成)
5. [远程执行](#5-远程执行)
6. [语音模式](#6-语音模式)
7. [Git 集成](#7-git-集成)
8. [Vim 模式与快捷键](#8-vim-模式与快捷键)
9. [服务器模式](#9-服务器模式)
10. [动手实践：构建沙箱](#10-动手实践构建沙箱)
11. [关键总结与全书回顾](#11-关键总结与全书回顾)

---

## 1. 引言：高级层的全景

你来到了第 12 章。此时你已经理解了 Claude Code 的 CLI 入口点、工具系统、权限模型、MCP 集成、代理协调、插件/技能架构以及状态管理。本章最后的内容涵盖了位于边缘的系统——这些机制要么保护核心（沙箱），要么将其扩展到新环境（桥接、远程、语音），要么为高级用户提供细粒度控制（钩子、Vim 模式、快捷键）。

这些系统共享一种设计哲学：**按需启用，安全默认**。它们默认都是关闭的。每一个都需要用户或部署管理员显式启用，并且在依赖项不可用时具有安全失败行为。

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Claude Code 核心                                │
│               (CLI、工具、权限、MCP)                                 │
├─────────────┬───────────────┬────────────────┬───────────────────── ┤
│    沙箱     │     钩子      │  桥接/远程     │  语音/Vim/快捷键    │
│  (隔离)     │  (自动化)     │  (IDE/云)      │  (输入体验)         │
└─────────────┴───────────────┴────────────────┴─────────────────────-┘
```

---

## 2. 沙箱系统

沙箱是 Claude Code 的操作系统级隔离层。启用后，每次 `Bash` 工具调用都在一个限制了文件系统访问、网络连接和进程能力的受限环境中运行。

### 2.1 架构

沙箱由 `@anthropic-ai/sandbox-runtime` 包实现，由 Claude Code 的适配器 `src/utils/sandbox/sandbox-adapter.ts` 包装。

```
Claude Code (src/utils/sandbox/sandbox-adapter.ts)
      │
      ▼
SandboxManager（来自 @anthropic-ai/sandbox-runtime）
      │
      ├── FsReadRestrictionConfig    ─► bwrap / sandbox-exec 挂载点
      ├── FsWriteRestrictionConfig   ─► 只读绑定 vs. 可写绑定
      ├── NetworkRestrictionConfig   ─► HTTP 代理拦截
      └── SandboxViolationStore      ─► 违规事件回调
```

导出的 `SandboxManager`（`sandbox-adapter.ts` 第 19 行）是一个单例，用 Claude Code 的逻辑包装了运行时包中的 `BaseSandboxManager`，增加了：

- **设置集成** — 读取 `~/.claude/settings.json` 和 `.claude/settings.json`
- **权限规则映射** — 将 `Edit(path)` 和 `Read(path)` 规则转换为文件系统允许/拒绝列表
- **路径约定解析** — 翻译 Claude Code 的 `//path`、`/path`、`~/path` 约定
- **安全加固** — 对设置文件和裸 git 仓库攻击面额外拒绝写入

### 2.2 文件系统限制

沙箱为每个方向（读/写）构建两个列表：允许和拒绝。

```typescript
// 来自 sandbox-adapter.ts 第 225-235 行
const allowWrite: string[] = ['.', getClaudeTempDir()]
const denyWrite: string[] = []
const denyRead: string[] = []
const allowRead: string[] = []

// 始终拒绝向设置文件写入，防止沙箱逃逸
const settingsPaths = SETTING_SOURCES.map(source =>
  getSettingsFilePathForSource(source),
).filter((p): p is string => p !== undefined)
denyWrite.push(...settingsPaths)
```

当前工作目录（`.`）始终可写。Claude 临时目录始终可写（Shell.ts CWD 跟踪文件所需）。设置文件始终只读——这防止了恶意提示指示 Claude 将钩子写入 `settings.json` 以在下次会话中执行。

**权限规则映射**（第 308-327 行）：

```typescript
// Edit(path) 规则 → allowWrite 或 denyWrite
if (rule.toolName === FILE_EDIT_TOOL_NAME && rule.ruleContent) {
  allowWrite.push(resolvePathPatternForSandbox(rule.ruleContent, source))
}

// Read(path) 拒绝规则 → denyRead
if (rule.toolName === FILE_READ_TOOL_NAME && rule.ruleContent) {
  denyRead.push(resolvePathPatternForSandbox(rule.ruleContent, source))
}
```

### 2.3 路径解析约定

Claude Code 在权限规则中使用三种路径约定，各有不同语义（第 84-119 行）：

| 前缀 | 示例 | 解析为 |
|------|------|--------|
| `//` | `//etc/passwd` | `/etc/passwd`（从根绝对路径） |
| `/` | `/config/*.json` | `$SETTINGS_DIR/config/*.json`（相对于设置文件目录） |
| `~/` | `~/.ssh/**` | `/home/user/.ssh/**`（相对于主目录，由 sandbox-runtime 处理） |
| `./` 或裸路径 | `src/**` | `$CWD/src/**`（相对于当前工作目录） |

`//` 约定的存在是因为 `/` 本身表示"相对于设置文件目录"——对于项目范围的规则很有用。如果你想在规则中使用绝对路径，必须用 `//` 转义。

然而，在 `sandbox.filesystem.*` 设置中（与权限规则不同），`/path` 表示字面绝对路径。这个区别是 bug #30067 的根本原因，在 `resolveSandboxFilesystemPath`（第 138 行）中修复。

```
resolvePathPatternForSandbox  →  用于权限规则    (/ = 相对于设置)
resolveSandboxFilesystemPath  →  用于 sandbox.filesystem.*  (/ = 绝对路径)
```

### 2.4 网络限制

网络限制通过透明 HTTP 代理实现。沙箱进程的所有出站 HTTP/HTTPS 都通过该代理路由，代理强制执行允许列表和拒绝列表。

允许的域名来自两个来源：

1. `WebFetch(domain:example.com)` 权限规则
2. 设置中的 `sandbox.network.allowedDomains`

当 `policySettings`（企业部署）中设置了 `allowManagedDomainsOnly: true` 时，只有管理员控制的域名生效——用户设置被忽略（第 182-196 行）。

Unix socket 访问默认关闭，需要显式启用：
```json
{
  "sandbox": {
    "network": {
      "allowUnixSockets": true
    }
  }
}
```

### 2.5 违规事件回调

来自 `@anthropic-ai/sandbox-runtime` 的 `SandboxViolationStore` 收集违规事件：当沙箱进程尝试访问被拒绝的路径或网络端点时。这些事件作为警告向上传播到 UI。

```typescript
export type SandboxViolationEvent = {
  type: 'fs_read' | 'fs_write' | 'network'
  path?: string         // 文件系统违规时
  domain?: string       // 网络违规时
  process?: string      // 哪个进程触发了违规
}
```

### 2.6 安全加固：裸 Git 仓库攻击

第 257-280 行实现了一种针对微妙攻击的防御：能够在当前工作目录中写入文件的攻击者可以创建一个假的 git 仓库（`HEAD` + `objects/` + `refs/`），其中 `core.fsmonitor` 钩子指向恶意脚本。当 Claude 的非沙箱 `git` 命令下次运行时，会执行该脚本。

防御措施：
1. 如果裸仓库文件已存在，将其加入 `denyWrite`（沙箱以只读方式挂载它们）
2. 如果文件还不存在，将其路径加入 `bareGitRepoScrubPaths`
3. 每次沙箱命令后，`scrubBareGitRepoFiles()` 删除任何新创建的裸仓库文件，在 Claude 的 git 运行之前完成（第 404 行）

### 2.7 启用沙箱

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

`autoAllowBashIfSandboxed: true`（默认值）意味着启用沙箱时，通常需要显式权限的 Bash 命令会被自动批准——因为沙箱本身提供了操作系统级的执行保障。

`failIfUnavailable: false`（默认值）意味着如果依赖项缺失，Claude Code 以非沙箱模式运行，而不是拒绝启动。

平台支持：macOS（sandbox-exec）、Linux（bwrap）、WSL2+。不支持 WSL1。

---

## 3. 钩子系统

钩子允许你拦截 Claude Code 的生命周期事件，并在特定时间点运行自定义逻辑——Shell 命令、LLM 提示或 HTTP 请求。

### 3.1 钩子类型

共有四种钩子类型，定义在 `src/utils/settings/types.ts`：

| 类型 | 执行方式 | 用途 |
|------|----------|------|
| `command` | Shell 子进程 | 运行脚本、代码检查、格式化工具 |
| `prompt` | LLM 调用（默认 Haiku） | 语义验证、AI 驱动的门控 |
| `agent` | Claude Code 子代理 | 复杂的多步自动化 |
| `http` | HTTP POST 请求 | Webhook、外部服务 |

### 3.2 钩子事件

钩子在以下事件触发（来自 `src/entrypoints/agentSdkTypes.ts`）：

```
PreToolUse        — 任何工具调用执行之前
PostToolUse       — 工具调用完成之后
UserPromptSubmit  — 用户发送消息时
AssistantResponse — Claude 生成响应时
SessionStart      — 会话初始化时（一次）
Setup             — 配置/启动阶段
Stop              — 会话结束时
```

### 3.3 钩子来源与优先级

钩子来自 7 个来源，按以下优先级顺序迭代（来自 `src/utils/hooks/hooksSettings.ts`）：

```typescript
// 第 102-107 行
const sources = [
  'userSettings',    // ~/.claude/settings.json
  'projectSettings', // .claude/settings.json
  'localSettings',   // .claude/settings.local.json
] as EditableSettingSource[]

// 另外还有：
// 'policySettings'  — 托管/企业设置（仅管理员）
// 'pluginHook'      — ~/.claude/plugins/*/hooks/hooks.json
// 'sessionHook'     — 通过 SDK 注册的内存中钩子
// 'builtinHook'     — Claude Code 内部注册
```

当策略设置中设置了 `allowManagedHooksOnly: true` 时，只有 `policySettings` 钩子运行。所有用户/项目/插件钩子都被抑制。

### 3.4 钩子配置

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
            "command": "echo '即将运行 bash' | logger"
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
            "prompt": "工具调用 $ARGUMENTS 是否在项目外没有产生副作用？如果是，返回 {\"ok\": true}。"
          }
        ]
      }
    ]
  }
}
```

`matcher` 是与工具名称匹配的正则表达式。

### 3.5 提示钩子

提示钩子使用 LLM（默认 Haiku）来评估钩子条件是否满足。`execPromptHook` 函数（`src/utils/hooks/execPromptHook.ts` 第 21 行）用钩子的 JSON 输入替换提示中的 `$ARGUMENTS` 并查询模型。

模型被指示返回 `{"ok": true}` 或 `{"ok": false, "reason": "..."}` 中的一种。`false` 响应会阻止操作并将原因显示给用户。

提示钩子默认超时为 30 秒（第 55 行）。

### 3.6 HTTP 钩子

HTTP 钩子向外部 URL 发送 POST 请求。启用沙箱时，它们通过沙箱网络代理流式传输——代理执行与 Bash 命令相同的域名允许列表（`execHttpHook.ts` 第 21-41 行）。

通过设置中的 `allowedHttpHookUrls` 可以限制钩子能访问的端点。

### 3.7 钩子事件系统

钩子事件系统（`src/utils/hooks/hookEvents.ts`）允许 SDK 消费者实时观察钩子执行：

```typescript
// 三种事件类型
type HookStartedEvent  = { type: 'started'; hookId; hookName; hookEvent }
type HookProgressEvent = { type: 'progress'; hookId; ...; stdout; stderr; output }
type HookResponseEvent = { type: 'response'; hookId; ...; exitCode; outcome }
```

事件在 `pendingEvents` 中缓冲（最多 100 个），直到注册了处理器后立即刷新（第 61-70 行）。这防止了钩子执行和 SDK 消费者注册之间的竞争条件。

无论 `includeHookEvents` 设置如何，两个事件始终发送：`SessionStart` 和 `Setup`（第 18 行）。

---

## 4. 桥接与 IDE 集成

桥接是 Claude Code 与 IDE（VS Code、JetBrains）和 claude.ai Web UI 集成的机制。它在 CLI 进程和远程环境之间建立双向通道。

### 4.1 长轮询架构

```
┌──────────────┐          ┌──────────────────┐          ┌───────────┐
│   IDE 插件   │          │   桥接服务器     │          │  Claude   │
│  (VS Code /  │◄────────►│  (claude.ai)     │◄────────►│   CLI     │
│  JetBrains)  │  HTTP WS │                  │  HTTP WS │  进程     │
└──────────────┘          └──────────────────┘          └───────────┘
                                   │
                            WorkSecret JWT
                         (base64url 编码)
```

CLI 端在 `src/bridge/replBridge.ts` 中实现。它以两种不同的间隔轮询桥接服务器（来自 `src/bridge/pollConfigDefaults.ts`）：

| 状态 | 间隔 |
|------|------|
| 未满载（寻找工作） | 2,000 毫秒 |
| 满载（传输已连接） | 600,000 毫秒（10 分钟） |

10 分钟满载间隔是一个活跃信号以及永久连接丢失的保底措施。传输在瞬时 WebSocket 故障时内部自动重连 10 分钟。

### 4.2 WorkSecret

`WorkSecret`（`src/bridge/workSecret.ts` 第 6 行）是桥接服务器发送给 CLI 以验证连接的 base64url 编码 JSON blob：

```typescript
type WorkSecret = {
  version: 1
  session_ingress_token: string    // 本次会话的 JWT
  api_base_url: string             // 连接地址
}
```

CLI 解码并验证工作密钥，然后使用 `session_ingress_token` 作为所有桥接 API 调用的 Bearer token。

### 4.3 WebSocket URL 构建

`buildSdkUrl` 函数（`workSecret.ts` 第 41 行）构建 WebSocket URL：

```typescript
function buildSdkUrl(apiBaseUrl: string, sessionId: string): string {
  const isLocalhost = apiBaseUrl.includes('localhost') || ...
  const version = isLocalhost ? 'v2' : 'v1'
  // 生产环境：Envoy 在内部将 /v1/ 重写为 /v2/
  // 本地：直连 session-ingress，无需重写
  return `${protocol}://${host}/${version}/session_ingress/ws/${sessionId}`
}
```

### 4.4 会话 ID 兼容性

桥接会话具有 `{tag}_{body}` 形式的标记 ID（例如 `session_abc123`、`cse_abc123`）。CCR v2 兼容层可能向不同 API 版本返回不同标记前缀。`sameSessionId` 函数（`workSecret.ts` 第 62 行）只比较 body 部分（最后一个下划线后的 UUID），允许 CLI 无论标记前缀如何都能识别自己的会话。

### 4.5 ReplBridgeHandle

`ReplBridgeHandle` 类型（`replBridge.ts` 第 70 行）是桥接设置返回的公共接口：

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

### 4.6 权限代理

当 IDE 插件处于控制状态时，权限请求（工具批准）被代理回 IDE 的 UI，而不是显示在终端中。`bridgePermissionCallbacks.ts` 模块处理 Claude Code 内部 `PermissionResult` 类型和桥接协议控制消息之间的转换。

---

## 5. 远程执行

远程执行允许 Claude Code 连接到在 Anthropic 云端（CCR — Claude Code Remote）运行的会话，并从不同客户端接收其输出或控制它。

### 5.1 RemoteSessionManager

`src/remote/RemoteSessionManager.ts`（第 95 行）是远程 CCR 会话的客户端管理器：

```typescript
class RemoteSessionManager {
  private websocket: SessionsWebSocket | null = null
  private pendingPermissionRequests: Map<string, SDKControlPermissionRequest>

  constructor(config: RemoteSessionConfig, callbacks: RemoteSessionCallbacks)
}
```

它协调：
1. **WebSocket 订阅** — 从 CCR 接收 `SDKMessage` 流
2. **HTTP POST** — 向 CCR 发送用户消息
3. **权限请求/响应** — 将工具批准对话框从云端代理到本地客户端

### 5.2 只读模式

`RemoteSessionConfig`（第 59 行）中的 `viewerOnly` 标志创建只读连接。只读模式下：
- Ctrl+C / Escape **不**向远程代理发送中断信号
- 60 秒重连超时被禁用
- 会话标题永不更新

这用于 `claude assistant`——一种观察正在进行的会话的模式。

### 5.3 SessionsWebSocket

`src/remote/SessionsWebSocket.ts` 实现了带指数退避重连的 WebSocket 客户端。它处理：
- 连接生命周期（打开、消息、关闭、错误）
- 可配置退避的重连
- 权限请求/响应消息路由

### 5.4 远程任务类型

远程会话支持标准聊天之外的特殊任务类型：

| 类型 | 描述 |
|------|------|
| `remote-agent` | 标准自主代理任务 |
| `ultraplan` | 带较长推理的扩展规划任务 |
| `ultrareview` | 带结构化输出的代码审查 |
| `autofix-pr` | 根据问题描述自动修复 PR |

这些在 CCR 端映射到不同的系统提示和工具配置。

### 5.5 DirectConnectManager

`src/server/directConnectManager.ts` 和 `DirectConnectSessionManager` 提供了一种更简单的连接模式，完全绕过桥接服务器——客户端通过带认证令牌的 WebSocket 直接连接到会话。用于本地开发和测试场景。

---

## 6. 语音模式

语音模式允许用户说出提示而不是打字。

### 6.1 双重终止开关设计

语音模式有两个独立的门控条件（来自 `src/voice/voiceModeEnabled.ts`）：

```typescript
// 终止开关 1：GrowthBook 功能标志（第 16 行）
export function isVoiceGrowthBookEnabled(): boolean {
  return feature('VOICE_MODE')
    ? !getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_quartz_disabled', false)
    : false
}

// 终止开关 2：认证检查（第 32 行）
export function hasVoiceAuth(): boolean {
  if (!isAnthropicAuthEnabled()) return false
  const tokens = getClaudeAIOAuthTokens()
  return Boolean(tokens?.accessToken)
}

// 两者都必须通过（第 52 行）
export function isVoiceModeEnabled(): boolean {
  return hasVoiceAuth() && isVoiceGrowthBookEnabled()
}
```

**终止开关 1**（`tengu_amber_quartz_disabled`）是 GrowthBook 紧急关闭开关。当 Anthropic 将其翻转为 `true` 时，无需代码部署即可在整个集群范围内禁用语音模式。默认的 `false` 意味着全新安装无需等待 GrowthBook 初始化即可立即使用语音。

**终止开关 2** 需要有效的 Anthropic OAuth 令牌（`claude.ai` 登录）。语音模式使用 `claude.ai` 上的 `voice_stream` 端点，该端点不适用于：
- API 密钥
- AWS Bedrock
- Google Vertex AI
- Anthropic Foundry

### 6.2 `isAnthropicAuthEnabled()` 检查

此检查验证认证*提供者*（OAuth 还是 API 密钥），而不是令牌是否存在。如果没有后续的令牌检查，当用户未登录时，语音 UI 会渲染但 `connectVoiceStream` 会静默失败（第 39 行注释）。

### 6.3 性能特性

`getClaudeAIOAuthTokens()` 调用已记忆化。第一次调用会在 macOS 上生成 `security` 钥匙串进程（约 20-50ms）。后续调用都是缓存命中。缓存在令牌刷新时清除（大约每小时一次），因此每个刷新周期预期有一次冷钥匙串读取。

对于重渲染频繁的 React 渲染路径，代码建议使用 `useVoiceEnabled()` 钩子而不是直接调用 `isVoiceModeEnabled()`，因为该钩子会记忆化认证部分。

---

## 7. Git 集成

Claude Code 无需生成 git 子进程即可读取 git 状态——它直接解析 `.git` 目录。这更快（无子进程开销）、更安全（git 钩子不会运行的风险）并且无需安装 git 即可工作。

### 7.1 架构

实现位于 `src/utils/git/gitFilesystem.ts`：

```
resolveGitDir()     — 找到实际的 .git 目录（处理工作树/子模块）
readGitHead()       — 解析 .git/HEAD → 分支名称或 SHA
resolveRef()        — 通过松散文件，然后通过 packed-refs 解析引用
GitFileWatcher      — 缓存衍生值，在 fs.watchFile 事件时失效
```

### 7.2 解析 `.git` 目录

`resolveGitDir`（第 40 行）处理三种情况：

1. **常规仓库** — `.git` 是一个目录 → 返回其路径
2. **工作树/子模块** — `.git` 是包含 `gitdir: <path>` 的文件 → 跟随指针
3. **无 git** → 返回 `null`

结果在 `resolveGitDirCache`（第 28 行）中记忆化。

### 7.3 解析 HEAD

`readGitHead`（第 149 行）解析 git 源码（`refs/files-backend.c`）中记录的 HEAD 文件格式：

```
ref: refs/heads/main\n    →  { type: 'branch', name: 'main' }
ref: refs/heads/feature\n  →  { type: 'branch', name: 'feature' }
a1b2c3d4...(40 十六进制)\n  →  { type: 'detached', sha: '...' }
```

### 7.4 安全：引用名称验证

`isSafeRefName`（第 98 行）在从 `.git/` 读取的分支/引用名称用于路径拼接、git 参数或 Shell 插值之前对其进行验证：

- 拒绝以 `-` 开头的名称（参数注入）或以 `/` 开头的名称（绝对路径）
- 拒绝 `..`（路径遍历）
- 白名单：仅 `[a-zA-Z0-9/._+@-]`——涵盖所有合法分支名称，同时阻止 Shell 元字符

这很重要，因为 `.git/HEAD` 是一个纯文本文件，可以在没有 git 自己的验证的情况下写入。具有文件系统写入权限的攻击者可以制作恶意分支名称。

### 7.5 Packed-Refs 解析

当松散引用文件不存在时，`resolveRef` 回退到 `packed-refs`（第 246-263 行）：

```
# pack-refs with: peeled fully-peeled sorted
a1b2c3d4... refs/heads/main
^d5e6f7a8...    ← 剥离的标签（跳过）
```

以 `#`（头部）或 `^`（剥离标签）开头的行被跳过。每个剩余行在第一个空格处分割：左边是 SHA，右边是引用名称。

### 7.6 GitFileWatcher

`GitFileWatcher`（第 333 行）是一个带文件系统监视失效的缓存：

```
监视的文件：
  .git/HEAD              → 失效全部 + 更新分支引用监视器
  .git/config            → 失效全部（远程 URL 变化）
  .git/refs/heads/<branch> → 失效特定分支的缓存

监视间隔：1000ms（测试中为 10ms）
```

缓存值使用脏标志。当监视的文件变化时，设置脏标志。下一次 `get()` 异步重新计算值。这种设计避免了在磁盘读取上阻塞渲染。

---

## 8. Vim 模式与快捷键

### 8.1 Vim 模式状态机

Vim 模式（`src/vim/`）为聊天输入实现了一个状态机。状态定义在 `src/vim/types.ts`：

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

状态机完全用 TypeScript 的类型系统表达。对 `CommandState.type` 的 `switch` 语句获得穷举检查——添加新状态而不处理它是编译错误。

### 8.2 状态机转换

```
NORMAL 模式转换：
  idle ──[d/c/y]──► operator       （开始一个操作符）
  idle ──[1-9]────► count          （开始一个计数）
  idle ──[f/F/t/T]─► find          （查找移动）
  idle ──[g]──────► g              （g 前缀命令：gg、gj、gk）
  idle ──[r]──────► replace        （单字符替换）
  idle ──[>/< ]───► indent         （缩进/反缩进）

  operator ──[motion]──► execute   （完成命令）
  operator ──[0-9]────► operatorCount
  operator ──[i/a]────► operatorTextObj
  operator ──[f/F/t/T]─► operatorFind
```

### 8.3 持久状态（点重复）

`PersistentState`（types.ts 第 81 行）在命令之间存活：

```typescript
type PersistentState = {
  lastChange: RecordedChange | null  // 用于点重复（.）
  lastFind: { type: FindType; char: string } | null  // 用于 ; 和 ,
  register: string           // 未命名寄存器（复制/删除缓冲区）
  registerIsLinewise: boolean
}
```

### 8.4 支持的操作符和文本对象

```
操作符：d（删除）、c（修改）、y（复制）
移动：h、l、j、k、w、b、e、W、B、E、0、^、$
查找：f{char}、F{char}、t{char}、T{char}；用 ; 和 , 重复
文本对象：iw、aw、i"、a"、i'、a'、i(、a(、i[、a[、i{、a{、i<、a<
G 前缀：gg（缓冲区开始）、G（结束）
其他：r{char}（替换）、>>、<<（缩进）、.（点重复）
```

`MAX_VIM_COUNT = 10000`（第 182 行）防止失控的重复计数。

### 8.5 快捷键系统

快捷键系统（`src/keybindings/`）允许自定义 Claude Code 中的每个键盘快捷键。

**上下文**（来自 `src/keybindings/schema.ts` 第 12-32 行）：

```
Global       Chat         Autocomplete    Confirmation
Help         Transcript   HistorySearch   Task
ThemePicker  Settings     Tabs            Attachments
Footer       MessageSelector  DiffDialog  ModelPicker
Select       Plugin
```

**动作**包括（第 64 行+）：

```
app:interrupt      app:exit           app:toggleTodos
app:toggleTranscript  history:search  history:previous
chat:submit        chat:newline       transcript:scroll
```

### 8.6 配置

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

`src/keybindings/parser.ts` 中的解析器支持和弦（多键序列）。

---

## 9. 服务器模式

服务器模式允许 Claude Code 作为本地 HTTP 服务器运行，而不是交互式 CLI 会话。它由希望通过本地套接字（而不是通过桥接/云端协议）与 Claude Code 通信的 IDE 扩展使用。

### 9.1 DirectConnect

`src/server/createDirectConnectSession.ts` 和 `src/server/directConnectManager.ts` 实现了一种本地连接模式，其中：

1. Claude Code 以 `--server` 标志启动并在本地端口监听
2. IDE 插件通过带认证令牌的 WebSocket 连接
3. 消息直接流动，不经过 claude.ai

```typescript
// DirectConnectConfig (directConnectManager.ts:13)
type DirectConnectConfig = {
  serverUrl: string
  sessionId: string
  wsUrl: string
  authToken?: string
}
```

### 9.2 消息协议

消息通过 WebSocket 以换行符分隔的 JSON 到达（`directConnectManager.ts` 第 65-79 行）：

```typescript
ws.addEventListener('message', event => {
  const lines = data.split('\n').filter((l: string) => l.trim())
  for (const line of lines) {
    const raw = jsonParse(line)
    // 路由到 onMessage 或 onPermissionRequest 回调
  }
})
```

协议与 SDK 消息格式匹配——代理输出用 `SDKMessage`，工具批准对话框用 `SDKControlPermissionRequest`。

---

## 10. 动手实践：构建沙箱

请参见配套示例 `examples/12-advanced-features/sandbox.ts`。

该示例演示了：
1. 带读/写允许/拒绝列表的简化 `SimpleSandbox` 类
2. 路径规范化（处理 `//`、`/`、`~/` 约定）
3. 违规检测和回调
4. 来自多个来源的策略组合

### 10.1 运行示例

```bash
cd /path/to/learn-claude-code
npx ts-node examples/12-advanced-features/sandbox.ts
```

### 10.2 观察要点

运行示例，注意：
- `//etc/passwd` 如何解析为 `/etc/passwd`，而 `/config.json` 如何解析为相对于设置的路径
- 拒绝列表如何优先于允许列表
- 违规如何被缓冲并通过回调显示
- 来自多个来源（用户、项目、托管）的策略如何以正确的优先级合并

---

## 11. 关键总结与全书回顾

### 第 12 章关键要点

**沙箱系统：**
- 通过 `@anthropic-ai/sandbox-runtime` 实现操作系统级隔离（Linux 上的 bwrap，macOS 上的 sandbox-exec）
- 从权限规则和显式配置派生的文件系统允许/拒绝列表
- 路径约定：`//` = 绝对路径，`/` = 相对于设置，`~/` = 相对于主目录
- 安全关键：设置文件和裸 git 仓库攻击面始终拒绝写入
- GrowthBook + 认证双重终止开关模式用于安全功能发布

**钩子系统：**
- 4 种钩子类型：`command`、`prompt`、`agent`、`http`
- 7 个来源带优先级：policySettings > userSettings > projectSettings > localSettings > pluginHook > sessionHook > builtinHook
- 钩子事件在处理器注册前缓冲，防止事件丢失
- 提示钩子使用 Haiku（快速、廉价）作为评估模型

**桥接与 IDE 集成：**
- 2 秒（寻找工作）和 10 分钟（已连接）两种轮询间隔
- WorkSecret 是承载会话入口令牌的 base64url JWT
- 会话 ID 是带标记前缀的 UUID；比较时忽略标记
- ReplBridgeHandle 是返回给 REPL 层的干净接口

**远程执行：**
- RemoteSessionManager 协调 CCR 会话的 WebSocket + HTTP
- 只读模式：无中断能力的读取
- DirectConnect 绕过桥接用于本地 IDE 集成

**语音模式：**
- 需要 Anthropic OAuth（不支持 API 密钥/Bedrock/Vertex）
- 两个独立的终止开关：GrowthBook 标志 + 认证检查
- 钥匙串读取已记忆化；在令牌刷新时清除（约每小时一次）

**Git 集成：**
- 纯文件系统读取——无子进程，无 git 钩子执行
- 在路径拼接、git 参数或 Shell 插值中使用前，对 `.git/HEAD` 中的分支/引用名称进行白名单验证以防止注入
- GitFileWatcher 通过 `fs.watchFile` 缓存带脏标志失效

**Vim 模式与快捷键：**
- 完整的 Vim 状态机完全用 TypeScript 的类型系统表达
- 10 种上下文，18+ 个快捷键上下文，支持和弦
- 通过 `RecordedChange` 在持久状态中实现点重复

---

### 完整旅程：12 章回顾

你现在从多个角度研究了 Claude Code 的源代码。以下是学习路径的回顾：

```
第 1 章   概述与架构
          ↓
第 2 章   CLI 入口点与启动序列
          ↓
第 3 章   工具系统（文件、Bash、搜索、MCP）
          ↓
第 4 章   命令系统（/斜杠命令）
          ↓
第 5 章   Ink 终端渲染（React → 终端）
          ↓
第 6 章   服务层（API、流式传输、成本追踪）
          ↓
第 7 章   权限系统（规则、沙箱、批准 UI）
          ↓
第 8 章   MCP 集成（服务器管理、工具分发）
          ↓
第 9 章   代理协调（子代理、集群、待办事项）
          ↓
第 10 章  插件与技能系统（自动发现、生命周期）
          ↓
第 11 章  状态与上下文管理（会话、设置）
          ↓
第 12 章  高级特性（沙箱、钩子、桥接、远程、语音、git、Vim）
```

每章都建立在前一章的基础上。工具系统依赖权限系统。权限系统依赖设置/状态系统。代理协调器依赖工具系统和权限系统。沙箱依赖设置系统和权限规则。桥接依赖会话状态。

### 接下来探索什么

现在你已理解了完整架构，可以向以下方向深入探索：

**为项目做贡献：**
代码库有 ESLint 强制执行的清晰模块边界。选择一个你深刻理解的子系统，寻找标记为 `good first issue` 的问题。

**构建自己的工具：**
MCP 协议是标准化的。构建一个将团队内部 API 暴露为 Claude Code 工具的 MCP 服务器。

**构建自定义钩子：**
钩子系统很强大。一个根据公司策略验证所有 Shell 命令的 `PreToolUse` 钩子，或一个将每次文件编辑记录到审计跟踪的 `PostToolUse` 钩子——这些都是你今天就可以实现的生产级功能。

**研究权限模型：**
`src/utils/permissions/` 是代码库中最安全关键的部分。深入理解它将使你成为更好的系统工程师。

**启用沙箱运行：**
在设置中启用 `sandbox.enabled: true`，观察它如何改变哪些操作需要显式批准。观察违规事件在 UI 中显示。

**扩展 Vim 模式：**
Vim 模式只实现了最常见的移动。状态机易于扩展——添加 `q@` 宏录制、可视模式或 `:` 命令模式作为学习练习。

源代码永远是最终的权威。有疑问时，直接阅读它。

---

*本章结束了《学习 Claude Code》系列。从第 1 章的架构概述到第 12 章的高级内部机制的旅程，覆盖了现有最复杂的生产 AI 代理系统之一。你现在拥有了自信阅读代码库任何部分的心理模型。继续探索，继续构建。*
