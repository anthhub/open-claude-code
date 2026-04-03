/**
 * tools/FileReadTool/index.ts - 文件读取工具
 *
 * 对应真实 Claude Code: src/tools/FileReadTool/
 * 真实版本还包含：二进制文件检测、图片/PDF 读取、
 * 编码检测、符号链接解析等。
 */

import { buildTool } from "../../Tool.js";

export const FileReadTool = buildTool({
  name: "Read",
  description: "读取文件内容。支持指定起始行和行数限制。对于大文件，建议使用 offset 和 limit 参数只读取需要的部分。",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "文件的绝对路径" },
      offset: { type: "number", description: "起始行号（从 0 开始，可选）" },
      limit: { type: "number", description: "读取的最大行数（可选，默认 2000）" },
    },
    required: ["file_path"],
  },
  isReadOnly: true,
  async call(input) {
    const filePath = String(input.file_path);
    const offset = Number(input.offset ?? 0);
    const limit = Number(input.limit ?? 2000);

    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();
      if (!exists) {
        return { content: `Error: File not found: ${filePath}`, isError: true };
      }

      const text = await file.text();
      const allLines = text.split("\n");
      const selectedLines = allLines.slice(offset, offset + limit);

      // 添加行号（模拟 cat -n 格式）
      const numbered = selectedLines
        .map((line, i) => `${String(offset + i + 1).padStart(6)}\t${line}`)
        .join("\n");

      let content = numbered;
      if (offset + limit < allLines.length) {
        content += `\n... [${allLines.length - offset - limit} more lines]`;
      }

      return { content };
    } catch (e) {
      return { content: `Error reading file: ${e}`, isError: true };
    }
  },
});
