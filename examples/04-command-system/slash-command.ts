/**
 * examples/04-command-system/slash-command.ts
 *
 * 演示 Claude Code 命令系统的简化实现。
 * 包含 PromptCommand 和 LocalCommand 两种类型，
 * 以及命令注册、查找、执行的完整流程。
 *
 * 示例命令：/stats — 统计目录文件信息
 *
 * 运行方式：
 *   npx ts-node examples/04-command-system/slash-command.ts
 *   或
 *   bun examples/04-command-system/slash-command.ts
 */

import { readdir, stat } from 'fs/promises'
import { join } from 'path'

// ─────────────────────────────────────────────────────────────
// 类型定义（简化自 src/types/command.ts）
// ─────────────────────────────────────────────────────────────

/**
 * LocalCommand 的执行结果类型。
 * 对应源码 src/types/command.ts:16-23
 */
type LocalCommandResult =
  | { type: 'text'; value: string }
  | { type: 'skip' }

/**
 * LocalCommand 的 call 函数签名。
 * 对应源码 src/types/command.ts:62-65
 */
type LocalCommandCall = (
  args: string,
  context: CommandContext,
) => Promise<LocalCommandResult>

/**
 * LocalCommand 模块形状，由 load() 返回。
 * 对应源码 src/types/command.ts:68-72
 */
type LocalCommandModule = {
  call: LocalCommandCall
}

/**
 * 命令上下文 — 传递给 call() 的运行时信息。
 * 简化自 src/types/command.ts 中的 LocalJSXCommandContext
 */
type CommandContext = {
  cwd: string
  verbose?: boolean
}

/**
 * 所有命令类型共享的基础字段。
 * 对应源码 src/types/command.ts:175-203
 */
type CommandBase = {
  name: string
  description: string
  aliases?: string[]
  argumentHint?: string
  isEnabled?: () => boolean
  isHidden?: boolean
}

/**
 * PromptCommand — 展开为发送给模型的提示词。
 * 对应源码 src/types/command.ts:25-57
 *
 * 关键字段：
 * - getPromptForCommand: 返回注入对话的内容块
 * - context: 'inline' 在当前对话展开，'fork' 启动子 Agent
 * - source: 追踪命令来源
 */
type PromptCommand = CommandBase & {
  type: 'prompt'
  source: 'builtin' | 'skills' | 'plugin' | 'bundled'
  progressMessage: string
  context?: 'inline' | 'fork'
  getPromptForCommand(args: string): Promise<string>
}

/**
 * LocalCommand — 在进程内执行，返回文本结果。
 * 对应源码 src/types/command.ts:74-78
 *
 * 关键字段：
 * - load: 懒加载实现模块的函数（启动性能优化）
 * - supportsNonInteractive: 是否支持 --print 模式
 */
type LocalCommand = CommandBase & {
  type: 'local'
  supportsNonInteractive: boolean
  load: () => Promise<LocalCommandModule>
}

/**
 * 联合命令类型。
 * 对应源码 src/types/command.ts:205-206
 */
type Command = PromptCommand | LocalCommand

// ─────────────────────────────────────────────────────────────
// 命令注册表
// ─────────────────────────────────────────────────────────────

/**
 * CommandRegistry — 简化版命令注册中心。
 *
 * 在真实代码中，命令通过 src/commands.ts 的多层机制注册：
 * 1. 静态 import（内置命令）
 * 2. feature() DCE 条件加载（实验性命令）
 * 3. USER_TYPE 条件加载（内部命令）
 * 4. 动态加载（技能、插件、工作流）
 */
class CommandRegistry {
  private commands: Map<string, Command> = new Map()

  /**
   * 注册一个命令。别名也会被索引。
   * 对应源码 src/commands.ts:258-346 中的 COMMANDS() 数组
   */
  register(command: Command): void {
    // 检查 isEnabled 守卫
    if (command.isEnabled && !command.isEnabled()) {
      console.log(`[Registry] 命令 /${command.name} 已禁用，跳过注册`)
      return
    }

    this.commands.set(command.name, command)

    // 同时注册别名
    // 对应源码 src/commands.ts:348-351 中的 builtInCommandNames
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command)
      }
    }

    console.log(`[Registry] 已注册命令 /${command.name}`)
  }

  /**
   * 查找命令（支持别名）。
   * 对应源码 src/commands.ts:688-698 findCommand()
   */
  find(name: string): Command | undefined {
    return this.commands.get(name)
  }

  /**
   * 获取所有可见命令（排除 isHidden）。
   * 对应 src/commands.ts:476-517 getCommands() 的过滤逻辑
   */
  getVisible(): Command[] {
    const seen = new Set<Command>()
    for (const cmd of this.commands.values()) {
      if (!cmd.isHidden) {
        seen.add(cmd)
      }
    }
    return Array.from(seen)
  }

  /**
   * 打印帮助信息（模拟自动补全列表）。
   */
  printHelp(): void {
    console.log('\n可用命令：')
    for (const cmd of this.getVisible()) {
      const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : ''
      const aliases =
        cmd.aliases ? ` (别名: ${cmd.aliases.map(a => `/${a}`).join(', ')})` : ''
      console.log(`  /${cmd.name}${hint}${aliases}`)
      console.log(`      ${cmd.description}`)
    }
    console.log()
  }
}

