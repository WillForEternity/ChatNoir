"use client";

/**
 * Chat Instance Component
 *
 * Individual chat tab that reuses the existing chat infrastructure.
 * Uses the same /api/chat endpoint and useChat hook as the main chat.
 * Now uses shared ChatMessage component for full markdown/LaTeX/tool rendering.
 * Supports both text selections (legacy) and screenshot selections.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Loader2 } from "lucide-react";
import { useClientTools } from "@/lib/use-client-tools";
import { ChatMessage, type ChatMessageData } from "@/components/chat";
import type { MarginChat } from "./index";

interface ChatInstanceProps {
  chat: MarginChat;
}

export function ChatInstance({ chat }: ChatInstanceProps) {
  const [input, setInput] = useState("");
  const hasSentInitial = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Set up transport - same pattern as main chat
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }: any) => ({
          body: {
            messages,
            chatId: chat.chatId,
            // Use free trial for margin chat (no BYOK for simplicity)
            useFreeTrial: true,
            // Use Sonnet model for document viewer chat (same as main chat default)
            modelTier: "sonnet",
          },
        }),
      } as any),
    [chat.chatId]
  );

  // Set up client tools - same hook as main chat
  const { handleToolCall, setAddToolOutput } = useClientTools({
    enabledTools: ["kb", "documents"], // Enable KB and document search tools
  });

  // Use the chat hook with the same configuration as main chat
  const { messages, sendMessage, status, addToolOutput } = useChat({
    id: chat.chatId, // Unique ID isolates this chat's state
    transport,
    onToolCall: handleToolCall as any,
    // CRITICAL: This tells useChat to automatically continue the conversation
    // after all tool outputs are provided, enabling multi-step tool chains
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  // Wire up tool output function
  useEffect(() => {
    if (addToolOutput) {
      setAddToolOutput(addToolOutput);
    }
  }, [addToolOutput, setAddToolOutput]);

  // Auto-send initial message with selection context (screenshot or text)
  useEffect(() => {
    if (hasSentInitial.current || status !== "ready") return;
    
    const { screenshot, text, page } = chat.selection;
    
    // Handle screenshot selection
    if (screenshot) {
      hasSentInitial.current = true;
      const pageContext = page ? ` (from page ${page})` : "";
      
      // Detect media type from data URL (could be png or jpeg)
      const mediaType = screenshot.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
      
      // Log size for debugging
      const sizeKB = Math.round(screenshot.length / 1024);
      console.log(`[ChatInstance] Sending image: ${sizeKB}KB, type=${mediaType}`);
      
      // Send message with image attachment using AI SDK v6 parts format
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; url: string }> = [
        {
          type: "file",
          mediaType,
          url: screenshot,
        },
        {
          type: "text",
          text: `Explain this section from the document${pageContext}:`,
        },
      ];
      
      sendMessage({ parts });
      return;
    }
    
    // Handle legacy text selection
    if (text) {
      hasSentInitial.current = true;
      const pageContext = page ? ` (from page ${page})` : "";
      sendMessage({
        text: `Explain this section from the document${pageContext}:\n\n"${text}"`,
      });
    }
  }, [chat.selection, sendMessage, status]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle form submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (input.trim() && status === "ready") {
        sendMessage({ text: input });
        setInput("");
      }
    },
    [input, sendMessage, status]
  );

  const isLoading = status === "streaming" || status === "submitted";

  // Determine if this is a screenshot or text selection
  const isScreenshot = !!chat.selection.screenshot;

  return (
    <div className="h-full flex flex-col">
      {/* Selection Preview Badge */}
      <div className="px-3 py-2 bg-muted/30 border-b flex-shrink-0">
        <div className="text-xs text-muted-foreground mb-1">
          Selection {chat.selection.page ? `(page ${chat.selection.page})` : ""}:
        </div>
        {isScreenshot ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={chat.selection.screenshot}
              alt="Selected area"
              className="max-h-24 rounded border border-border object-contain"
            />
          </div>
        ) : chat.selection.text ? (
          <div className="text-xs truncate italic">
            &ldquo;{chat.selection.text.slice(0, 100)}
            {chat.selection.text.length > 100 ? "..." : ""}&rdquo;
          </div>
        ) : null}
      </div>

      {/* Messages - Using shared ChatMessage component */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.map((msg, index) => (
          <ChatMessage
            key={msg.id}
            message={msg as ChatMessageData}
            messageIndex={index}
            totalMessages={messages.length}
            isLoading={isLoading}
            compact={true}
          />
        ))}

        {isLoading && messages.length === 0 && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm ml-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t flex-shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this section..."
            className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            disabled={status !== "ready"}
          />
          <button
            type="submit"
            disabled={status !== "ready" || !input.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 transition-opacity"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
