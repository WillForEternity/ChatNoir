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
import { cn } from "@/lib/utils";
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

// Background preloading interval (ms) - how often to queue another page
const PRELOAD_INTERVAL_MS = 300;

// Maximum number of pages to preload per interval tick
const PAGES_PER_TICK = 1;

// =============================================================================
// ADAPTIVE MEMORY MANAGEMENT
// =============================================================================
// For small documents, keep all pages rendered (best UX).
// For larger documents, use a sliding window to limit memory usage.
// This prevents memory issues with 100+ page documents.

// Threshold: documents with this many pages or fewer keep all pages rendered
const SMALL_DOC_THRESHOLD = 30;

// For medium docs (31-100 pages), keep this many pages rendered
const MEDIUM_DOC_WINDOW = 20;

// For large docs (100+ pages), keep this many pages rendered  
const LARGE_DOC_WINDOW = 15;

// Large doc threshold
const LARGE_DOC_THRESHOLD = 100;

/**
 * Calculate how many pages to keep rendered based on document size.
 */
function getRetentionWindow(numPages: number): number {
  if (numPages <= SMALL_DOC_THRESHOLD) {
    return numPages; // Keep all pages for small docs
  } else if (numPages <= LARGE_DOC_THRESHOLD) {
    return MEDIUM_DOC_WINDOW;
  } else {
    return LARGE_DOC_WINDOW;
  }
}

/**
 * Calculate which pages should be in the retention window.
 * Centers on visiblePage with slight forward bias (users scroll down more).
 */
