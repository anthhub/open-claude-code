/**
 * query.ts - 查询循环（Agentic Loop）
 *
 * 对应真实 Claude Code: src/query.ts + src/QueryEngine.ts
 *
 * 这是 mini-claude 最核心的模块。它实现了 AI Agent 的核心循环：
 *   用户输入 → 调用 API → 收到工具调用 → 执行工具 → 结果发回 API → 重复
 *
 * 循环持续直到 AI 返回 end_turn（认为任务完成），
 * 或达到最大轮次限制。
 */

import type { Message, ContentBlock, ToolUseBlock, CheckPermissionFn } from "./types/index.js";
import { createClient, streamMessage } from "./services/api/claude.js";
import { buildSystemPrompt } from "./context.js";
import { allTools, findToolByName, getToolsForAPI } from "./tools.js";
import {
  messagesToAPIParams,
  createUserMessage,
  createAssistantMessage,
  createToolResultBlock,
  extractToolUseBlocks,
} from "./utils/messages.js";

/** 查询循环配置 */
export interface QueryOptions {
  model: string;
  maxTokens: number;
  maxTurns?: number;  // 最大循环轮次，防止无限循环
  apiKey?: string;
  cwd?: string;
  /** 文本输出回调——用于实时渲染 AI 的文字输出 */
  onText?: (text: string) => void;
  /** 工具调用回调——用于显示工具执行状态 */
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
  /** 工具结果回调 */
  onToolResult?: (name: string, result: string, isError: boolean) => void;
  /** 权限检查函数（可选，不提供则跳过权限检查） */
  checkPermission?: CheckPermissionFn;
}

/** 查询结果 */
export interface QueryResult {
  messages: Message[];       // 完整对话历史
  turns: number;            // 实际循环轮次
  inputTokens: number;      // 总输入 token
  outputTokens: number;     // 总输出 token
}

/**
 * 执行查询循环（Agentic Loop）
 *
 * 这是 mini-claude 的核心函数。完整流程：
 *
 * 1. 构建系统提示词
 * 2. 将消息历史转换为 API 格式
 * 3. 调用 API（流式）
 * 4. 收集 AI 回复（文本 + 工具调用）
 * 5. 如果有工具调用：
 *    a. 执行所有工具（只读工具并发，写工具串行）
 *    b. 将工具结果作为 user 消息追加
 *    c. 回到步骤 2（继续循环）
 * 6. 如果没有工具调用（end_turn）：返回结果
 */
