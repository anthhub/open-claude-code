/**
 * utils/permissions.ts - 权限检查实现
 *
 * 对应真实 Claude Code: src/utils/permissions.ts + src/hooks/toolPermission/
 *
 * 确保 AI 不会未经用户同意执行危险操作。
 * 每次工具调用前，根据权限规则决定：允许、拒绝、或询问用户。
 */

import type {
  PermissionMode,
  PermissionRule,
  PermissionContext,
  PermissionDecision,
  CheckPermissionFn,
} from "../types/index.js";

/**
 * 默认权限规则
 *
 * 真实 Claude Code 的规则更复杂，支持正则匹配、路径范围等。
 * 我们定义核心规则：只读工具允许，危险命令拒绝，其他询问。
 */
export const DEFAULT_RULES: PermissionRule[] = [
  // 只读工具：始终允许
  { toolName: "Read", behavior: "allow", source: "default", reason: "只读操作" },
  { toolName: "Grep", behavior: "allow", source: "default", reason: "只读搜索" },
  { toolName: "Glob", behavior: "allow", source: "default", reason: "只读匹配" },
  { toolName: "Echo", behavior: "allow", source: "default", reason: "只读回显" },

  // 危险命令：始终拒绝
  { toolName: "Bash", pattern: "rm -rf", behavior: "deny", source: "default", reason: "递归删除" },
  { toolName: "Bash", pattern: "rm -r /", behavior: "deny", source: "default", reason: "删除根目录" },
  { toolName: "Bash", pattern: "mkfs", behavior: "deny", source: "default", reason: "格式化磁盘" },
  { toolName: "Bash", pattern: "> /dev/", behavior: "deny", source: "default", reason: "写入设备文件" },
  { toolName: "Bash", pattern: ":(){ :|:& };:", behavior: "deny", source: "default", reason: "Fork 炸弹" },
  { toolName: "Bash", pattern: "chmod -R 777", behavior: "deny", source: "default", reason: "不安全的权限修改" },

  // 写操作：需要询问
  { toolName: "Bash", behavior: "ask", source: "default", reason: "Shell 命令可能有副作用" },
  { toolName: "Write", behavior: "ask", source: "default", reason: "文件写入操作" },
  { toolName: "Edit", behavior: "ask", source: "default", reason: "文件编辑操作" },
];

/**
 * 检查权限
 *
 * 按规则列表顺序匹配，返回第一个匹配的决策。
 * 如果没有规则匹配，根据权限模式决定默认行为。
 */
export function checkPermission(
  toolName: string,
  input: Record<string, unknown>,
  context: PermissionContext
): PermissionDecision {
  // bypassPermissions 模式跳过所有检查
  if (context.mode === "bypassPermissions") {
    return { behavior: "allow" };
  }

  // 遍历规则
  for (const rule of context.rules) {
    // 工具名匹配
    if (rule.toolName !== "*" && rule.toolName !== toolName) continue;

    // 模式匹配（如果有）
    if (rule.pattern) {
      const command = String(input.command ?? input.content ?? "");
      if (!command.includes(rule.pattern)) continue;
    }

    // 匹配成功，返回决策
    switch (rule.behavior) {
      case "allow":
        return { behavior: "allow" };
      case "deny":
        return { behavior: "deny", message: `Blocked: ${rule.reason ?? "policy violation"}` };
      case "ask":
        // auto 模式下，读操作自动放行
        if (context.mode === "auto") {
          // 简单的启发式：如果工具名暗示只读，自动放行
          if (["Read", "Grep", "Glob", "Echo"].includes(toolName)) {
            return { behavior: "allow" };
          }
        }
        return { behavior: "ask", message: rule.reason ?? "需要确认" };
    }
  }

  // 无匹配规则，默认询问
  return { behavior: "ask", message: "未匹配任何规则，需要确认" };
}

/**
 * 创建权限上下文
 */
export function createPermissionContext(
  mode: PermissionMode = "default",
  cwd: string = process.cwd(),
  extraRules: PermissionRule[] = []
): PermissionContext {
  return {
    mode,
    cwd,
    rules: [...extraRules, ...DEFAULT_RULES], // 用户规则优先
  };
}

/**
 * 创建权限检查函数
 *
 * 返回一个闭包，可以传递给 query() 使用。
 * 这对应真实 Claude Code 中 canUseTool 回调的模式。
 */
export function createCheckPermissionFn(
  context: PermissionContext
): CheckPermissionFn {
  return async (toolName, input) => checkPermission(toolName, input, context);
}