function getRetentionRange(visiblePage: number, numPages: number): { start: number; end: number } {
  const windowSize = getRetentionWindow(numPages);
  
  // If keeping all pages, return full range
  if (windowSize >= numPages) {
    return { start: 1, end: numPages };
  }
  
  // Slight forward bias: 40% before, 60% after visible page
  const pagesBefore = Math.floor(windowSize * 0.4);
  const pagesAfter = windowSize - pagesBefore - 1; // -1 for visible page itself
  
  let start = visiblePage - pagesBefore;
  let end = visiblePage + pagesAfter;
  
  // Adjust if we hit boundaries
  if (start < 1) {
    end += (1 - start);
    start = 1;
  }
  if (end > numPages) {
    start -= (end - numPages);
    end = numPages;
  }
  
  // Final clamp
  start = Math.max(1, start);
  end = Math.min(numPages, end);
  
  return { start, end };
}

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

  // Track which pages should be rendered
  // Uses adaptive memory management: small docs keep all, large docs use sliding window
  const [renderedPages, setRenderedPages] = useState<Set<number>>(new Set([1, 2, 3]));
  
  // =============================================================================
  // SLIDING WINDOW WITH EVICTION
  // =============================================================================
  // For small documents (≤30 pages): keep all pages rendered
  // For larger documents: maintain a sliding window around visible page
  // Pages outside the window are evicted to save memory
  
  useEffect(() => {
    if (numPages === 0) return;
    
    const { start: retentionStart, end: retentionEnd } = getRetentionRange(visiblePage, numPages);
    const windowSize = getRetentionWindow(numPages);
    const shouldEvict = windowSize < numPages;
    
    setRenderedPages(prev => {
      const updated = new Set<number>();
      
      // Always include priority pages at the start (for quick initial load)
      for (let i = 1; i <= Math.min(PRIORITY_PAGES, numPages); i++) {
        // Only keep priority pages if they're within retention window OR doc is small
        if (!shouldEvict || (i >= retentionStart && i <= retentionEnd)) {
          updated.add(i);
        }
      }
      
      // Add all pages within the retention window
      for (let i = retentionStart; i <= retentionEnd; i++) {
        updated.add(i);
      }
      
      // Ensure immediate scroll buffer is always included
      const bufferStart = Math.max(1, visiblePage - PAGES_TO_PRERENDER);
      const bufferEnd = Math.min(numPages, visiblePage + PAGES_TO_PRERENDER);
      for (let i = bufferStart; i <= bufferEnd; i++) {
        updated.add(i);
      }
      
      // Check if we need to update state
      // Update if: different size, or any pages changed
      if (updated.size !== prev.size) {
        return updated;
      }
      
      // Check if contents are the same
      for (const page of updated) {
        if (!prev.has(page)) {
          return updated;
        }
      }
      
      return prev; // No change
    });
  }, [visiblePage, numPages]);

  // =============================================================================
  // BACKGROUND PRELOADING (within retention window)
  // =============================================================================
  // Systematically preload pages within the retention window in order of 
  // distance from the visible page. This fills the window smoothly without
  // waiting for user scroll.
  
  useEffect(() => {
    if (numPages === 0) return;
    
    const { start: retentionStart, end: retentionEnd } = getRetentionRange(visiblePage, numPages);
    
    // Calculate how many pages should be in the window
    const targetSize = retentionEnd - retentionStart + 1;
    
    // Check if window is already full
    let pagesInWindow = 0;
    for (let i = retentionStart; i <= retentionEnd; i++) {
      if (renderedPages.has(i)) pagesInWindow++;
    }
    if (pagesInWindow >= targetSize) return;
    
    const intervalId = setInterval(() => {
      setRenderedPages(prev => {
        // Recalculate in case visiblePage changed
        const { start, end } = getRetentionRange(visiblePage, numPages);
        
        // Check if window is full
        let currentInWindow = 0;
        for (let i = start; i <= end; i++) {
          if (prev.has(i)) currentInWindow++;
        }
        if (currentInWindow >= (end - start + 1)) {
          return prev; // Window is full
        }
        
        const updated = new Set(prev);
        let addedCount = 0;
        
        // Find pages to add within retention window, prioritizing by distance
        for (let distance = 0; distance <= numPages && addedCount < PAGES_PER_TICK; distance++) {
          // Check page above (visiblePage - distance)
          const pageAbove = visiblePage - distance;
          if (pageAbove >= start && pageAbove <= end && !updated.has(pageAbove)) {
            updated.add(pageAbove);
            addedCount++;
            if (addedCount >= PAGES_PER_TICK) break;
          }
          
          // Check page below (visiblePage + distance)
          const pageBelow = visiblePage + distance;
          if (distance > 0 && pageBelow >= start && pageBelow <= end && !updated.has(pageBelow)) {
            updated.add(pageBelow);
            addedCount++;
            if (addedCount >= PAGES_PER_TICK) break;
          }
        }
        
        if (updated.size !== prev.size) {
          return updated;
        }
        return prev;
      });
    }, PRELOAD_INTERVAL_MS);
    
    return () => clearInterval(intervalId);
  }, [numPages, visiblePage, renderedPages.size]);
  
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
  // We use useMemo with fileData as the dependency - fileData only changes when:
  // 1. A new document is loaded (different documentId)
  // 2. Direct file data is provided/changed
  // This ensures the file source object maintains stable identity between renders
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
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 bg-gray-50/50 dark:bg-neutral-900/50 border-b border-gray-200 dark:border-neutral-700 text-xs text-gray-500 dark:text-neutral-500">
          <Camera className="h-3.5 w-3.5" />
          <span>Drag to select an area, then press Enter to capture and chat</span>
        </div>
      )}

      {/* Pending Selection Confirmation Banner */}
      {pendingSelection && (
        <div className="flex-shrink-0 flex items-center justify-center gap-3 px-4 py-2 bg-fuchsia-50 dark:bg-[#ff00ff]/10 border-b border-fuchsia-200 dark:border-[#ff00ff]/30">
          <span className="text-sm text-fuchsia-600 dark:text-[#ff00ff] font-medium">
            Selection ready on page {pendingSelection.page}
          </span>
          <button
            onClick={captureSelection}
            disabled={isCapturing}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50",
              "bg-fuchsia-500 dark:bg-[#ff00ff] text-white",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.15),-3px_-3px_6px_rgba(255,255,255,0.3)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.2),-4px_-4px_8px_rgba(255,255,255,0.4)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]"
            )}
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
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 rounded-xl text-sm transition-all duration-200",
              "text-gray-500 dark:text-neutral-500 hover:text-gray-700 dark:hover:text-neutral-300",
              "hover:bg-gray-100 dark:hover:bg-neutral-800"
            )}
          >
            <X className="h-3.5 w-3.5" />
            <span>Cancel (Esc)</span>
          </button>
        </div>
      )}

      {/* PDF Content - Scrollable, renders visible pages + buffer */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-100 dark:bg-neutral-900 flex flex-col items-center py-4 gap-4 select-none"
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
      <div className="navigation-bar sticky bottom-0 flex items-center justify-center gap-4 p-3 bg-white/95 dark:bg-neutral-950/95 backdrop-blur border-t border-gray-200 dark:border-neutral-700 neu-context-white">
        {/* Jump to start */}
        <button
          onClick={scrollToFirst}
          disabled={visiblePage <= 1}
          className={cn(
            "p-2 rounded-xl transition-all duration-200 disabled:opacity-30",
            "bg-white dark:bg-neutral-950",
            "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
            "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
            "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
            "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
            "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
            "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
          )}
          title="Go to first page"
        >
          <ChevronsUp className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
        </button>

        {/* Page Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => scrollToPage(Math.max(1, visiblePage - 1))}
            disabled={visiblePage <= 1}
            className={cn(
              "p-2 rounded-xl transition-all duration-200 disabled:opacity-30",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="Previous page"
          >
            <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
          </button>
          <span className="text-sm min-w-[80px] text-center text-gray-700 dark:text-neutral-300">
            Page {visiblePage} of {numPages || "..."}
          </span>
          <button
            onClick={() => scrollToPage(Math.min(numPages, visiblePage + 1))}
            disabled={visiblePage >= numPages}
            className={cn(
              "p-2 rounded-xl transition-all duration-200 disabled:opacity-30",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="Next page"
          >
            <ChevronRight className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
          </button>
        </div>

        {/* Jump to end */}
        <button
          onClick={scrollToLast}
          disabled={visiblePage >= numPages}
          className={cn(
            "p-2 rounded-xl transition-all duration-200 disabled:opacity-30",
            "bg-white dark:bg-neutral-950",
            "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
            "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
            "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
            "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
            "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
            "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
          )}
          title="Go to last page"
        >
          <ChevronsDown className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
        </button>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2 border-l border-gray-200 dark:border-neutral-700 pl-4">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
            className={cn(
              "p-2 rounded-xl transition-all duration-200",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="Zoom out"
          >
            <Minus className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
          </button>
          <span className="text-sm min-w-[50px] text-center text-gray-700 dark:text-neutral-300">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}
            className={cn(
              "p-2 rounded-xl transition-all duration-200",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="Zoom in"
          >
            <Plus className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
          </button>
        </div>

        {/* Invert Colors Toggle */}
        <div className="flex items-center gap-2 border-l border-gray-200 dark:border-neutral-700 pl-4">
          <button
            onClick={() => setIsInverted((prev) => !prev)}
            className={cn(
              "p-2 rounded-xl transition-all duration-200",
              isInverted
                ? cn(
                    "bg-fuchsia-500 dark:bg-[#ff00ff] text-white",
                    "shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]"
                  )
                : cn(
                    "bg-white dark:bg-neutral-950",
                    "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
                    "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
                    "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
                    "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]"
                  )
            )}
            title={isInverted ? "Restore original colors" : "Invert colors"}
          >
            <SunMoon className={cn("h-4 w-4", isInverted ? "text-white" : "text-gray-600 dark:text-neutral-400")} />
          </button>
        </div>
      </div>
    </div>
  );
}
