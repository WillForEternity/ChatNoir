"use client";

/**
 * Document Viewer - Main Layout Component
 *
 * Full-screen overlay with Cursor-style 3-panel layout:
 * - Left: Document sidebar (collapsible)
 * - Center: PDF or text viewer
 * - Right: Chat panel with tabs (collapsible, appears on selection)
 *
 * Supports two modes:
 * 1. document prop: Load from IndexedDB (existing document)
 * 2. directFile prop: Immediate viewing (new upload, before indexing)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { X, ChevronLeft, ChevronRight, Loader2, AlertCircle, FileText, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAllLargeDocuments, getLargeDocument, type LargeDocumentMetadata } from "@/knowledge/large-documents";
import { DocumentSidebar } from "./document-sidebar";
import { PDFViewer } from "./pdf-viewer";
import { TextViewer } from "./text-viewer";
import { ChatPanel } from "./chat-panel";

// =============================================================================
// TYPES
// =============================================================================

export interface SelectionData {
  /** Text content (legacy, now optional) */
  text?: string;
  /** Screenshot as base64 data URL */
  screenshot?: string;
  /** Page number where selection was made */
  page?: number;
}

export interface MarginChat {
  id: string;
  chatId: string;
  selection: SelectionData;
}

interface DocumentViewerProps {
  /** Existing document metadata (for documents already stored in IDB) */
  document?: LargeDocumentMetadata;
  /** Direct file for immediate viewing (bypasses IDB lookup) */
  directFile?: File;
  /** Direct file data as ArrayBuffer (alternative to directFile) */
  directFileData?: ArrayBuffer;
  onClose: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function DocumentViewer({ document, directFile, directFileData, onClose }: DocumentViewerProps) {
  // Panel refs for imperative control
  const sidebarRef = useRef<ImperativePanelHandle>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);

  // Track collapsed state (synced with panel state)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatPanelCollapsed, setChatPanelCollapsed] = useState(true);

  // Multiple chat tabs
  const [chats, setChats] = useState<MarginChat[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  
  // Track if PDF viewer has an active selection (to coordinate Escape key handling)
  const [hasActiveSelection, setHasActiveSelection] = useState(false);

  // All uploaded documents for sidebar
  const [allDocuments, setAllDocuments] = useState<LargeDocumentMetadata[]>([]);
  
  // For direct file viewing, create a temporary metadata object
  const initialDocument: LargeDocumentMetadata | null = document || (directFile ? {
    id: "pending-" + crypto.randomUUID(),
    filename: directFile.name,
    mimeType: directFile.type || "application/pdf",
    fileSize: directFile.size,
    chunkCount: 0,
    uploadedAt: Date.now(),
    indexedAt: 0,
    status: "indexing" as const,
  } : null);
  
  const [currentDocument, setCurrentDocument] = useState<LargeDocumentMetadata | null>(initialDocument);
  
  // Convert directFile to ArrayBuffer for immediate rendering
  const [directArrayBuffer, setDirectArrayBuffer] = useState<ArrayBuffer | null>(directFileData || null);
  
  // Convert File to ArrayBuffer when directFile is provided
  useEffect(() => {
    if (directFile && !directArrayBuffer) {
      directFile.arrayBuffer().then(setDirectArrayBuffer);
    }
  }, [directFile, directArrayBuffer]);

  // Load all documents for sidebar (include processing documents for immediate viewing)
  useEffect(() => {
    getAllLargeDocuments().then((docs) => {
      docs.sort((a, b) => b.uploadedAt - a.uploadedAt);
      // Allow viewing documents that are ready, indexing, or uploading (have file stored)
      setAllDocuments(docs.filter(d => d.status === "ready" || d.status === "indexing" || d.status === "uploading"));
    });
  }, []);

  // Poll for document status updates when viewing a processing document
  useEffect(() => {
    if (!currentDocument) return;
    if (currentDocument.status === "ready") return;
    // Skip polling for pending documents (direct file view before storage)
    if (currentDocument.id.startsWith("pending-")) return;
    
    const pollInterval = setInterval(async () => {
      const updated = await getLargeDocument(currentDocument.id);
      if (updated && updated.status !== currentDocument.status) {
        setCurrentDocument(updated);
        // Also refresh the sidebar
        const docs = await getAllLargeDocuments();
        docs.sort((a, b) => b.uploadedAt - a.uploadedAt);
        setAllDocuments(docs.filter(d => d.status === "ready" || d.status === "indexing" || d.status === "uploading"));
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [currentDocument]);

  // Handle text selection - creates new chat tab
  const handleSelection = useCallback((selection: SelectionData) => {
    const id = crypto.randomUUID();
    const newChat: MarginChat = {
      id,
      chatId: `margin-${id}`,
      selection,
    };
    setChats((prev) => [...prev, newChat]);
    setActiveChat(id);
    // Auto-expand chat panel on first selection
    if (chatPanelRef.current?.isCollapsed()) {
      chatPanelRef.current.expand();
    }
  }, []);

  // Close a chat tab
  const handleCloseTab = useCallback((id: string) => {
    setChats((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      // If we closed the active tab, select another
      if (activeChat === id && updated.length > 0) {
        setActiveChat(updated[updated.length - 1].id);
      } else if (updated.length === 0) {
        setActiveChat(null);
      }
      return updated;
    });
  }, [activeChat]);

  // Handle escape key to close (only when no active selection in PDF viewer)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !hasActiveSelection) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, hasActiveSelection]);

  // Check if document is still processing
  const isDirectView = !!directFile || !!directFileData;
  const isProcessing = isDirectView || (currentDocument && (currentDocument.status === "indexing" || currentDocument.status === "uploading"));
  const hasError = currentDocument?.status === "error";

  // Handle case where no document is available
  if (!currentDocument && !isDirectView) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground">No document to display</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header bar with document title and close button */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate">
            {currentDocument?.filename || "Document Viewer"}
          </span>
          {(isProcessing || hasError) && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full flex-shrink-0",
              hasError 
                ? "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400" 
                : "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400"
            )}>
              {hasError ? "Error" : "Indexing..."}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Processing status banner - improved messaging */}
      {isProcessing && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            You can view and chat now. RAG search will be available when indexing completes.
          </span>
        </div>
      )}
      {hasError && currentDocument && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs">
          <AlertCircle className="h-3 w-3" />
          <span>
            Indexing failed: {currentDocument.errorMessage || "Unknown error"}
          </span>
        </div>
      )}

      <PanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* Left Sidebar - Collapsible (hide when viewing direct file) */}
        {!isDirectView && currentDocument && (
          <>
            <Panel
              ref={sidebarRef}
              defaultSize={20}
              minSize={15}
              maxSize={30}
              collapsible
              collapsedSize={0}
              onCollapse={() => setSidebarCollapsed(true)}
              onExpand={() => setSidebarCollapsed(false)}
            >
              {!sidebarCollapsed && (
                <DocumentSidebar
                  documents={allDocuments}
                  current={currentDocument}
                  onSelect={setCurrentDocument}
                  onCollapse={() => sidebarRef.current?.collapse()}
                />
              )}
            </Panel>
            <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
          </>
        )}

