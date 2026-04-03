/**
 * tools/GrepTool/index.ts - 代码搜索工具
 *
 * 对应真实 Claude Code: src/tools/GrepTool/
 * 真实版本使用 ripgrep (rg) 而非 grep，性能更好。
 * 这里简化为 grep，后续可替换为 rg。
 */

import { buildTool } from "../../Tool.js";

export const GrepTool = buildTool({
  name: "Grep",
  description: "在文件中搜索匹配的文本模式。支持正则表达式。适合在代码库中查找函数定义、变量引用等。",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "搜索的正则表达式模式" },
      path: { type: "string", description: "搜索的目录或文件路径，默认当前目录" },
      include: { type: "string", description: "文件类型过滤（如 '*.ts'）" },
    },
    required: ["pattern"],
  },
  isReadOnly: true,
  async call(input) {
    const pattern = String(input.pattern);
    const searchPath = String(input.path ?? ".");
    const include = input.include ? String(input.include) : undefined;

    try {
      const args = ["grep", "-rn"];
      if (include) args.push(`--include=${include}`);
      args.push(pattern, searchPath);

      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode === 1 && !stderr) {
        return { content: "No matches found." };
      }
      if (exitCode > 1 || stderr) {
        return { content: `Error: ${stderr}`, isError: true };
      }

      // 限制输出行数
      const lines = stdout.split("\n");
      if (lines.length > 200) {
        return {
          content: lines.slice(0, 200).join("\n") +
            `\n... [${lines.length - 200} more matches]`,
        };
      }

      return { content: stdout || "No matches found." };
    } catch (e) {
      return { content: `Error: ${e}`, isError: true };
    }
  },
});
