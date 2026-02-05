"use client";

/**
 * PDF Viewer Component
 *
 * Renders PDFs using react-pdf with screenshot-based selection support.
 * Drag to select a region, press Enter to capture and send to chat.
 * Optimized for fast first-page rendering and progressive page loading.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import { ChevronLeft, ChevronRight, Minus, Plus, Loader2, ChevronsUp, ChevronsDown, Camera, X, SunMoon } from "lucide-react";
import html2canvas from "html2canvas";
import { getLargeDocumentFile } from "@/knowledge/large-documents";
import type { SelectionData } from "./index";

// Configure PDF.js worker - use the worker bundled with react-pdf to avoid version mismatch
// react-pdf 9.x bundles its own pdfjs, so we use its worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  /** Document ID for loading from IndexedDB (used when directFileData is not provided) */
  documentId?: string;
  /** Direct file data for immediate rendering without IDB lookup */
  directFileData?: ArrayBuffer;
  onSelection: (selection: SelectionData) => void;
  /** Callback when selection state changes (for coordinating Escape key handling) */
  onSelectionStateChange?: (hasSelection: boolean) => void;
}

// Number of pages to render around the current visible page for smooth scrolling
const PAGES_TO_PRERENDER = 2;

// Number of initial pages to always prioritize loading (top-first approach)
const PRIORITY_PAGES = 3;

// Selection rectangle state
interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  page: number;
}

