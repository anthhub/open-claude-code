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
  DEFAULT_MODEL,
  DEFAULT_CONFIG,
} from "./types/index.js";

import { createClient, streamMessage } from "./services/api/claude.js";
import { buildSystemPrompt } from "./context.js";

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ContentBlock,
  Tool,
  AppConfig,
} from "./types/index.js";

import { createPermissionContext, createCheckPermissionFn, DEFAULT_RULES } from "./utils/permissions.js";

import { buildTool } from "./Tool.js";
import { allTools, findToolByName, getToolsForAPI } from "./tools.js";
import { query } from "./query.js";

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

// 构建消息历史
const messages: Message[] = [userMsg, assistantMsg];

// ─── 验证权限系统 ──────────────────────────────────────────────────────────

const permCtx = createPermissionContext("default");
const checkPerm = createCheckPermissionFn(permCtx);

const permTests = [
  { tool: "Read", input: { file_path: "main.ts" } },
  { tool: "Bash", input: { command: "ls -la" } },
  { tool: "Bash", input: { command: "rm -rf /" } },
  { tool: "Write", input: { file_path: "test.txt", content: "hello" } },
];

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
console.log(`工具注册表: ${allTools.length} 个工具`);
allTools.forEach((tool) => {
  const ro = tool.isReadOnly ? "只读" : "读写";
  console.log(`  ${tool.name.padEnd(8)} [${ro}] ${tool.description}`);
});
console.log();

// 测试工具查找
const found = findToolByName("Read");
console.log(`查找工具 "Read": ${found ? "✅ 找到" : "❌ 未找到"}`);
const notFound = findToolByName("NotExist");
console.log(`查找工具 "NotExist": ${notFound ? "✅ 找到" : "❌ 未找到"}`);
console.log();

// 展示 API 格式
const apiTools = getToolsForAPI();
console.log(`API 工具格式: ${apiTools.length} 个工具定义`);
apiTools.forEach((t) => {
  const params = Object.keys(t.input_schema.properties).join(", ");
  console.log(`  ${t.name}(${params})`);
});
console.log();
console.log(`默认配置:`);
console.log(`  模型: ${DEFAULT_CONFIG.model}`);
console.log(`  最大 Token: ${DEFAULT_CONFIG.maxTokens}`);
console.log(`  权限模式: ${DEFAULT_CONFIG.permissionMode}`);
console.log();
console.log(`权限系统 (模式: ${permCtx.mode}, 规则数: ${permCtx.rules.length}):`);
for (const tc of permTests) {
  const decision = await checkPerm(tc.tool, tc.input);
  const icon = decision.behavior === "allow" ? "✅" : decision.behavior === "deny" ? "🚫" : "❓";
  const cmd = (tc.input.command ?? tc.input.file_path) as string;
  console.log(`  ${icon} ${tc.tool}("${cmd}") → ${decision.behavior}`);
}
console.log();
// 实际执行工具
console.log();
console.log("工具执行测试:");
const echoResult = await findToolByName("Echo")!.call({ message: "Hello mini-claude!" });
console.log(`  Echo: "${echoResult.content}"`);

const bashResult = await findToolByName("Bash")!.call({ command: "echo 'tool system works!'" });
console.log(`  Bash: "${bashResult.content.trim()}"`);

console.log();
console.log("类型系统验证通过！");

// ─── 第 3 章：系统提示词预览 ──────────────────────────────────────────────

// 构建系统提示词
const systemPrompt = buildSystemPrompt(allTools, process.cwd());
console.log("系统提示词预览（前 200 字符）:");
console.log(`  "${systemPrompt.substring(0, 200)}..."`);
console.log();

// ─── 第 4 章：Agentic Loop 演示 ───────────────────────────────────────────

if (process.env.ANTHROPIC_API_KEY) {
  console.log("Agentic Loop 演示:");
  console.log("─".repeat(40));

  const result = await query(
    "请读取当前目录下的 package.json 文件，告诉我项目名称和版本号。",
    [],
    {
      model: DEFAULT_MODEL,
      maxTokens: 4096,
      checkPermission: checkPerm,
      onText: (text) => process.stdout.write(text),
      onToolUse: (name, input) => {
        console.log(`\n  [工具调用] ${name}(${JSON.stringify(input)})`);
      },
      onToolResult: (name, result, isError) => {
        const icon = isError ? "❌" : "✅";
        console.log(`  [工具结果] ${icon} ${name}: ${result.substring(0, 80)}...`);
      },
    }
  );

  console.log();
  console.log("─".repeat(40));
  console.log(`循环轮次: ${result.turns}`);
  console.log(`消息总数: ${result.messages.length}`);
  console.log(`Token 使用: ${result.inputTokens} 输入 / ${result.outputTokens} 输出`);
} else {
  console.log("Agentic Loop 演示跳过（设置 ANTHROPIC_API_KEY 后可体验完整的 AI 工具调用循环）");
}

console.log();
console.log("下一步: 第 8 章 - REPL 交互式确认框");
