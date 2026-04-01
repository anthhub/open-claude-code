/**
 * Example: interactive-ui.tsx
 * Interactive terminal REPL — keyboard input, scrollable message list,
 * dynamic state updates. Simplified model of Claude Code's REPL screen.
 *
 * Install dependencies:
 *   npm install ink react
 *   npm install --save-dev @types/react typescript
 *
 * Run:
 *   npx tsx interactive-ui.tsx
 *
 * Key bindings:
 *   Enter      — send message
 *   Ctrl+C     — exit
 *   Up/Down    — scroll through history (when input is empty)
 *   Backspace  — delete character
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { render, Box, Text, useInput, useApp, useStdin } from 'ink'

// --- Types ---

type Role = 'user' | 'assistant'

type Message = {
  id: string
  role: Role
  content: string
  isStreaming?: boolean
}

// --- Simulated assistant responses ---

const RESPONSES: Record<string, string> = {
  default:
    'I can help you with that. Could you provide more details about what you need?',
  hello: 'Hello! I am a simplified REPL demo built with Ink. Type a message and press Enter.',
  help:
    'Available commands:\n  hello — greeting\n  help — show this help\n  clear — clear messages\n  exit — quit',
  clear: '__CLEAR__',
  exit: '__EXIT__',
  ink: 'Ink renders React components as ANSI terminal output. It uses a custom reconciler and Yoga for flexbox layout.',
  yoga: 'Yoga is a cross-platform flexbox layout engine used by React Native, Ink, and Claude Code.',
}

function getResponse(input: string): string {
  const key = input.toLowerCase().trim()
  return RESPONSES[key] ?? RESPONSES.default!
}

// --- Spinner Component ---
// A minimal spinner showing "thinking" state

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function Spinner() {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  return <Text color="yellow">{SPINNER_FRAMES[frame]}</Text>
}

// --- Message Item ---

type MessageItemProps = {
  message: Message
}

function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Role badge */}
      <Box>
        {isUser ? (
          <Text bold color="green">
            You
          </Text>
        ) : (
          <Box>
            <Text bold color="blue">
              Assistant
            </Text>
            {message.isStreaming && (
              <Box marginLeft={1}>
                <Spinner />
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Content — indent under role badge */}
      <Box paddingLeft={2}>
        {message.isStreaming && !message.content ? (
          <Text dimColor italic>
            Thinking…
          </Text>
        ) : (
          <Text wrap="wrap">{message.content}</Text>
        )}
      </Box>
    </Box>
  )
}

// --- Scrollable Message List ---
// In a real app, this would use Ink's ScrollBox component.
// Here we demonstrate a simplified viewport approach.

type MessageListProps = {
  messages: Message[]
  viewportHeight: number
  scrollOffset: number
}

function MessageList({ messages, viewportHeight, scrollOffset }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <Box
        flexGrow={1}
        justifyContent="center"
        alignItems="center"
        flexDirection="column"
      >
        <Text dimColor>Type a message and press Enter to start</Text>
        <Text dimColor>Type "help" for available commands</Text>
      </Box>
    )
  }

  // Show a subset of messages based on scroll offset (simplified viewport)
  const visible = messages.slice(Math.max(0, scrollOffset))

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      paddingX={1}
    >
      {visible.map(msg => (
        <MessageItem key={msg.id} message={msg} />
      ))}
      {/* Scroll indicator */}
      {scrollOffset > 0 && (
        <Box>
          <Text dimColor>↑ {scrollOffset} messages above</Text>
        </Box>
      )}
    </Box>
  )
}

// --- Input Area ---
// Demonstrates Box layout for a fixed-bottom input bar.
// Claude Code's PromptInput (src/components/PromptInput/PromptInput.tsx)
// uses the same fixed-bottom pattern with more sophisticated cursor handling.

type InputAreaProps = {
  value: string
  isLoading: boolean
}

function InputArea({ value, isLoading }: InputAreaProps) {
  return (
    <Box
      borderStyle="round"
      borderColor={isLoading ? 'yellow' : 'cyan'}
      paddingX={1}
      marginX={1}
      marginBottom={1}
    >
      <Text bold color={isLoading ? 'yellow' : 'green'}>
        {isLoading ? '…' : '>'}
      </Text>
      <Text> </Text>
      {value ? (
        <Text>{value}</Text>
      ) : (
        <Text dimColor italic>
          {isLoading ? 'Processing…' : 'Type a message…'}
        </Text>
      )}
      {/* Cursor blink indicator */}
      {!isLoading && <Text color="cyan">█</Text>}
    </Box>
  )
}

// --- Status Bar ---

type StatusBarProps = {
  messageCount: number
  isLoading: boolean
}

function StatusBar({ messageCount, isLoading }: StatusBarProps) {
  return (
    <Box paddingX={2} marginBottom={0}>
      <Text dimColor>{messageCount} messages</Text>
      <Box flexGrow={1} />
      {isLoading ? (
        <Text color="yellow">Processing</Text>
      ) : (
        <Text dimColor>Ctrl+C to exit · Enter to send</Text>
      )}
    </Box>
  )
}