// ─────────────────────────────────────────────────────────────
// 命令执行器
// ─────────────────────────────────────────────────────────────

/**
 * CommandExecutor — 处理命令的分发与执行。
 *
 * 在真实代码中，这个逻辑分散在：
 * - src/components/REPL.tsx 的 processSlashCommand()
 * - src/utils/commandExecution.ts
 */
class CommandExecutor {
  constructor(
    private registry: CommandRegistry,
    private context: CommandContext,
  ) {}

  /**
   * 解析并执行一条斜杠命令输入。
   * 格式：/命令名 [参数]
   */
  async execute(input: string): Promise<void> {
    // 去掉前导斜杠
    const trimmed = input.startsWith('/') ? input.slice(1) : input
    const spaceIndex = trimmed.indexOf(' ')
    const commandName = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)
    const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim()

    const command = this.registry.find(commandName)
    if (!command) {
      console.error(`未知命令：/${commandName}。输入 /help 查看可用命令。`)
      return
    }

    console.log(`\n执行：/${commandName} ${args}`)
    console.log('─'.repeat(40))

    try {
      if (command.type === 'prompt') {
        await this.executePromptCommand(command, args)
      } else if (command.type === 'local') {
        await this.executeLocalCommand(command, args)
      }
    } catch (err) {
      console.error(`命令执行失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 执行 PromptCommand。
   *
   * 在真实代码中，getPromptForCommand() 的返回值被注入对话，
   * 发送给 Anthropic API，模型负责处理。
   * 这里我们只打印会发送的提示词内容。
   */
  private async executePromptCommand(
    cmd: PromptCommand,
    args: string,
  ): Promise<void> {
    console.log(`[PromptCommand] 正在生成提示词（${cmd.progressMessage}）...`)
    const prompt = await cmd.getPromptForCommand(args)
    console.log('[PromptCommand] 将注入以下内容到对话：')
    console.log()
    // 截断超长提示词
    const maxLen = 500
    console.log(prompt.length > maxLen ? prompt.slice(0, maxLen) + '\n...[已截断]' : prompt)
  }

  /**
   * 执行 LocalCommand。
   *
   * 在真实代码中，load() 惰性加载实现模块，
   * call() 在进程内执行，结果显示在 REPL 中。
   *
   * 懒加载的好处：index.ts 是轻量元数据，
   * 实现模块只在命令首次运行时才导入。
   */
  private async executeLocalCommand(
    cmd: LocalCommand,
    args: string,
  ): Promise<void> {
    // 模拟懒加载
    console.log(`[LocalCommand] 懒加载实现模块...`)
    const module = await cmd.load()

    console.log(`[LocalCommand] 执行 call()...`)
    const result = await module.call(args, this.context)

    if (result.type === 'text') {
      console.log(result.value)
    } else if (result.type === 'skip') {
      // 静默跳过
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 命令实现
// ─────────────────────────────────────────────────────────────

/**
 * /stats 命令的 call 函数实现。
 *
 * 展示 LocalCommandCall 的标准签名，
 * 以及如何从 context 获取 cwd 并处理参数。
 */
const statsCall: LocalCommandCall = async (args, context): Promise<LocalCommandResult> => {
  const targetPath = args.trim() || context.cwd || process.cwd()

  try {
    const entries = await readdir(targetPath, { withFileTypes: true })

    const files = entries.filter(e => e.isFile())
    const dirs = entries.filter(e => e.isDirectory())
    const hidden = entries.filter(e => e.name.startsWith('.'))

    // 并行获取所有文件大小
    const fileSizes = await Promise.all(
      files.map(f =>
        stat(join(targetPath, f.name)).then(s => s.size),
      ),
    )

    const totalBytes = fileSizes.reduce((a, b) => a + b, 0)
    const maxBytes = Math.max(...(fileSizes.length > 0 ? fileSizes : [0]))
    const avgBytes = files.length > 0 ? Math.round(totalBytes / files.length) : 0

    // 按扩展名分组
    const extCount = new Map<string, number>()
    for (const f of files) {
      const dotIndex = f.name.lastIndexOf('.')
      const ext = dotIndex > 0 ? f.name.slice(dotIndex) : '(无扩展名)'
      extCount.set(ext, (extCount.get(ext) ?? 0) + 1)
    }

    const topExts = Array.from(extCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => `    ${ext}: ${count} 个`)
      .join('\n')

    const lines = [
      `目录：${targetPath}`,
      ``,
      `文件统计：`,
      `  总文件数：${files.length}`,
      `  子目录数：${dirs.length}`,
      `  隐藏条目：${hidden.length}`,
      ``,
      `大小统计：`,
      `  总大小：${formatBytes(totalBytes)}`,
      `  平均大小：${formatBytes(avgBytes)}`,
      `  最大文件：${formatBytes(maxBytes)}`,
      ``,
      `文件类型（Top 5）：`,
      topExts || '    (无文件)',
    ]

    return { type: 'text', value: lines.join('\n') }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'text', value: `错误：无法读取目录 ${targetPath}\n${msg}` }
  }
}

/** 格式化字节数为人类可读格式 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ─────────────────────────────────────────────────────────────
// 命令定义
// ─────────────────────────────────────────────────────────────

/**
 * /stats 命令 — LocalCommand 示例。
 *
 * 模式：index.ts 只包含元数据 + load() 惰性函数。
 * 对应源码 src/commands/compact/index.ts 的结构。
 */
const statsCommand: LocalCommand = {
  type: 'local',
  name: 'stats',
  description: '显示目录文件统计信息（文件数、大小、类型分布）',
  aliases: ['du'],  // /du 也能触发此命令
  argumentHint: '[路径]',
  supportsNonInteractive: true,
  // 懒加载：在真实项目中这里是 () => import('./stats.js')
  // 这里我们直接返回包含 call 函数的模块对象
  load: async () => ({ call: statsCall }),
}

/**
 * /review 命令 — PromptCommand 示例。
 *
 * 模式：getPromptForCommand 生成发送给模型的提示词。
 * 对应源码 src/commands/review.ts 的结构。
 */
const reviewCommand: PromptCommand = {
  type: 'prompt',
  name: 'review',
  description: '对当前目录的代码进行 Code Review',
  source: 'builtin',
  progressMessage: 'reviewing code',
  context: 'inline',
  async getPromptForCommand(args: string): Promise<string> {
    const target = args.trim() || '当前目录'
    return `
你是一位专业的代码审查员。请对 ${target} 中的代码进行全面的 Code Review。

请按以下结构输出你的审查报告：

## 代码质量概览
- 整体代码质量评分（1-10）
- 主要优点
- 主要问题

## 详细审查
### 1. 代码结构与可读性
### 2. 潜在 Bug 和边界情况
### 3. 性能考虑
### 4. 安全隐患（如有）
### 5. 测试覆盖率

## 优先修复建议（按重要性排序）
1. ...
2. ...
3. ...

请先运行 \`ls\` 查看目录结构，再分析相关文件。
`.trim()
  },
}

/**
 * /help 命令 — 被禁用的命令示例（演示 isEnabled 守卫）。
 * 在生产中，这个守卫通常检查功能标志或环境变量。
 *
 * 对应源码 src/commands/compact/index.ts:9 中的 isEnabled 模式。
 */
const disabledCommand: LocalCommand = {
  type: 'local',
  name: 'disabled-example',
  description: '这个命令被禁用了（演示用）',
  supportsNonInteractive: false,
  isEnabled: () => {
    // 检查环境变量，类似真实代码中的 isEnvTruthy()
    return process.env.ENABLE_DISABLED_EXAMPLE === 'true'
  },
  load: async () => ({
    call: async () => ({ type: 'text', value: '此命令已启用！' }),
  }),
}

// ─────────────────────────────────────────────────────────────
// 主程序
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(50))
  console.log('  Claude Code 命令系统演示')
  console.log('═'.repeat(50))

  // 1. 创建注册表并注册命令
  console.log('\n[步骤 1] 注册命令...')
  const registry = new CommandRegistry()

  // 注册各种命令（对应 src/commands.ts 中的 COMMANDS() 数组构建）
  registry.register(statsCommand)
  registry.register(reviewCommand)
  registry.register(disabledCommand) // 这个会因 isEnabled 返回 false 而跳过

  // 2. 显示帮助（模拟输入 /help）
  registry.printHelp()

  // 3. 创建执行器
  const context: CommandContext = {
    cwd: process.cwd(),
    verbose: false,
  }
  const executor = new CommandExecutor(registry, context)

  // 4. 演示 LocalCommand — /stats
  await executor.execute('/stats')

  // 5. 演示别名 — /du（stats 的别名）
  await executor.execute('/du src')

  // 6. 演示 PromptCommand — /review
  await executor.execute('/review src/commands')

  // 7. 演示未知命令处理
  await executor.execute('/unknown-command')

  // 8. 演示被禁用命令（注册时已被过滤）
  await executor.execute('/disabled-example')

  console.log('\n═'.repeat(50))
  console.log('  演示完成')
  console.log('═'.repeat(50))
  console.log()
  console.log('关键要点：')
  console.log('  1. LocalCommand.load() 实现懒加载 — index.ts 只有元数据')
  console.log('  2. PromptCommand.getPromptForCommand() 生成注入对话的文本')
  console.log('  3. isEnabled() 守卫在注册时过滤禁用命令')
  console.log('  4. aliases 在注册表中创建额外的名称索引')
  console.log('  5. 真实代码中命令来源是多层的（静态/DCE/动态）')
}

main().catch(err => {
  console.error('程序异常：', err)
  process.exit(1)
})
