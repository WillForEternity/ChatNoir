"use client";

/**
 * PDF Viewer Component
 *
 * Renders PDFs using react-pdf with screenshot-based selection support.
 * Drag to select a region, press Enter to capture and send to chat.
 * Optimized for fast first-page rendering and progressive page loading.
 * 
 * Session-level caching: PDF files loaded from IndexedDB are cached in memory
 * for the duration of the page session, so re-opening the same document is instant.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import { ChevronLeft, ChevronRight, Minus, Plus, Loader2, ChevronsUp, ChevronsDown, Camera, X, SunMoon } from "lucide-react";
import html2canvas from "html2canvas";
import { getLargeDocumentFile } from "@/knowledge/large-documents";
import type { SelectionData } from "./index";

// Configure PDF.js worker - use a CDN with the exact version from react-pdf
// react-pdf 9.2.1 uses pdfjs-dist 4.8.69 internally
// Using cdnjs which is more reliable than unpkg for ESM workers
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

// =============================================================================
// SESSION-LEVEL PDF CACHE
// =============================================================================
// Cache PDF file data in memory for the page session. This avoids re-fetching
// from IndexedDB and re-parsing when the user closes and re-opens a document.
//
// IMPORTANT: We store as Uint8Array because ArrayBuffer can be "detached" when
// transferred to web workers (like PDF.js does). Uint8Array maintains a copy.

interface CachedPDF {
  /** Stored as Uint8Array to prevent ArrayBuffer detachment issues */
  data: Uint8Array;
  cachedAt: number;
}

// Module-level cache - persists for the page session (until page reload)
const pdfCache = new Map<string, CachedPDF>();

// Maximum cache size (in number of documents) to prevent memory issues
const MAX_CACHE_SIZE = 10;

/**
 * Get PDF from cache or load from IndexedDB.
 * Returns a fresh copy of the data each time to avoid detachment issues.
 */
