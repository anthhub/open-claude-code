import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Learn Claude Code",
  description: "深入理解 Claude Code 架构与实现的实战指南",

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/learn-claude-code/logo.svg" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Learn Claude Code" }],
    ["meta", { property: "og:description", content: "深入理解 Claude Code 架构与实现的实战指南" }],
  ],
  lastUpdated: true,

  base: "/learn-claude-code/",

  locales: {
    "zh-CN": {
      label: "中文",
      lang: "zh-CN",
      link: "/zh-CN/",
      themeConfig: {
        nav: [
          { text: "教程", link: "/zh-CN/01-overview" },
          { text: "Demo", link: "/zh-CN/demo" },
          {
            text: "在线环境",
            link: "https://github.com/codespaces/new?repo=anthhub/learn-claude-code",
          },
        ],
        sidebar: [
          {
            text: "基础篇",
            items: [
              { text: "第 1 章：项目概览与架构", link: "/zh-CN/01-overview" },
              { text: "第 2 章：CLI 入口与启动流程", link: "/zh-CN/02-cli-entrypoint" },
            ],
          },
          {
            text: "核心系统",
            items: [
              { text: "第 3 章：工具系统", link: "/zh-CN/03-tool-system" },
              { text: "第 4 章：命令系统", link: "/zh-CN/04-command-system" },
              { text: "第 5 章：终端 UI (Ink)", link: "/zh-CN/05-ink-rendering" },
              { text: "第 6 章：服务层与 API", link: "/zh-CN/06-service-layer" },
              { text: "第 7 章：权限系统", link: "/zh-CN/07-permission-system" },
            ],
          },
          {
            text: "高级系统",
            items: [
              { text: "第 8 章：MCP 集成", link: "/zh-CN/08-mcp-integration" },
              { text: "第 9 章：多智能体协调", link: "/zh-CN/09-agent-coordination" },
              { text: "第 10 章：插件与技能", link: "/zh-CN/10-plugin-skill-system" },
              { text: "第 11 章：状态管理", link: "/zh-CN/11-state-context" },
              { text: "第 12 章：高级特性", link: "/zh-CN/12-advanced-features" },
            ],
          },
          {
            text: "Demo: mini-claude",
            items: [{ text: "构建指南", link: "/zh-CN/demo" }],
          },
        ],
        editLink: {
          pattern:
            "https://github.com/anthhub/learn-claude-code/edit/main/docs/:path",
          text: "在 GitHub 上编辑此页",
        },
        outline: { label: "目录" },
        docFooter: { prev: "上一章", next: "下一章" },
      },
    },
    en: {
      label: "English",
      lang: "en",
      link: "/en/",
      themeConfig: {
        nav: [
          { text: "Tutorial", link: "/en/01-overview" },
          { text: "Demo", link: "/en/demo" },
          {
            text: "Online Env",
            link: "https://github.com/codespaces/new?repo=anthhub/learn-claude-code",
          },
        ],
        sidebar: [
          {
            text: "Foundation",
            items: [
              { text: "Ch 1: Project Overview", link: "/en/01-overview" },
              { text: "Ch 2: CLI Entrypoint", link: "/en/02-cli-entrypoint" },
            ],
          },
          {
            text: "Core Systems",
            items: [
              { text: "Ch 3: Tool System", link: "/en/03-tool-system" },
              { text: "Ch 4: Command System", link: "/en/04-command-system" },
              { text: "Ch 5: Terminal UI (Ink)", link: "/en/05-ink-rendering" },
              { text: "Ch 6: Service Layer", link: "/en/06-service-layer" },
              { text: "Ch 7: Permission System", link: "/en/07-permission-system" },
            ],
          },
          {
            text: "Advanced",
            items: [
              { text: "Ch 8: MCP Integration", link: "/en/08-mcp-integration" },
              { text: "Ch 9: Multi-Agent", link: "/en/09-agent-coordination" },
              { text: "Ch 10: Plugins & Skills", link: "/en/10-plugin-skill-system" },
              { text: "Ch 11: State Management", link: "/en/11-state-context" },
              { text: "Ch 12: Advanced Features", link: "/en/12-advanced-features" },
            ],
          },
          {
            text: "Demo: mini-claude",
            items: [{ text: "Build Guide", link: "/en/demo" }],
          },
        ],
        editLink: {
          pattern:
            "https://github.com/anthhub/learn-claude-code/edit/main/docs/:path",
          text: "Edit this page on GitHub",
        },
        outline: { label: "On this page" },
        docFooter: { prev: "Previous", next: "Next" },
      },
    },
  },

  themeConfig: {
    logo: "/logo.svg",
    socialLinks: [
      { icon: "github", link: "https://github.com/anthhub/learn-claude-code" },
    ],
    search: {
      provider: "local",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright:
        'Source: <a href="https://github.com/anthhub/claude-code">anthhub/claude-code</a>',
    },
  },

  markdown: {
    lineNumbers: true,
  },
});
