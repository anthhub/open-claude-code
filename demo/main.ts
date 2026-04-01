/**
 * main.ts - mini-claude 入口文件
 *
 * 对应真实 Claude Code: src/main.tsx
 *
 * 当前状态（第 1 章）：仅验证类型系统可正常工作
 * 后续章节会逐步添加：
 *   第 2 章: Tool 接口实现 + 工具注册表
 *   第 3 章: Anthropic API 调用 + 流式响应
 *   第 4 章: 查询循环（Agentic Loop）
 *   ...
 */

import {
  generateId,
  isToolUseBlock,
  isTextBlock,
  toolToAPIFormat,
  DEFAULT_CONFIG,
} from "./types/index.js";

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ContentBlock,
  Tool,
  AppConfig,
} from "./types/index.js";

// ─── 验证类型系统 ────────────────────────────────────────────────────────────

// 构造一条用户消息
const userMsg: UserMessage = {
  type: "user",
  uuid: generateId(),
  message: {
    role: "user",
    content: "帮我看一下 main.ts 的内容",
  },
};

// 构造一条助手消息（模拟 AI 回复，包含工具调用）
const assistantMsg: AssistantMessage = {
  type: "assistant",
  uuid: generateId(),
  message: {
    role: "assistant",
    content: [
      { type: "text", text: "好的，让我读取这个文件。" },
      {
        type: "tool_use",
        id: "tool_001",
        name: "Read",
        input: { file_path: "main.ts" },
      },
    ],
    model: DEFAULT_CONFIG.model,
    stop_reason: "tool_use",
  },
};

// 从助手消息中提取工具调用
const toolCalls = assistantMsg.message.content.filter(isToolUseBlock);

// 模拟一个工具定义
const readTool: Tool = {
  name: "Read",
  description: "读取文件内容",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "文件的绝对路径" },
    },
    required: ["file_path"],
  },
  isReadOnly: true,
  async call(input) {
    return { content: `[文件内容: ${input.file_path}]` };
  },
};

// 转换为 API 格式
const apiTool = toolToAPIFormat(readTool);

// 构建消息历史
const messages: Message[] = [userMsg, assistantMsg];

// ─── 输出验证结果 ─────────────────────────────────────────────────────────

console.log("mini-claude - 类型系统验证");
console.log("=".repeat(40));
console.log();
console.log(`消息历史: ${messages.length} 条`);
console.log(`  用户消息: "${typeof userMsg.message.content === "string" ? userMsg.message.content : "[复合内容]"}"`);
console.log(`  助手消息: ${assistantMsg.message.content.length} 个内容块`);
console.log(`  工具调用: ${toolCalls.length} 个`);
toolCalls.forEach((tc) => {
  console.log(`    → ${tc.name}(${JSON.stringify(tc.input)})`);
});
console.log();
console.log(`注册工具: ${apiTool.name}`);
console.log(`  描述: ${apiTool.description}`);
console.log(`  参数: ${JSON.stringify(apiTool.input_schema.properties)}`);
console.log(`  只读: ${readTool.isReadOnly}`);
console.log();
console.log(`默认配置:`);
console.log(`  模型: ${DEFAULT_CONFIG.model}`);
console.log(`  最大 Token: ${DEFAULT_CONFIG.maxTokens}`);
console.log(`  权限模式: ${DEFAULT_CONFIG.permissionMode}`);
console.log();
console.log("类型系统验证通过！");
console.log("下一步: 第 2 章 - 实现 Tool 接口和工具注册表");