async function getCachedPDF(documentId: string): Promise<Uint8Array | null> {
  // Check cache first
  const cached = pdfCache.get(documentId);
  if (cached) {
    // Return a copy to avoid detachment if PDF.js transfers the buffer
    return new Uint8Array(cached.data);
  }

  // Load from IndexedDB
  const file = await getLargeDocumentFile(documentId);
  if (!file) {
    return null;
  }

  // Convert to Uint8Array for safe storage
  const uint8Data = new Uint8Array(file.data);

  // Cache the result
  // If cache is full, remove the oldest entry
  if (pdfCache.size >= MAX_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, value] of pdfCache.entries()) {
      if (value.cachedAt < oldestTime) {
        oldestTime = value.cachedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      pdfCache.delete(oldestKey);
    }
  }

  pdfCache.set(documentId, {
    data: uint8Data,
    cachedAt: Date.now(),
  });

  // Return a copy for use
  return new Uint8Array(uint8Data);
}

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
  // Store file data as Uint8Array to avoid ArrayBuffer detachment issues
  const [fileData, setFileData] = useState<Uint8Array | null>(() => 
    directFileData ? new Uint8Array(directFileData) : null
  );
  const [isLoading, setIsLoading] = useState(!directFileData);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set([1]));
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  // Track which document is currently loaded to ensure stable file reference
  // We use this to avoid recreating the file object on every render
  const loadedDocumentRef = useRef<{
    documentId: string | undefined;
    directFileData: ArrayBuffer | undefined;
    fileSource: { data: Uint8Array } | null;
  }>({ documentId: undefined, directFileData: undefined, fileSource: null });

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
      setFileData(new Uint8Array(directFileData));
      setIsLoading(false);
      setError(null);
      setLoadedPages(new Set([1]));
      setRenderedPages(new Set([1, 2, 3])); // Reset rendered pages for new document
    }
  }, [directFileData]);

  // Load PDF from cache or IndexedDB (only if no directFileData is provided)
  useEffect(() => {
    // Skip loading if we have direct file data or no document ID
    if (directFileData || !documentId) return;

    let cancelled = false;
    
    // Check if we might have it cached (instant check)
    const cached = pdfCache.get(documentId);
    if (cached) {
      // Instant load from cache - return a copy to avoid detachment
      setFileData(new Uint8Array(cached.data));
      setIsLoading(false);
      setError(null);
      return;
    }

    // Not cached, need to fetch from IndexedDB
    setIsLoading(true);
    setError(null);
    setLoadedPages(new Set([1])); // Reset to first page
    setRenderedPages(new Set([1, 2, 3])); // Reset rendered pages

    getCachedPDF(documentId)
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setFileData(data);
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

  // Track which pages should be rendered - once a page is rendered, keep it
  // This provides a "render once, keep forever" approach for smooth scrolling
  const [renderedPages, setRenderedPages] = useState<Set<number>>(new Set([1, 2, 3]));
  
  // Expand rendered pages as user scrolls - add pages near visible page
  useEffect(() => {
    if (numPages === 0) return;
    
    setRenderedPages(prev => {
      const updated = new Set(prev);
      
      // Always include first priority pages
      for (let i = 1; i <= Math.min(PRIORITY_PAGES, numPages); i++) {
        updated.add(i);
      }
      
      // Add pages around visible page (with buffer for smooth scrolling)
      const start = Math.max(1, visiblePage - PAGES_TO_PRERENDER);
      const end = Math.min(numPages, visiblePage + PAGES_TO_PRERENDER);
      
      for (let i = start; i <= end; i++) {
        updated.add(i);
      }
      
      // Only update if we added new pages (never remove pages)
      if (updated.size > prev.size) {
        return updated;
      }
      return prev;
    });
  }, [visiblePage, numPages]);
  
  // Convert to sorted array for rendering
  const pagesToRender = useMemo(() => {
    return Array.from(renderedPages).sort((a, b) => a - b);
  }, [renderedPages]);

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
        
        // Calculate base dimensions at PDF resolution
        const baseWidth = width * scaleX;
        const baseHeight = height * scaleY;
        
        // Limit maximum dimensions to prevent huge images that could hang the API
        // Max 1500px on longest side for API compatibility while maintaining readability
        const MAX_DIMENSION = 1500;
        let finalScale = 1;
        
        if (baseWidth > MAX_DIMENSION || baseHeight > MAX_DIMENSION) {
          // Scale down to fit within max dimension
          finalScale = MAX_DIMENSION / Math.max(baseWidth, baseHeight);
        } else if (baseWidth < 800 && baseHeight < 800) {
          // Small selection - scale up to 1.5x for better readability (but not 2x)
          finalScale = 1.5;
        }
        
        // Set up the temp canvas with the selection dimensions
        tempCanvas.width = Math.round(baseWidth * finalScale);
        tempCanvas.height = Math.round(baseHeight * finalScale);
        
        // Draw the selected portion of the PDF canvas
        ctx.drawImage(
          pdfCanvas,
          left * scaleX,
          top * scaleY,
          baseWidth,
          baseHeight,
          0,
          0,
          tempCanvas.width,
          tempCanvas.height
        );
        
        // Use JPEG for larger images (better compression), PNG for smaller ones (better quality)
        const useJpeg = tempCanvas.width * tempCanvas.height > 500000; // > ~700x700
        screenshot = useJpeg 
          ? tempCanvas.toDataURL("image/jpeg", 0.85)
          : tempCanvas.toDataURL("image/png");
        
        // Log size for debugging
        const sizeKB = Math.round(screenshot.length / 1024);
        console.log(`[PDFViewer] Screenshot: ${tempCanvas.width}x${tempCanvas.height}, ${sizeKB}KB, format=${useJpeg ? 'jpeg' : 'png'}`);
      } else {
        // Fallback to html2canvas if no canvas found (shouldn't happen for PDFs)
        const canvas = await html2canvas(pageElement, {
          x: left,
          y: top,
          width,
          height,
          scale: 1.5, // Reduced from 2x
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
        });
        screenshot = canvas.toDataURL("image/jpeg", 0.85);
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
  // We track document identity (documentId or directFileData reference) and only create
  // a new file source object when the document actually changes
  // 
  // IMPORTANT: We update the ref when fileData changes, but the fileSource identity 
  // only changes when the document identity changes. This prevents react-pdf from
  // seeing a "new" file object on every render while still using the latest data.
  
  // Update the cached file source when we have new data
  if (fileData) {
    const cached = loadedDocumentRef.current;
    // Only create a new object if the document identity changed
    if (cached.documentId !== documentId || cached.directFileData !== directFileData) {
      loadedDocumentRef.current = { 
        documentId, 
        directFileData, 
        fileSource: { data: fileData }
      };
    } else if (cached.fileSource) {
      // Same document, just update the data in the existing object
      // This maintains object identity while updating content
      cached.fileSource.data = fileData;
    } else {
      // Same document identity but no file source yet (shouldn't happen normally)
      loadedDocumentRef.current.fileSource = { data: fileData };
    }
  } else {
    loadedDocumentRef.current = { documentId: undefined, directFileData: undefined, fileSource: null };
  }
  
  const fileSource = loadedDocumentRef.current.fileSource;

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
