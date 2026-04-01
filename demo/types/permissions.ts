/**
 * types/permissions.ts - 权限类型定义
 *
 * 对应真实 Claude Code: src/types/permissions.ts
 *
 * Claude Code 的权限系统确保 AI 不会未经用户同意执行危险操作。
 * 每次工具调用前，都会经过权限检查。
 *
 * 权限模式决定了检查的严格程度：
 * - default: 危险操作需要用户确认
 * - auto: 读操作自动放行，写操作仍需确认
 * - bypassPermissions: 跳过所有检查（仅限开发调试）
 *
 * 本文件定义权限相关的类型，具体实现在第 7 章完成。
 */

// ─── 权限模式 ───────────────────────────────────────────────────────────────

/**
 * 权限模式
 *
 * 真实 Claude Code 有更多模式（plan、bubble、coordinator_auto 等），
 * 我们先定义三种核心模式
 */
export type PermissionMode = "default" | "auto" | "bypassPermissions";

// ─── 权限决策 ───────────────────────────────────────────────────────────────

/**
 * 权限行为
 *
 * allow: 允许执行
 * deny: 拒绝执行
 * ask: 需要询问用户
 */
export type PermissionBehavior = "allow" | "deny" | "ask";

/**
 * 权限允许决策
 */
export interface PermissionAllowDecision {
  behavior: "allow";
  /** 可选：经用户修改后的输入参数 */
  updatedInput?: Record<string, unknown>;
}

/**
 * 权限拒绝决策
 */
export interface PermissionDenyDecision {
  behavior: "deny";
  /** 拒绝原因，会反馈给 AI */
  message: string;
}

/**
 * 权限询问决策 - 需要用户交互确认
 */
export interface PermissionAskDecision {
  behavior: "ask";
  /** 显示给用户的确认信息 */
  message: string;
}

/**
 * 权限决策联合类型
 */
export type PermissionDecision =
  | PermissionAllowDecision
  | PermissionDenyDecision
  | PermissionAskDecision;

// ─── 权限规则 ───────────────────────────────────────────────────────────────

/**
 * 权限规则来源
 *
 * 真实 Claude Code 中，权限规则可以来自多个来源，
 * source 字段用于溯源和优先级判断
 */
export type PermissionRuleSource = "userSettings" | "projectSettings" | "session" | "default";

/**
 * 权限规则 - 预定义的权限判断规则
 *
 * 例如：
 * - FileRead 工具 → 总是允许（只读操作无风险）
 * - Bash 工具 + "rm -rf" → 总是拒绝
 * - FileWrite 工具 → 默认询问用户
 */
export interface PermissionRule {
  /** 工具名称，"*" 表示匹配所有工具 */
  toolName: string;
  /** 匹配条件（可选），用于更精细的规则，如匹配命令内容 */
  pattern?: string;
  /** 匹配时的行为 */
  behavior: PermissionBehavior;
  /** 规则说明 */
  reason?: string;
  /** 规则来源，用于溯源和优先级判断 */
  source?: PermissionRuleSource;
}

// ─── 权限上下文 ──────────────────────────────────────────────────────────────

/**
 * 权限上下文 - 传递给权限检查器的环境信息
 *
 * 真实 Claude Code 的 ToolPermissionContext 更复杂，
 * 包含 additionalWorkingDirectories、分类器配置等
 */
export interface PermissionContext {
  /** 当前权限模式 */
  mode: PermissionMode;
  /** 工作目录 */
  cwd: string;
  /** 预定义的权限规则 */
  rules: PermissionRule[];
}

/**
 * 权限检查函数类型
 *
 * 在真实 Claude Code 中，这个函数叫 canUseTool，
 * 作为参数传递给每个 Tool 的 call() 方法
 */
export type CheckPermissionFn = (
  toolName: string,
  input: Record<string, unknown>
) => Promise<PermissionDecision>;
