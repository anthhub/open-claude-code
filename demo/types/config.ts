/**
 * types/config.ts - 配置类型定义
 *
 * mini-claude 的运行时配置
 *
 * 真实 Claude Code 的配置散布在多个地方：
 * - CLI 参数（Commander.js）
 * - 环境变量
 * - ~/.claude/settings.json
 * - 项目级 CLAUDE.md
 *
 * 我们先定义一个简化的统一配置类型
 */

import type { PermissionMode } from "./permissions.js";

/**
 * mini-claude 全局配置
 */
export interface AppConfig {
  /** Anthropic API Key */
  apiKey: string;

  /** 使用的模型 ID，默认 claude-sonnet-4-20250514 */
  model: string;

  /** 最大输出 token 数 */
  maxTokens: number;

  /** 权限模式 */
  permissionMode: PermissionMode;

  /** 工作目录 */
  cwd: string;

  /** 系统提示词（可选追加） */
  systemPrompt?: string;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: Omit<AppConfig, "apiKey"> = {
  model: "claude-sonnet-4-20250514",
  maxTokens: 16384,
  permissionMode: "default",
  cwd: process.cwd(),
};
