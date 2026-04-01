/**
 * types/message.ts - 消息类型定义
 *
 * 对应真实 Claude Code: src/types/message.ts
 *
 * 这是整个 mini-claude 的数据基础。所有的对话历史、工具调用结果、
 * AI 回复都以 Message 的形式存在。理解这些类型，就理解了数据如何
 * 在系统中流动。
 *
 * 设计原则：
 * 1. 消息类型用 discriminated union（可区分联合类型），通过 type 字段区分
 * 2. 内容块（ContentBlock）也是 discriminated union，支持文本、工具调用等
 * 3. 保持与 Anthropic API 的消息格式兼容
 */

// ─── 内容块类型 ─────────────────────────────────────────────────────────────
// Content blocks 是消息的最小组成单元
// 真实 Claude Code 从 @anthropic-ai/sdk 导入这些类型，这里我们自己定义简化版

/**
 * 文本内容块 - AI 生成的文字
 */
export interface TextBlock {
  type: "text";
  text: string;
}

/**
 * 工具调用块 - AI 决定调用某个工具
 *
 * 当 AI 认为需要执行某个操作（如读文件、运行命令），它会返回一个 tool_use 块。
 * QueryEngine 会解析这个块，找到对应的 Tool 实现并执行。
 */
export interface ToolUseBlock {
  type: "tool_use";
  id: string; // 唯一标识，用于匹配后续的 tool_result
  name: string; // 工具名，如 "Bash"、"FileRead"、"Grep"
  input: Record<string, unknown>; // 工具参数，结构由各工具的 inputSchema 定义
}

/**
 * 工具结果块 - 工具执行后返回的结果
 *
 * 作为 user 消息的一部分发回 API，让 AI 看到工具的输出
 */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string; // 对应 ToolUseBlock.id
  content: string; // 工具输出内容（文本形式）
  is_error?: boolean; // 工具执行是否失败
}

/**
 * 所有内容块的联合类型
 *
 * 真实 Claude Code 还有 ThinkingBlock（思考过程）、ImageBlock 等，
 * 我们在后续章节按需添加
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// ─── 消息类型 ───────────────────────────────────────────────────────────────
// 消息是对话历史的基本单元，每条消息有明确的角色（role）

/**
 * 用户消息
 *
 * 用户输入的文本，以及工具执行结果（tool_result 也作为 user 角色发送）
 */
export interface UserMessage {
  type: "user";
  uuid: string;
  message: {
    role: "user";
    content: string | ContentBlock[];
  };
}

/**
 * 助手消息 - AI 的回复
 *
 * 包含 AI 生成的文本和/或工具调用请求
 * 真实 Claude Code 中这个结构更复杂，包含 usage、stop_reason 等元数据
 */
export interface AssistantMessage {
  type: "assistant";
  uuid: string;
  message: {
    role: "assistant";
    content: ContentBlock[];
    model: string;
    stop_reason: StopReason | null;
  };
}

/**
 * 系统消息 - 系统级通知
 *
 * 用于标记上下文压缩边界、显示命令输出等
 * 这些消息不发送给 API，只在本地 UI 中显示
 */
export interface SystemMessage {
  type: "system";
  subtype: "info" | "compact_boundary" | "local_command";
  message: string;
}

/**
 * 消息联合类型
 *
 * 真实 Claude Code 还有 ProgressMessage、AttachmentMessage、TombstoneMessage 等
 * 我们先保持简单，后续章节按需扩展
 */
export type Message = UserMessage | AssistantMessage | SystemMessage;

// ─── API 相关类型 ────────────────────────────────────────────────────────────

/**
 * API 停止原因
 *
 * end_turn: AI 认为回答完毕
 * tool_use: AI 需要调用工具，等待工具结果后继续
 * max_tokens: 达到最大 token 限制
 */
export type StopReason = "end_turn" | "tool_use" | "max_tokens";

/**
 * 发送给 API 的消息格式
 *
 * 这是 Anthropic Messages API 接受的消息格式
 * 我们的内部 Message 类型需要转换成这个格式才能发给 API
 */
export interface APIMessage {
  role: "user" | "assistant";
  content: string | APIContentBlock[];
}

/**
 * API 内容块格式
 */
export type APIContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

// ─── 工具辅助类型 ────────────────────────────────────────────────────────────

/**
 * 工具调用结果
 *
 * 工具执行后返回的标准化结果，包含输出内容和可选的副作用
 */
export interface ToolResult {
  content: string; // 工具输出文本
  isError?: boolean; // 是否执行失败
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 生成唯一 ID
 * 真实 Claude Code 使用 crypto.randomUUID()
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 类型守卫：判断内容块是否为工具调用
 */
export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

/**
 * 类型守卫：判断内容块是否为文本
 */
export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === "text";
}

/**
 * 类型守卫：判断消息是否为助手消息
 */
export function isAssistantMessage(msg: Message): msg is AssistantMessage {
  return msg.type === "assistant";
}

/**
 * 类型守卫：判断消息是否为用户消息
 */
export function isUserMessage(msg: Message): msg is UserMessage {
  return msg.type === "user";
}
