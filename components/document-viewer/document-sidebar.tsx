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
    <div className="h-full flex flex-col bg-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="font-semibold text-sm">Documents</span>
        <button
          onClick={onCollapse}
          className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
          title="Collapse sidebar"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-auto">
        <div className="p-2 space-y-1">
          {documents.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No documents available
            </p>
          ) : (
            documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => onSelect(doc)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                  current.id === doc.id
                    ? "bg-primary/10 border-l-2 border-primary"
                    : "hover:bg-muted"
                )}
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{doc.filename}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 ml-6">
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