export function PDFViewer({ documentId, directFileData, onSelection, onSelectionStateChange }: PDFViewerProps) {
  const [fileData, setFileData] = useState<ArrayBuffer | null>(directFileData || null);
  const [isLoading, setIsLoading] = useState(!directFileData);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set([1]));
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [pendingSelection, setPendingSelection] = useState<SelectionRect | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Color inversion state
  const [isInverted, setIsInverted] = useState(false);

  // Notify parent about selection state changes
  useEffect(() => {
    const hasSelection = isSelecting || pendingSelection !== null;
    onSelectionStateChange?.(hasSelection);
  }, [isSelecting, pendingSelection, onSelectionStateChange]);

  // If directFileData changes (e.g., new file dropped), update immediately
  useEffect(() => {
    if (directFileData) {
      setFileData(directFileData);
      setIsLoading(false);
      setError(null);
      setLoadedPages(new Set([1]));
    }
  }, [directFileData]);

  // Load PDF from IndexedDB only if no directFileData is provided
  useEffect(() => {
    // Skip IDB loading if we have direct file data or no document ID
    if (directFileData || !documentId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setLoadedPages(new Set([1])); // Reset to first page

    getLargeDocumentFile(documentId)
      .then((file) => {
        if (cancelled) return;
        if (file) {
          setFileData(file.data);
        } else {
          setError("PDF file not found in storage. The document may still be uploading.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load PDF");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [documentId, directFileData]);

  // Calculate which pages should be rendered based on visible page
  // Always prioritize pages 1-3 first (top-first approach), then pages around visible page
  const pagesToRender = useMemo(() => {
    if (numPages === 0) return [1];
    
    const pages = new Set<number>();
    
    // Always include first priority pages (1, 2, 3) for fast initial render
    for (let i = 1; i <= Math.min(PRIORITY_PAGES, numPages); i++) {
      pages.add(i);
    }
    
    // Add pages around the current visible page
    const start = Math.max(1, visiblePage - PAGES_TO_PRERENDER);
    const end = Math.min(numPages, visiblePage + PAGES_TO_PRERENDER);
    
    for (let i = start; i <= end; i++) {
      pages.add(i);
    }
    
    // Return sorted array (pages render top to bottom)
    return Array.from(pages).sort((a, b) => a - b);
  }, [visiblePage, numPages]);

  // Setup IntersectionObserver to detect which page is visible
  useEffect(() => {
    if (!containerRef.current || numPages === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Find the most visible page
        let maxRatio = 0;
        let mostVisiblePage = visiblePage;

        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            const pageNum = parseInt(entry.target.getAttribute("data-page") || "1");
            maxRatio = entry.intersectionRatio;
            mostVisiblePage = pageNum;
          }
        });

        if (mostVisiblePage !== visiblePage) {
          setVisiblePage(mostVisiblePage);
        }
      },
      {
        root: containerRef.current,
        threshold: [0.1, 0.5, 0.9],
      }
    );

    return () => {
      observerRef.current?.disconnect();
    };
  }, [numPages, visiblePage]);

  // Register page elements with the observer
  const registerPageRef = useCallback((pageNum: number, element: HTMLDivElement | null) => {
    if (element) {
      pageRefs.current.set(pageNum, element);
      observerRef.current?.observe(element);
    } else {
      const existing = pageRefs.current.get(pageNum);
      if (existing) {
        observerRef.current?.unobserve(existing);
        pageRefs.current.delete(pageNum);
      }
    }
  }, []);

  // Find which page element contains a point
  const findPageAtPoint = useCallback((clientX: number, clientY: number): number | null => {
    for (const [pageNum, element] of pageRefs.current.entries()) {
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return pageNum;
      }
    }
    return null;
  }, []);

  // Handle mouse down - start selection
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left click, not on controls
    if (e.button !== 0) return;
    
    const target = e.target as HTMLElement;
    // Don't start selection on navigation controls
    if (target.closest('button') || target.closest('.navigation-bar')) return;

    const page = findPageAtPoint(e.clientX, e.clientY);
    if (page === null) return;

    const pageElement = pageRefs.current.get(page);
    if (!pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();
    const x = e.clientX - pageRect.left;
    const y = e.clientY - pageRect.top;

    setIsSelecting(true);
    setPendingSelection(null);
    setSelectionRect({
      startX: x,
      startY: y,
      endX: x,
      endY: y,
      page,
    });

    // Prevent text selection
    e.preventDefault();
  }, [findPageAtPoint]);

  // Handle mouse move - update selection rectangle
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isSelecting || !selectionRect) return;

    const pageElement = pageRefs.current.get(selectionRect.page);
    if (!pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - pageRect.left, pageRect.width));
    const y = Math.max(0, Math.min(e.clientY - pageRect.top, pageRect.height));

    setSelectionRect((prev) => prev ? { ...prev, endX: x, endY: y } : null);
  }, [isSelecting, selectionRect]);

  // Handle mouse up - finalize selection
  const handleMouseUp = useCallback(() => {
    if (!isSelecting || !selectionRect) return;

    const width = Math.abs(selectionRect.endX - selectionRect.startX);
    const height = Math.abs(selectionRect.endY - selectionRect.startY);

    // Only keep selection if it's large enough (at least 20x20 pixels)
    if (width >= 20 && height >= 20) {
      setPendingSelection(selectionRect);
    } else {
      setSelectionRect(null);
    }

    setIsSelecting(false);
  }, [isSelecting, selectionRect]);

  // Cancel selection
  const cancelSelection = useCallback(() => {
    setSelectionRect(null);
    setPendingSelection(null);
    setIsSelecting(false);
  }, []);

  // Capture screenshot of selection
  const captureSelection = useCallback(async () => {
    if (!pendingSelection) return;

    const pageElement = pageRefs.current.get(pendingSelection.page);
    if (!pageElement) return;

    setIsCapturing(true);

    try {
      // Calculate the actual rectangle coordinates
      const left = Math.min(pendingSelection.startX, pendingSelection.endX);
      const top = Math.min(pendingSelection.startY, pendingSelection.endY);
      const width = Math.abs(pendingSelection.endX - pendingSelection.startX);
      const height = Math.abs(pendingSelection.endY - pendingSelection.startY);

      // Try to find the canvas element rendered by react-pdf for this page
      // This avoids html2canvas which has issues with oklch() CSS colors
      const pdfCanvas = pageElement.querySelector("canvas");
      
      let screenshot: string;
      
      if (pdfCanvas) {
        // Use the native PDF canvas directly - much faster and no CSS parsing issues
        const tempCanvas = document.createElement("canvas");
        const ctx = tempCanvas.getContext("2d");
        if (!ctx) throw new Error("Could not get canvas context");
        
        // Calculate scale based on the canvas vs element size ratio
        const scaleX = pdfCanvas.width / pdfCanvas.offsetWidth;
        const scaleY = pdfCanvas.height / pdfCanvas.offsetHeight;
        
        // Set up the temp canvas with the selection dimensions
        tempCanvas.width = width * scaleX * 2; // 2x for higher quality
        tempCanvas.height = height * scaleY * 2;
        
        // Draw the selected portion of the PDF canvas
        ctx.drawImage(
          pdfCanvas,
          left * scaleX,
          top * scaleY,
          width * scaleX,
          height * scaleY,
          0,
          0,
          tempCanvas.width,
          tempCanvas.height
        );
        
        screenshot = tempCanvas.toDataURL("image/png");
      } else {
        // Fallback to html2canvas if no canvas found (shouldn't happen for PDFs)
        const canvas = await html2canvas(pageElement, {
          x: left,
          y: top,
          width,
          height,
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
        });
        screenshot = canvas.toDataURL("image/png");
      }

      // Send to chat
      onSelection({
        screenshot,
        page: pendingSelection.page,
      });

      // Clear selection
      cancelSelection();
    } catch (err) {
      console.error("[PDFViewer] Screenshot capture failed:", err);
    } finally {
      setIsCapturing(false);
    }
  }, [pendingSelection, onSelection, cancelSelection]);

  // Handle Enter key to confirm selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && pendingSelection && !isCapturing) {
        e.preventDefault();
        captureSelection();
      } else if (e.key === "Escape" && (pendingSelection || isSelecting)) {
        e.preventDefault();
        e.stopPropagation(); // Don't close the viewer
        cancelSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingSelection, isSelecting, isCapturing, captureSelection, cancelSelection]);

  // Handle document load success
  const handleLoadSuccess = useCallback(({ numPages: pages }: { numPages: number }) => {
    setNumPages(pages);
    // Mark first page as loaded
    setLoadedPages(new Set([1]));
  }, []);

  // Handle page load success - track which pages are loaded
  const handlePageLoadSuccess = useCallback((pageNum: number) => {
    setLoadedPages((prev) => new Set([...prev, pageNum]));
  }, []);

  // Handle document load error
  const handleLoadError = useCallback((err: Error) => {
    console.error("[PDFViewer] Load error:", err);
    setError("Failed to load PDF");
  }, []);

  // Scroll to specific page
  const scrollToPage = useCallback((pageNum: number) => {
    const pageElement = pageRefs.current.get(pageNum);
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setVisiblePage(pageNum);
  }, []);

  // Jump to first/last page
  const scrollToFirst = useCallback(() => scrollToPage(1), [scrollToPage]);
  const scrollToLast = useCallback(() => scrollToPage(numPages), [scrollToPage, numPages]);

  // Memoize the file prop to prevent unnecessary reloads
  // react-pdf warns if the file object changes reference even when data is the same
  const fileSource = useMemo(() => {
    if (!fileData) return null;
    return { data: fileData };
  }, [fileData]);

  // Calculate selection rectangle display coordinates
  const getSelectionStyle = useCallback((rect: SelectionRect) => {
    const left = Math.min(rect.startX, rect.endX);
    const top = Math.min(rect.startY, rect.endY);
    const width = Math.abs(rect.endX - rect.startX);
    const height = Math.abs(rect.endY - rect.startY);
    return { left, top, width, height };
  }, []);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error || !fileSource) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <p className="text-muted-foreground">{error || "PDF not available"}</p>
          <p className="text-xs text-muted-foreground/70 mt-2">
            If the document is still being processed, please wait a moment and try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Selection Hint Banner */}
      {!pendingSelection && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 bg-muted/50 border-b text-xs text-muted-foreground">
          <Camera className="h-3.5 w-3.5" />
          <span>Drag to select an area, then press Enter to capture and chat</span>
        </div>
      )}

      {/* Pending Selection Confirmation Banner */}
      {pendingSelection && (
        <div className="flex-shrink-0 flex items-center justify-center gap-3 px-4 py-2 bg-highlight/10 border-b border-highlight/20">
          <span className="text-sm text-highlight font-medium">
            Selection ready on page {pendingSelection.page}
          </span>
          <button
            onClick={captureSelection}
            disabled={isCapturing}
            className="flex items-center gap-1.5 px-3 py-1 bg-highlight text-highlight-foreground rounded text-sm font-medium hover:bg-highlight/90 disabled:opacity-50 transition-colors"
          >
            {isCapturing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Capturing...</span>
              </>
            ) : (
              <>
                <Camera className="h-3.5 w-3.5" />
                <span>Capture (Enter)</span>
              </>
            )}
          </button>
          <button
            onClick={cancelSelection}
            className="flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-foreground rounded text-sm transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            <span>Cancel (Esc)</span>
          </button>
        </div>
      )}

      {/* PDF Content - Scrollable, renders visible pages + buffer */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-muted/30 flex flex-col items-center py-4 gap-4 select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isSelecting ? "crosshair" : "default" }}
      >
        <Document
          file={fileSource}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={handleLoadError}
          className="flex flex-col items-center gap-4"
          loading={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          {/* Render pages progressively - visible pages + buffer */}
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
            const shouldRender = pagesToRender.includes(pageNum);
            const activeSelection = (selectionRect?.page === pageNum) ? selectionRect : 
                                    (pendingSelection?.page === pageNum) ? pendingSelection : null;
            
            return (
              <div
                key={pageNum}
                ref={(el) => registerPageRef(pageNum, el)}
                data-page={pageNum}
                className="relative"
                style={{ 
                  minHeight: shouldRender ? undefined : 800, // Placeholder height for unloaded pages
                  filter: isInverted ? "invert(1) hue-rotate(180deg)" : undefined,
                }}
              >
                {shouldRender ? (
                  <Page
                    pageNumber={pageNum}
                    scale={scale}
                    renderTextLayer={false}
                    renderAnnotationLayer={true}
                    className="shadow-lg bg-white"
                    onLoadSuccess={() => handlePageLoadSuccess(pageNum)}
                    loading={
                      <div className="flex items-center justify-center py-20 min-h-[600px] bg-white shadow-lg">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    }
                    canvasBackground={isInverted ? undefined : "white"}
                  />
                ) : (
                  // Placeholder for unrendered pages
                  <div className="flex items-center justify-center py-20 min-h-[600px] bg-muted/50 shadow-lg rounded">
                    <span className="text-sm text-muted-foreground">Page {pageNum}</span>
                  </div>
                )}

                {/* Selection Rectangle Overlay */}
                {activeSelection && (
                  <div
                    className="absolute border-2 border-highlight bg-highlight/20 pointer-events-none"
                    style={getSelectionStyle(activeSelection)}
                  />
                )}

                {/* Page number indicator */}
                <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white text-xs rounded">
                  {pageNum}
                </div>
              </div>
            );
          })}
        </Document>
      </div>

      {/* Navigation Bar - Sticky Bottom */}
      <div className="navigation-bar sticky bottom-0 flex items-center justify-center gap-4 p-3 bg-background/95 backdrop-blur border-t">
        {/* Jump to start */}
        <button
          onClick={scrollToFirst}
          disabled={visiblePage <= 1}
          className="p-1.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
          title="Go to first page"
        >
          <ChevronsUp className="h-4 w-4" />
        </button>

        {/* Page Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => scrollToPage(Math.max(1, visiblePage - 1))}
            disabled={visiblePage <= 1}
            className="p-1.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
            title="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm min-w-[80px] text-center">
            Page {visiblePage} of {numPages || "..."}
          </span>
          <button
            onClick={() => scrollToPage(Math.min(numPages, visiblePage + 1))}
            disabled={visiblePage >= numPages}
            className="p-1.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
            title="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Jump to end */}
        <button
          onClick={scrollToLast}
          disabled={visiblePage >= numPages}
          className="p-1.5 rounded hover:bg-muted disabled:opacity-30 transition-colors"
          title="Go to last page"
        >
          <ChevronsDown className="h-4 w-4" />
        </button>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2 border-l pl-4">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            title="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="text-sm min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            title="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Invert Colors Toggle */}
        <div className="flex items-center gap-2 border-l pl-4">
          <button
            onClick={() => setIsInverted((prev) => !prev)}
            className={`p-1.5 rounded transition-colors ${
              isInverted ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
            title={isInverted ? "Restore original colors" : "Invert colors"}
          >
            <SunMoon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
