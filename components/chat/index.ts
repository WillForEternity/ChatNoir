/**
 * Shared Chat Components
 *
 * Reusable chat UI components extracted from ai-chat.tsx.
 * Used by both the main chat and document viewer chat.
 */

// Markdown rendering
export {
  CodeBlock,
  InlineCode,
  MarkdownContent,
  StreamingMarkdownContent,
} from "./markdown-content";

// Tool invocation rendering
export {
  ToolInvocationRenderer,
  type ToolInvocationState,
  type ToolInvocationPart,
  type ToolInvocationRendererProps,
} from "./tool-invocation";

// Full message rendering
export {
  ChatMessage,
  type MessagePart,
  type ChatMessageData,
  type ChatMessageProps,
} from "./chat-message";
