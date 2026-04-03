/**
 * tools/BashTool/index.ts - Shell 命令执行工具
 *
 * 对应真实 Claude Code: src/tools/BashTool/
 * 真实版本还包含：命令安全分析、工作目录切换、信号处理、
 * 进程组管理、输出截断策略等。我们实现核心功能。
 */

import { buildTool } from "../../Tool.js";

const MAX_OUTPUT_LENGTH = 50000; // 50KB 输出限制

export const BashTool = buildTool({
  name: "Bash",
  description: "在 shell 中执行命令并返回输出。用于运行测试、安装依赖、查看文件列表等。",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的 shell 命令" },
      timeout: { type: "number", description: "超时时间（毫秒），默认 30000" },
      description: { type: "string", description: "命令的用途说明（可选）" },
    },
    required: ["command"],
  },
  isReadOnly: false,
  async call(input) {
    const command = String(input.command);
    const timeout = Number(input.timeout ?? 30000);

    try {
      const proc = Bun.spawn(["sh", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, TERM: "dumb" }, // 禁用颜色转义
      });

      // 超时处理
      const timer = setTimeout(() => proc.kill(), timeout);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      clearTimeout(timer);

      // 格式化输出
      let content = stdout;
      if (stderr) content += (content ? "\n" : "") + `STDERR:\n${stderr}`;
      if (exitCode !== 0) content += `\nExit code: ${exitCode}`;

      // 截断过长输出
      if (content.length > MAX_OUTPUT_LENGTH) {
        content = content.substring(0, MAX_OUTPUT_LENGTH) +
          `\n... [output truncated, ${content.length} total chars]`;
      }

      return { content: content || "(no output)", isError: exitCode !== 0 };
    } catch (e) {
      return { content: `Error executing command: ${e}`, isError: true };
    }
  },
});
