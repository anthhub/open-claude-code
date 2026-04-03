/**
 * tools.ts - 工具注册表
 *
 * 对应真实 Claude Code: src/tools.ts
 *
 * 工具注册表是所有可用工具的中央索引。
 * QueryEngine 在调用 API 时，将注册表中的工具转换为 API 参数格式；
 * 收到 tool_use 响应时，根据名称在注册表中查找并执行工具。
 *
 * 第 5 章：工具已迁移到独立的 tools/ 目录中，
 * 每个工具一个子目录，支持更丰富的参数和更好的错误处理。
 */

import type { Tool, APIToolDefinition } from "./types/index.js";
import { toolToAPIFormat } from "./types/index.js";
import { buildTool } from "./Tool.js";

// ─── 从独立模块导入增强版工具 ──────────────────────────────────────────────────
import { BashTool } from "./tools/BashTool/index.js";
import { FileReadTool } from "./tools/FileReadTool/index.js";
import { GrepTool } from "./tools/GrepTool/index.js";

// ─── 内联工具定义 ──────────────────────────────────────────────────────────────

/**
 * EchoTool - 最简单的工具，用于验证工具系统
 *
 * 这不是真实 Claude Code 中的工具，只是教学用的 hello world
 * 保留内联定义，因为它只用于教学演示。
 */
const EchoTool = buildTool({
  name: "Echo",
  description: "回显输入内容，用于测试工具系统是否正常工作",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "要回显的消息" },
    },
    required: ["message"],
  },
  isReadOnly: true,
  async call(input) {
    return { content: String(input.message) };
  },
});

// ─── 工具注册表 ──────────────────────────────────────────────────────────────

/**
 * 所有已注册的工具
 *
 * 真实 Claude Code 中，这个数组包含 40+ 个工具，
 * 部分工具通过 feature() 宏条件加载。
 * 后续章节会逐步添加更多工具。
 */
export const allTools: Tool[] = [
  EchoTool,
  FileReadTool,
  BashTool,
  GrepTool,
];

/**
 * 根据名称查找工具
 *
 * 对应真实 Claude Code: findToolByName()
 * 真实版本还支持别名查找（tool.aliases）
 */
export function findToolByName(name: string): Tool | undefined {
  return allTools.find((t) => t.name === name);
}

/**
 * 将所有工具转换为 API 格式
 *
 * 在调用 Anthropic Messages API 时，需要将工具列表
 * 转换为 API 接受的 { name, description, input_schema } 格式
 */
export function getToolsForAPI(): APIToolDefinition[] {
  return allTools.map(toolToAPIFormat);
}

// 导出各个工具（供直接引用或测试）
export { EchoTool, FileReadTool, BashTool, GrepTool };