export async function query(
  userInput: string,
  messages: Message[],
  options: QueryOptions
): Promise<QueryResult> {
  const {
    model,
    maxTokens,
    maxTurns = 10,
    apiKey,
    cwd = process.cwd(),
    onText,
    onToolUse,
    onToolResult,
    checkPermission,
  } = options;

  const client = createClient(apiKey);
  const systemPrompt = buildSystemPrompt(allTools, cwd);
  const apiTools = getToolsForAPI();

  // 添加用户消息到历史
  const userMsg = createUserMessage(userInput);
  messages.push(userMsg);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let turn = 0;

  // ─── Agentic Loop ───────────────────────────────────────────────────
  while (turn < maxTurns) {
    turn++;

    // 1. 将消息历史转换为 API 格式
    const apiMessages = messagesToAPIParams(messages);

    // 2. 调用 API（流式）
    const contentBlocks: ContentBlock[] = [];
    let currentText = "";
    const toolUseBuffers = new Map<string, { id: string; name: string; input: string }>();
    let stopReason: string | undefined;

    for await (const event of streamMessage(client, {
      model,
      maxTokens,
      system: systemPrompt,
      messages: apiMessages,
      tools: apiTools,
    })) {
      switch (event.type) {
        case "text":
          currentText += event.text ?? "";
          onText?.(event.text ?? "");
          break;

        case "tool_use_start":
          toolUseBuffers.set(event.toolUseId!, {
            id: event.toolUseId!,
            name: event.toolName!,
            input: "",
          });
          break;

        case "tool_use_delta":
          // 累积工具输入 JSON
          for (const buf of toolUseBuffers.values()) {
            buf.input += event.inputDelta ?? "";
          }
          break;

        case "tool_use_end": {
          const buf = toolUseBuffers.get(event.toolUseId!);
          if (buf) {
            // 解析完整的工具输入 JSON
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(buf.input || "{}");
            } catch {
              // JSON 解析失败时使用空对象
            }
            contentBlocks.push({
              type: "tool_use",
              id: buf.id,
              name: buf.name,
              input,
            });
            toolUseBuffers.delete(event.toolUseId!);
            onToolUse?.(buf.name, input);
          }
          break;
        }

        case "message_end":
          stopReason = event.stopReason;
          totalInputTokens += event.usage?.inputTokens ?? 0;
          totalOutputTokens += event.usage?.outputTokens ?? 0;
          break;
      }
    }

    // 3. 将文本块添加到内容
    if (currentText) {
      contentBlocks.unshift({ type: "text", text: currentText });
    }

    // 4. 创建助手消息并追加到历史
    const assistantMsg = createAssistantMessage(
      contentBlocks,
      model,
      (stopReason as "end_turn" | "tool_use" | "max_tokens") ?? null
    );
    messages.push(assistantMsg);

    // 5. 提取工具调用
    const toolUses = extractToolUseBlocks(assistantMsg);

    // 6. 如果没有工具调用，循环结束
    if (toolUses.length === 0) {
      break;
    }

    // 7. 执行工具并收集结果
    const toolResultBlocks: ContentBlock[] = [];

    // 分离只读和读写工具
    const readOnlyTools: ToolUseBlock[] = [];
    const writeTools: ToolUseBlock[] = [];

    for (const tu of toolUses) {
      const tool = findToolByName(tu.name);
      if (tool?.isReadOnly) {
        readOnlyTools.push(tu);
      } else {
        writeTools.push(tu);
      }
    }

    // 并发执行只读工具
    if (readOnlyTools.length > 0) {
      const results = await Promise.all(
        readOnlyTools.map(async (tu) => {
          // 权限检查
          if (checkPermission) {
            const decision = await checkPermission(tu.name, tu.input);
            if (decision.behavior === "deny") {
              return createToolResultBlock(tu.id, `Permission denied: ${decision.message}`, true);
            }
            if (decision.behavior === "ask") {
              // 在 CLI 环境中，默认允许（第 8 章的 REPL 才会真正弹出确认框）
              onToolUse?.(`[权限: ${decision.message}] ${tu.name}`, tu.input);
            }
          }
          const tool = findToolByName(tu.name);
          if (!tool) {
            return createToolResultBlock(tu.id, `Error: Unknown tool '${tu.name}'`, true);
          }
          const result = await tool.call(tu.input);
          onToolResult?.(tu.name, result.content.substring(0, 100), !!result.isError);
          return createToolResultBlock(tu.id, result.content, result.isError);
        })
      );
      toolResultBlocks.push(...results);
    }

    // 串行执行读写工具
    for (const tu of writeTools) {
      // 权限检查
      if (checkPermission) {
        const decision = await checkPermission(tu.name, tu.input);
        if (decision.behavior === "deny") {
          toolResultBlocks.push(
            createToolResultBlock(tu.id, `Permission denied: ${decision.message}`, true)
          );
          continue;
        }
        if (decision.behavior === "ask") {
          // 在 CLI 环境中，默认允许（第 8 章的 REPL 才会真正弹出确认框）
          onToolUse?.(`[权限: ${decision.message}] ${tu.name}`, tu.input);
        }
      }
      const tool = findToolByName(tu.name);
      if (!tool) {
        toolResultBlocks.push(
          createToolResultBlock(tu.id, `Error: Unknown tool '${tu.name}'`, true)
        );
        continue;
      }
      const result = await tool.call(tu.input);
      onToolResult?.(tu.name, result.content.substring(0, 100), !!result.isError);
      toolResultBlocks.push(
        createToolResultBlock(tu.id, result.content, result.isError)
      );
    }

    // 8. 将工具结果作为 user 消息追加到历史
    const toolResultMsg = createUserMessage(toolResultBlocks);
    messages.push(toolResultMsg);

    // 继续循环（回到步骤 1）
  }

  return {
    messages,
    turns: turn,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}
