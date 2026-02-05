"use client";

/**
 * Chat Panel Component
 *
 * Right-side panel with horizontal tabs for multiple concurrent chats.
 * Each tab is a separate conversation about a text selection.
 */

import { X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatInstance } from "./chat-instance";
import type { MarginChat } from "./index";

interface ChatPanelProps {
  chats: MarginChat[];
  activeChat: string | null;
  onTabChange: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCollapse: () => void;
}

export function ChatPanel({
  chats,
  activeChat,
  onTabChange,
  onCloseTab,
  onCollapse,
}: ChatPanelProps) {
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="font-semibold text-sm">Document Chat</span>
        <button
          onClick={onCollapse}
          className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
          title="Collapse chat panel"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Tab Bar - Horizontal, side by side */}
      {chats.length > 0 && (
        <div className="flex border-b overflow-x-auto scrollbar-thin">
          {chats.map((chat, index) => (
            <button
              key={chat.id}
              onClick={() => onTabChange(chat.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-r",
                "transition-colors min-w-0",
                activeChat === chat.id
                  ? "bg-background border-b-2 border-b-primary -mb-px font-medium"
                  : "bg-muted/30 hover:bg-muted/50 text-muted-foreground"
              )}
            >
              <span>Chat {index + 1}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(chat.id);
                }}
                className="ml-1 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Chat Content - Only active chat visible */}
      <div className="flex-1 overflow-hidden relative">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={cn("absolute inset-0", activeChat !== chat.id && "hidden")}
          >
            <ChatInstance chat={chat} />
          </div>
        ))}

        {chats.length === 0 && (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
            <div>
              <p className="mb-2">Drag to select an area in the document</p>
              <p className="text-xs">Press Enter to capture a screenshot and start a chat</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