        {/* Sidebar expand button when collapsed (hide when viewing direct file) */}
        {sidebarCollapsed && !isDirectView && (
          <div
            onClick={() => sidebarRef.current?.expand()}
            className="w-10 flex flex-col items-center justify-center gap-1 border-r bg-muted/30 hover:bg-muted cursor-pointer transition-colors group"
            title="Show documents sidebar"
          >
            <FileText className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
        )}

        {/* Center - Document Viewer */}
        <Panel defaultSize={60} minSize={30}>
          {currentDocument && currentDocument.mimeType === "application/pdf" ? (
            <PDFViewer
              documentId={isDirectView ? undefined : currentDocument.id}
              directFileData={directArrayBuffer || undefined}
              onSelection={handleSelection}
              onSelectionStateChange={setHasActiveSelection}
            />
          ) : currentDocument ? (
            <TextViewer
              documentId={currentDocument.id}
              onSelection={handleSelection}
            />
          ) : null}
        </Panel>

        {/* Right - Chat Panel (always in DOM, collapsible) */}
        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
        <Panel
          ref={chatPanelRef}
          defaultSize={0}
          minSize={20}
          maxSize={50}
          collapsible
          collapsedSize={0}
          onCollapse={() => setChatPanelCollapsed(true)}
          onExpand={() => setChatPanelCollapsed(false)}
        >
          {!chatPanelCollapsed && (
            <ChatPanel
              chats={chats}
              activeChat={activeChat}
              onTabChange={setActiveChat}
              onCloseTab={handleCloseTab}
              onCollapse={() => chatPanelRef.current?.collapse()}
            />
          )}
        </Panel>

        {/* Chat panel expand button when collapsed */}
        {chatPanelCollapsed && (
          <div
            onClick={() => chatPanelRef.current?.expand()}
            className="w-10 flex flex-col items-center justify-center gap-1 border-l bg-muted/30 hover:bg-muted cursor-pointer transition-colors group relative"
            title="Show chat panel"
          >
            <div className="relative">
              <MessageSquare className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              {/* Badge showing number of active chats (only when there are chats) */}
              {chats.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-medium rounded-full px-0.5">
                  {chats.length}
                </span>
              )}
            </div>
            <ChevronLeft className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
        )}
      </PanelGroup>
    </div>
  );
}
