"use client";

/**
 * Chat Embeddings Viewer Component
 *
 * Visualizes the chat embedding space using UMAP for dimensionality reduction.
 * Shows a 2D scatter plot of all embedded chat chunks with interactive features.
 * 
 * Key differences from KB EmbeddingsViewer:
 * - All points are black (no color categorization by folder)
 * - Hover shows conversation title
 * - Simpler legend (just stats, no folder colors)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  getAllChatEmbeddings,
  getChatEmbeddingStats,
  getChatUmapCache,
  type ChatEmbeddingRecord,
} from "@/lib/storage/chat-embeddings-idb";
import { reindexAllChats } from "@/lib/storage/chat-embeddings-ops";
import { loadChatState } from "@/lib/storage/chat-store";
import { cn } from "@/lib/utils";
import { RefreshCw, ZoomIn, ZoomOut, Move, Loader2, MessageSquare } from "lucide-react";

// =============================================================================
// TYPES
// =============================================================================

interface Point2D {
  x: number;
  y: number;
  embedding: ChatEmbeddingRecord;
}

interface ViewState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

// Black dots for all chat embeddings
const DOT_COLOR_LIGHT = "#1a1a1a";
const DOT_COLOR_DARK = "#e5e5e5";

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get adaptive point size and opacity based on total chunk count.
 */