// --- Help Footer ---

function HelpFooter() {
  return (
    <Box paddingX={2}>
      <Text dimColor>
        Enter{' '}
      </Text>
      <Text dimColor>send · </Text>
      <Text dimColor>↑↓ </Text>
      <Text dimColor>scroll · </Text>
      <Text dimColor>clear </Text>
      <Text dimColor>clear screen</Text>
    </Box>
  )
}

// --- Main App ---
// This demonstrates Claude Code's REPL architecture:
// - AlternateScreen-like fullscreen layout (Box height=rows)
// - ScrollBox-like message list (flexGrow=1, overflow handling)
// - Fixed-bottom PromptInput
// - useInput for keyboard event handling

function App() {
  const { exit } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const inputHistory = useRef<string[]>([])
  const nextId = useRef(0)

  const genId = () => String(++nextId.current)

  // Process the input and generate a response
  const handleSubmit = useCallback(() => {
    const text = inputValue.trim()
    if (!text || isLoading) return

    // Add to input history
    inputHistory.current.unshift(text)
    setHistoryIndex(-1)

    // Handle special commands
    const response = getResponse(text)

    if (response === '__EXIT__') {
      exit()
      return
    }

    if (response === '__CLEAR__') {
      setMessages([])
      setInputValue('')
      setScrollOffset(0)
      return
    }

    // Add user message
    const userMsg: Message = {
      id: genId(),
      role: 'user',
      content: text,
    }

    // Add placeholder assistant message (streaming state)
    const assistantId = genId()
    const assistantPlaceholder: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantPlaceholder])
    setInputValue('')
    setIsLoading(true)

    // Simulate streaming response — in Claude Code this is driven by
    // the Anthropic API streaming events in src/services/claude.ts
    let charIndex = 0
    const streamInterval = setInterval(() => {
      charIndex += Math.ceil(response.length / 15)
      const partial = response.slice(0, charIndex)

      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: partial, isStreaming: charIndex < response.length }
            : m,
        ),
      )

      if (charIndex >= response.length) {
        clearInterval(streamInterval)
        setIsLoading(false)
        // Auto-scroll to bottom
        setScrollOffset(0)
      }
    }, 50)
  }, [inputValue, isLoading, exit])

  // Keyboard event handling — mirrors useInput in Claude Code's REPL
  // src/screens/REPL.tsx uses useInput for global keybindings
  useInput(
    (input, key) => {
      if (isLoading) return

      if (key.return) {
        handleSubmit()
        return
      }

      if (key.backspace || key.delete) {
        setInputValue(prev => prev.slice(0, -1))
        return
      }

      if (key.upArrow) {
        if (inputValue === '' || historyIndex >= 0) {
          const newIndex = Math.min(
            historyIndex + 1,
            inputHistory.current.length - 1,
          )
          if (newIndex >= 0 && inputHistory.current[newIndex]) {
            setHistoryIndex(newIndex)
            setInputValue(inputHistory.current[newIndex])
          } else if (messages.length > 0) {
            // Scroll up through messages
            setScrollOffset(prev => Math.min(prev + 1, messages.length - 1))
          }
        }
        return
      }

      if (key.downArrow) {
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1
          setHistoryIndex(newIndex)
          setInputValue(inputHistory.current[newIndex] ?? '')
        } else if (historyIndex === 0) {
          setHistoryIndex(-1)
          setInputValue('')
        } else {
          // Scroll down through messages
          setScrollOffset(prev => Math.max(0, prev - 1))
        }
        return
      }

      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        setInputValue(prev => prev + input)
      }
    },
    { isActive: true },
  )

  return (
    // Main layout: flexDirection=column fills the terminal vertically.
    // In Claude Code, AlternateScreen + FullscreenLayout provide the same
    // height-constrained fullscreen container.
    <Box flexDirection="column" height={24}>
      {/* Header */}
      <Box
        borderStyle="double"
        borderColor="cyan"
        paddingX={1}
        marginX={1}
        marginTop={1}
        marginBottom={0}
      >
        <Text bold color="cyan">
          Mini REPL
        </Text>
        <Box flexGrow={1} />
        <Text dimColor>Ink Terminal UI Demo</Text>
      </Box>

      {/* Message list — flexGrow=1 takes remaining vertical space.
          Claude Code uses ScrollBox + VirtualMessageList here. */}
      <MessageList
        messages={messages}
        viewportHeight={16}
        scrollOffset={scrollOffset}
      />

      {/* Fixed-bottom input area — same pattern as PromptInput in REPL.tsx */}
      <InputArea value={inputValue} isLoading={isLoading} />

      {/* Status bar */}
      <StatusBar messageCount={messages.length} isLoading={isLoading} />

      {/* Help */}
      <HelpFooter />
    </Box>
  )
}

// Start rendering — in Claude Code, this is done by src/cli.tsx calling
// render(<App />) after bootstrapping the session
render(<App />)
