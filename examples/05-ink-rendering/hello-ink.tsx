/**
 * Example: hello-ink.tsx
 * Basic Ink rendering — Box layout, Text styling, message list pattern.
 *
 * Install dependencies:
 *   npm install ink react
 *   npm install --save-dev @types/react typescript
 *
 * Run (after compiling or with ts-node/tsx):
 *   npx tsx hello-ink.tsx
 */

import React, { useState, useEffect } from 'react'
import { render, Box, Text } from 'ink'

// --- Types ---

type MessageRole = 'user' | 'assistant' | 'system'

type Message = {
  id: number
  role: MessageRole
  content: string
  timestamp: Date
}

// --- Header Component ---

function Header() {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="cyan">
        Claude Code — Terminal UI Demo
      </Text>
      <Box flexGrow={1} />
      <Text dimColor>hello-ink.tsx</Text>
    </Box>
  )
}

// --- Message Component ---
// Mirrors the role-based dispatch in src/components/Message.tsx

type MessageProps = {
  message: Message
}

function MessageItem({ message }: MessageProps) {
  const { role, content, timestamp } = message

  // Role-specific colors — same pattern as Claude Code's theme system
  const roleColor =
    role === 'user' ? 'green' : role === 'assistant' ? 'blue' : 'yellow'
  const roleLabel =
    role === 'user' ? 'You' : role === 'assistant' ? 'Claude' : 'System'

  const timeStr = timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Role header row */}
      <Box>
        <Text bold color={roleColor}>
          {roleLabel}
        </Text>
        <Text dimColor> · {timeStr}</Text>
      </Box>

      {/* Message content — indented to align under role label */}
      <Box paddingLeft={2}>
        <Text wrap="wrap">{content}</Text>
      </Box>
    </Box>
  )
}

// --- Message List Component ---

type MessageListProps = {
  messages: Message[]
}

function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text dimColor italic>
          No messages yet. Starting conversation…
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {messages.map(msg => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </Box>
  )
}

// --- Status Bar Component ---
// Demonstrates flexbox space-between layout

type StatusBarProps = {
  messageCount: number
  isLoading: boolean
}

function StatusBar({ messageCount, isLoading }: StatusBarProps) {
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      <Text dimColor>{messageCount} messages</Text>
      <Box flexGrow={1} />
      {isLoading ? (
        <Text color="yellow">● streaming…</Text>
      ) : (
        <Text dimColor>ready</Text>
      )}
    </Box>
  )
}

// --- Code Block Component ---
// Demonstrates background color styling

type CodeBlockProps = {
  code: string
  language?: string
}

function CodeBlock({ code, language }: CodeBlockProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      {language && (
        <Box backgroundColor="gray" paddingX={1}>
          <Text color="white" dimColor>
            {language}
          </Text>
        </Box>
      )}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        paddingY={0}
      >
        <Text color="white">{code}</Text>
      </Box>
    </Box>
  )
}

// --- Main App ---
// Simulates a conversation with timed messages to show dynamic updates.
// This demonstrates how Claude Code's message list grows over time.

const DEMO_MESSAGES: Array<Omit<Message, 'id' | 'timestamp'>> = [
  {
    role: 'system',
    content: 'Session started. Working directory: /home/user/project',
  },
  {
    role: 'user',
    content: 'Can you show me how Ink renders the terminal?',
  },
  {
    role: 'assistant',
    content:
      'Ink uses a custom React reconciler to build a virtual DOM, then applies ' +
      'Yoga flexbox layout, and finally renders the result as ANSI escape sequences.',
  },
  {
    role: 'user',
    content: 'What does a simple Box layout look like in code?',
  },
  {
    role: 'assistant',
    content:
      'Here is a basic example using Box and Text:\n\n' +
      '<Box flexDirection="column">\n' +
      '  <Text bold>Header</Text>\n' +
      '  <Text>Body content here</Text>\n' +
      '</Box>',
  },
]

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)

  // Simulate messages arriving one by one
  useEffect(() => {
    if (messageIndex >= DEMO_MESSAGES.length) return

    const delay = messageIndex === 0 ? 300 : 800
    const timer = setTimeout(() => {
      const template = DEMO_MESSAGES[messageIndex]!
      const isAssistant = template.role === 'assistant'

      if (isAssistant) {
        setIsLoading(true)
        // Simulate streaming delay for assistant messages
        setTimeout(() => {
          setMessages(prev => [
            ...prev,
            {
              id: prev.length + 1,
              role: template.role,
              content: template.content,
              timestamp: new Date(),
            },
          ])
          setIsLoading(false)
          setMessageIndex(i => i + 1)
        }, 600)
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: prev.length + 1,
            role: template.role,
            content: template.content,
            timestamp: new Date(),
          },
        ])
        setMessageIndex(i => i + 1)
      }
    }, delay)

    return () => clearTimeout(timer)
  }, [messageIndex])

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      <MessageList messages={messages} />

      {/* Code block example — shown after last message */}
      {messages.length >= DEMO_MESSAGES.length && (
        <Box paddingX={1}>
          <Box flexDirection="column">
            <Text bold>Rendering pipeline (simplified):</Text>
            <CodeBlock
              language="text"
              code={
                'React tree → Custom DOM → Yoga layout\n' +
                '→ renderNodeToOutput → Output buffer\n' +
                '→ Screen diff → ANSI sequences → stdout'
              }
            />
          </Box>
        </Box>
      )}

      <StatusBar messageCount={messages.length} isLoading={isLoading} />

      {/* Exit hint */}
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}

// Start rendering
render(<App />)
