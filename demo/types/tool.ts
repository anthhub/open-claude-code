/**
 * types/tool.ts - 工具类型定义
 *
 * 对应真实 Claude Code: src/Tool.ts
 *
 * Tool 是 Claude Code 最核心的抽象之一。AI 的每一项"能力"
 * （读文件、运行命令、搜索代码）都被建模为一个 Tool。
 *
 * 本文件只定义类型接口，具体实现在第 2 章（Tool.ts + tools.ts）完成。
 *
 * 真实 Claude Code 的 Tool 类型极其复杂（30+ 个字段），
 * 我们从核心字段开始，逐章扩展。
 */

import type { ToolResult } from "./message.js";

// ─── 工具分类 ───────────────────────────────────────────────────────────────

/**
 * 工具分类
 *
 * builtin: 内置工具（如 Bash、FileRead）
 * mcp: 通过 MCP 协议桥接的外部工具
 * skill: 通过技能系统加载的工具
 */
export type ToolCategory = "builtin" | "mcp" | "skill";

// ─── 工具接口 ───────────────────────────────────────────────────────────────

/**
 * Tool 接口 - 所有工具必须实现的契约
 *
 * 设计要点：
 * 1. name + description: AI 通过这两个字段决定何时调用此工具
 * 2. inputSchema: JSON Schema 格式，告诉 AI 需要传什么参数
 * 3. call(): 实际执行逻辑
 *
 * 真实 Claude Code 使用 Zod Schema 并通过 zodToJsonSchema 转换，
 * 我们简化为直接使用 JSON Schema
 */
export interface Tool {
  /** 工具名称，如 "Bash"、"Read"、"Grep"。AI 用此名称来引用工具 */
  name: string;

  /** 工具描述，告诉 AI 这个工具能做什么、何时应该使用它 */
  description: string;

  /**
   * 输入参数的 JSON Schema
   *
   * 这个 Schema 会发送给 Anthropic API，AI 根据它生成符合格式的参数。
   * 例如 BashTool 的 schema:
   * {
   *   type: "object",
   *   properties: {
   *     command: { type: "string", description: "要执行的 shell 命令" }
   *   },
   *   required: ["command"]
   * }
   */
  inputSchema: JSONSchema;

  /**
   * 执行工具
   *
   * @param input - 经过 Schema 校验的参数对象
   * @returns 工具执行结果
   */
  call(input: Record<string, unknown>): Promise<ToolResult>;

  /** 工具分类，默认 builtin */
  category?: ToolCategory;

  /**
   * 是否为只读操作
   *
   * 只读工具（如 FileRead、Grep）可以并发执行，
   * 写操作工具（如 FileWrite、Bash）必须串行执行。
   * 这个标志影响 QueryEngine 的工具编排策略。
   */
  isReadOnly?: boolean;
}

// ─── JSON Schema 类型 ────────────────────────────────────────────────────────
// 简化版 JSON Schema，覆盖工具输入定义常用的子集

/**
 * JSON Schema 属性定义
 */
export interface JSONSchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JSONSchemaProperty;
}

/**
 * JSON Schema 对象定义
 *
 * 工具的 inputSchema 通常是一个 object 类型的 JSON Schema
 */
export interface JSONSchema {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

// ─── 工具注册表类型 ──────────────────────────────────────────────────────────

/**
 * 工具注册表 - 管理所有可用工具
 *
 * 在真实 Claude Code 中，工具注册表在 src/tools.ts 中定义，
 * 是一个 Tool[] 数组。QueryEngine 在每次 API 调用时，
 * 将注册表中的工具转换为 API 的 tools 参数格式。
 */
export type ToolRegistry = Tool[];

/**
 * API tools 参数格式
 *
 * 这是 Anthropic Messages API 的 tools 参数需要的格式
 * 每个工具被描述为 name + description + input_schema
 */
export interface APIToolDefinition {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

/**
 * 将 Tool 转换为 API 格式
 *
 * 这个函数在第 2 章实现，这里只定义类型签名
 */
export function toolToAPIFormat(tool: Tool): APIToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}
