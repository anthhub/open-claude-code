/**
 * types/index.ts - 类型统一导出
 *
 * 其他模块通过 import { ... } from "./types/index.js" 引入所有类型
 */

// 消息类型
export type {
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  Message,
  StopReason,
  APIMessage,
  APIContentBlock,
  ToolResult,
} from "./message.js";

export {
  generateId,
  isToolUseBlock,
  isTextBlock,
  isAssistantMessage,
  isUserMessage,
} from "./message.js";

// 工具类型
export type {
  Tool,
  ToolCategory,
  JSONSchema,
  JSONSchemaProperty,
  ToolRegistry,
  APIToolDefinition,
} from "./tool.js";

export { toolToAPIFormat } from "./tool.js";

// 权限类型
export type {
  PermissionMode,
  PermissionBehavior,
  PermissionAllowDecision,
  PermissionDenyDecision,
  PermissionAskDecision,
  PermissionDecision,
  PermissionRule,
  PermissionRuleSource,
  PermissionContext,
  CheckPermissionFn,
} from "./permissions.js";

// 配置类型
export type { AppConfig } from "./config.js";
export { DEFAULT_MODEL, DEFAULT_CONFIG } from "./config.js";