function getPointStyle(totalPoints: number): { radius: number; hoverRadius: number; opacity: number } {
  if (totalPoints < 100) {
    return { radius: 6, hoverRadius: 10, opacity: 1.0 };
  } else if (totalPoints < 500) {
    return { radius: 4, hoverRadius: 8, opacity: 0.8 };
  } else if (totalPoints < 2000) {
    return { radius: 3, hoverRadius: 6, opacity: 0.6 };
  } else {
    return { radius: 2, hoverRadius: 5, opacity: 0.5 };
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ChatEmbeddingsViewer({ className }: { className?: string }) {
  // State
  const [embeddings, setEmbeddings] = useState<ChatEmbeddingRecord[]>([]);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cacheStatus, setCacheStatus] = useState<"loading" | "cached" | "missing">("loading");
  const [stats, setStats] = useState<{ totalChunks: number; totalConversations: number } | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<Point2D | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<Point2D | null>(null);
  const [viewState, setViewState] = useState<ViewState>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  // Reindexing state
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<{
    current: number;
    total: number;
    currentChat: string;
  } | null>(null);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Adaptive point style based on total count
  const pointStyle = useMemo(() => getPointStyle(points.length), [points.length]);

  // Detect dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };
    checkDarkMode();
    
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    
    return () => observer.disconnect();
  }, []);

  // Load embeddings and cached UMAP projection
  const loadEmbeddingsAndProjection = useCallback(async () => {
    setIsLoading(true);
    setCacheStatus("loading");

    try {
      // Load embeddings, stats, and cached UMAP projection in parallel
      const [embs, statsData, umapCache] = await Promise.all([
        getAllChatEmbeddings(),
        getChatEmbeddingStats(),
        getChatUmapCache(),
      ]);

      setEmbeddings(embs);
      setStats(statsData);

      // Use cached UMAP projection if available
      if (umapCache && embs.length > 0) {
        // Build a map of embedding ID to embedding record for fast lookup
        const embeddingMap = new Map(embs.map((e) => [e.id, e]));

        // Reconstruct points from cache
        const cachedPoints: Point2D[] = [];
        for (const point of umapCache.points) {
          const embedding = embeddingMap.get(point.embeddingId);
          if (embedding) {
            cachedPoints.push({
              x: point.x,
              y: point.y,
              embedding,
            });
          }
        }

        if (cachedPoints.length > 0) {
          setPoints(cachedPoints);
          setCacheStatus("cached");
          setViewState({ offsetX: 0, offsetY: 0, scale: 1 });
          console.log(`[ChatEmbeddingsViewer] Loaded ${cachedPoints.length} points from cache`);
        } else {
          // Cache exists but no valid points (embeddings changed without reindex)
          setCacheStatus("missing");
          setPoints([]);
        }
      } else if (embs.length > 0) {
        // No cache available - need to reindex
        setCacheStatus("missing");
        setPoints([]);
      } else {
        // No embeddings at all
        setCacheStatus("missing");
        setPoints([]);
      }
    } catch (error) {
      console.error("[ChatEmbeddingsViewer] Failed to load embeddings:", error);
      setCacheStatus("missing");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadEmbeddingsAndProjection();
  }, [loadEmbeddingsAndProjection]);

  // Reindex all chats
  const handleReindex = useCallback(async () => {
    setIsReindexing(true);
    setReindexProgress({ current: 0, total: 0, currentChat: "Loading chats..." });

    try {
      // Load all conversations from chat store
      const chatState = await loadChatState();
      const conversations = chatState.conversations;

      if (conversations.length === 0) {
        setReindexProgress({ current: 0, total: 0, currentChat: "No chats to index" });
        setIsReindexing(false);
        return;
      }

      // Reindex all conversations
      await reindexAllChats(conversations, (progress) => {
        setReindexProgress({
          current: progress.current,
          total: progress.total,
          currentChat: progress.currentChat,
        });
      });

      // Refresh the display
      await loadEmbeddingsAndProjection();

      console.log("[ChatEmbeddingsViewer] Reindex complete");
    } catch (error) {
      console.error("[ChatEmbeddingsViewer] Reindex failed:", error);
    } finally {
      setIsReindexing(false);
      setReindexProgress(null);
    }
  }, [loadEmbeddingsAndProjection]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || points.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const baseScale = Math.min(width, height) * 0.4;

    // Clear
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--background") || "#f9fafb";
    ctx.fillRect(0, 0, width, height);

    // Transform coordinates
    const toCanvasX = (x: number) =>
      centerX + x * baseScale * viewState.scale + viewState.offsetX;
    const toCanvasY = (y: number) =>
      centerY + y * baseScale * viewState.scale + viewState.offsetY;

    // Draw grid lines (subtle)
    ctx.strokeStyle = "rgba(128, 128, 128, 0.1)";
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i += 0.5) {
      // Vertical
      ctx.beginPath();
      ctx.moveTo(toCanvasX(i), 0);
      ctx.lineTo(toCanvasX(i), height);
      ctx.stroke();
      // Horizontal
      ctx.beginPath();
      ctx.moveTo(0, toCanvasY(i));
      ctx.lineTo(width, toCanvasY(i));
      ctx.stroke();
    }

    // Get dot color based on theme
    const dotColor = isDarkMode ? DOT_COLOR_DARK : DOT_COLOR_LIGHT;

    // Draw points
    for (const point of points) {
      const x = toCanvasX(point.x);
      const y = toCanvasY(point.y);
      const isHovered = hoveredPoint === point;
      const isSelected = selectedPoint === point;

      // Determine radius
      const radius = isHovered || isSelected ? pointStyle.hoverRadius : pointStyle.radius;

      // Shadow for hovered/selected
      if (isHovered || isSelected) {
        ctx.shadowColor = dotColor;
        ctx.shadowBlur = 12;
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.globalAlpha = pointStyle.opacity;
      ctx.fillStyle = dotColor;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Border for selected
      if (isSelected) {
        ctx.strokeStyle = isDarkMode ? "#1a1a1a" : "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
  }, [points, viewState, hoveredPoint, selectedPoint, pointStyle, isDarkMode]);

  // Mouse handlers
  const getPointAtPosition = useCallback(
    (clientX: number, clientY: number): Point2D | null => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return null;

      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const width = rect.width;
      const height = rect.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const baseScale = Math.min(width, height) * 0.4;

      // Find closest point
      let closest: Point2D | null = null;
      let closestDist = Infinity;

      for (const point of points) {
        const px = centerX + point.x * baseScale * viewState.scale + viewState.offsetX;
        const py = centerY + point.y * baseScale * viewState.scale + viewState.offsetY;
        const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);

        if (dist < pointStyle.hoverRadius * 1.5 && dist < closestDist) {
          closest = point;
          closestDist = dist;
        }
      }

      return closest;
    },
    [points, viewState, pointStyle.hoverRadius]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        setViewState((prev) => ({
          ...prev,
          offsetX: prev.offsetX + dx,
          offsetY: prev.offsetY + dy,
        }));
        setDragStart({ x: e.clientX, y: e.clientY });
      } else {
        const point = getPointAtPosition(e.clientX, e.clientY);
        setHoveredPoint(point);
      }
    },
    [isDragging, dragStart, getPointAtPosition]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const point = getPointAtPosition(e.clientX, e.clientY);
      setSelectedPoint(point === selectedPoint ? null : point);
    },
    [getPointAtPosition, selectedPoint]
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setViewState((prev) => ({
      ...prev,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * delta)),
    }));
  }, []);

  // Zoom controls
  const zoomIn = () =>
    setViewState((prev) => ({
      ...prev,
      scale: Math.min(MAX_SCALE, prev.scale * 1.3),
    }));

  const zoomOut = () =>
    setViewState((prev) => ({
      ...prev,
      scale: Math.max(MIN_SCALE, prev.scale / 1.3),
    }));

  const resetView = () => setViewState({ offsetX: 0, offsetY: 0, scale: 1 });

  // =============================================================================
  // RENDER
  // =============================================================================

  if (isLoading) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full", className)}>
        <Loader2 className="w-8 h-8 animate-spin text-neutral-500 mb-3" />
        <p className="text-sm text-gray-500 dark:text-neutral-400">Loading chat embeddings...</p>
      </div>
    );
  }

  if (embeddings.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full px-6", className)}>
        <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
          <MessageSquare className="w-8 h-8 text-neutral-500" />
        </div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-neutral-300 mb-2">
          No Chat Embeddings Yet
        </h3>
        <p className="text-xs text-gray-500 dark:text-neutral-400 text-center max-w-xs mb-4">
          Click the button below to index your existing chats, or new chats will be indexed automatically.
        </p>
        <button
          onClick={handleReindex}
          disabled={isReindexing}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
            isReindexing
              ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 cursor-wait"
              : "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200"
          )}
        >
          <RefreshCw className={cn("w-4 h-4", isReindexing && "animate-spin")} />
          {isReindexing ? "Indexing..." : "Index All Chats"}
        </button>
        {isReindexing && reindexProgress && (
          <div className="mt-4 w-full max-w-xs">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-neutral-400 mb-1">
              <span className="truncate max-w-[70%]">{reindexProgress.currentChat}</span>
              <span>{reindexProgress.current}/{reindexProgress.total}</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-neutral-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-neutral-900 dark:bg-neutral-100 transition-all duration-300 ease-out"
                style={{
                  width: reindexProgress.total > 0
                    ? `${(reindexProgress.current / reindexProgress.total) * 100}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Show message if embeddings exist but no cached projection
  if (cacheStatus === "missing" && points.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full px-6", className)}>
        <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <RefreshCw className="w-8 h-8 text-amber-500" />
        </div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-neutral-300 mb-2">
          Visualization Not Computed
        </h3>
        <p className="text-xs text-gray-500 dark:text-neutral-400 text-center max-w-xs mb-4">
          Chat embeddings exist but the visualization needs to be computed.
        </p>
        <button
          onClick={handleReindex}
          disabled={isReindexing}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
            isReindexing
              ? "bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-300 cursor-wait"
              : "bg-amber-500 text-white hover:bg-amber-600"
          )}
        >
          <RefreshCw className={cn("w-4 h-4", isReindexing && "animate-spin")} />
          {isReindexing ? "Computing..." : "Compute Visualization"}
        </button>
        {isReindexing && reindexProgress && (
          <div className="mt-4 w-full max-w-xs">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-neutral-400 mb-1">
              <span className="truncate max-w-[70%]">{reindexProgress.currentChat}</span>
              <span>{reindexProgress.current}/{reindexProgress.total}</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-neutral-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-300 ease-out"
                style={{
                  width: reindexProgress.total > 0
                    ? `${(reindexProgress.current / reindexProgress.total) * 100}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-900/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-neutral-400">
              {stats?.totalChunks || 0} points from {stats?.totalConversations || 0} chats
            </span>
            {cacheStatus === "cached" && (
              <span className="text-xs text-green-600 dark:text-green-400">(cached)</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-400 transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={zoomIn}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-400 transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={resetView}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-400 transition-colors"
              title="Reset view"
            >
              <Move className="w-4 h-4" />
            </button>
            <button
              onClick={loadEmbeddingsAndProjection}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-400 transition-colors"
              title="Refresh from cache"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleReindex}
              disabled={isReindexing}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all",
                isReindexing
                  ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-500 cursor-wait"
                  : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
              )}
              title="Reindex all chats"
            >
              <RefreshCw className={cn("w-3 h-3", isReindexing && "animate-spin")} />
              {isReindexing ? "..." : "Reindex"}
            </button>
          </div>
        </div>
        
        {/* Progress bar when reindexing */}
        {isReindexing && reindexProgress && (
          <div className="mt-2 px-3 pb-2">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-neutral-400 mb-1">
              <span className="truncate max-w-[70%]">{reindexProgress.currentChat}</span>
              <span>{reindexProgress.current}/{reindexProgress.total}</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-neutral-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-neutral-500 transition-all duration-300 ease-out"
                style={{
                  width: reindexProgress.total > 0
                    ? `${(reindexProgress.current / reindexProgress.total) * 100}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 bg-gray-50 dark:bg-neutral-900"
        />

        {/* Tooltip for hovered point - shows conversation title */}
        {hoveredPoint && !isDragging && (
          <div
            className="absolute z-10 pointer-events-none"
            style={{
              left: "50%",
              top: 8,
              transform: "translateX(-50%)",
            }}
          >
            <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 px-3 py-2 max-w-xs">
              <p className="text-xs font-medium text-gray-700 dark:text-neutral-300 truncate">
                {hoveredPoint.embedding.conversationTitle || "Untitled Chat"}
              </p>
              <p className="text-xs text-gray-500 dark:text-neutral-400">
                {hoveredPoint.embedding.messageRole === "user" ? "User message" : "Assistant message"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Selected point details */}
      {selectedPoint && (
        <div className="border-t border-gray-200 dark:border-neutral-700 p-3 bg-white dark:bg-neutral-800 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs font-medium text-gray-700 dark:text-neutral-300 truncate">
                From: {selectedPoint.embedding.conversationTitle || "Untitled Chat"}
              </p>
              <p className="text-xs text-gray-500 dark:text-neutral-400">
                {selectedPoint.embedding.messageRole === "user" ? "User" : "Assistant"} message
              </p>
            </div>
            <button
              onClick={() => setSelectedPoint(null)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300"
            >
              ×
            </button>
          </div>
          <p className="text-xs text-gray-600 dark:text-neutral-400 whitespace-pre-wrap line-clamp-6">
            {selectedPoint.embedding.chunkText}
          </p>
        </div>
      )}
    </div>
  );
}

export default ChatEmbeddingsViewer;
