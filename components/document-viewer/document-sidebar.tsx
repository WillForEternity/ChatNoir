"use client";

/**
 * Document Sidebar Component
 *
 * Left panel showing all uploaded documents.
 * Allows switching between documents within the viewer.
 */

import { FileText, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LargeDocumentMetadata } from "@/knowledge/large-documents";

interface DocumentSidebarProps {
  documents: LargeDocumentMetadata[];
  current: LargeDocumentMetadata;
  onSelect: (doc: LargeDocumentMetadata) => void;
  onCollapse: () => void;
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentSidebar({
  documents,
  current,
  onSelect,
  onCollapse,
}: DocumentSidebarProps) {
  return (
    <div className="h-full flex flex-col bg-gray-50/50 dark:bg-neutral-950 neu-context-gray">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-neutral-700 h-[48px]">
        <span className="font-semibold text-sm text-gray-900 dark:text-neutral-100">Documents</span>
        <button
          onClick={onCollapse}
          className={cn(
            "p-2 rounded-xl transition-all duration-200",
            "bg-gray-50 dark:bg-neutral-950",
            "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
            "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
            "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
            "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
            "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
            "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
          )}
          title="Collapse sidebar"
        >
          <ChevronLeft className="h-4 w-4 text-gray-500 dark:text-neutral-500" />
        </button>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-auto">
        <div className="p-2 space-y-1">
          {documents.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-neutral-500 text-center py-4">
              No documents available
            </p>
          ) : (
            documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => onSelect(doc)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-xl text-sm transition-all duration-200",
                  current.id === doc.id
                    ? cn(
                        "bg-gray-100 dark:bg-neutral-800",
                        "shadow-[inset_2px_2px_4px_rgba(0,0,0,0.05),inset_-2px_-2px_4px_rgba(255,255,255,0.8)]",
                        "dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.3),inset_-2px_-2px_4px_rgba(255,255,255,0.02)]",
                        "border-l-2 border-fuchsia-500 dark:border-[#ff00ff]"
                      )
                    : "hover:bg-gray-100 dark:hover:bg-neutral-800/50 text-gray-700 dark:text-neutral-300"
                )}
              >
                <div className="flex items-center gap-2">
                  <FileText className={cn(
                    "h-4 w-4 flex-shrink-0",
                    current.id === doc.id 
                      ? "text-fuchsia-500 dark:text-[#ff00ff]" 
                      : "text-gray-500 dark:text-neutral-500"
                  )} />
                  <span className={cn(
                    "truncate",
                    current.id === doc.id 
                      ? "text-gray-900 dark:text-neutral-100 font-medium" 
                      : ""
                  )}>{doc.filename}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-neutral-500 mt-0.5 ml-6">
                  {doc.chunkCount} chunks &middot; {formatFileSize(doc.fileSize)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
