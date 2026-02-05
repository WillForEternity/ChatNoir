/**
 * Large Document Operations
 *
 * Core operations for uploading, indexing, and searching large documents.
 * Uses the same embedding infrastructure as the knowledge base but stores
 * documents in a separate database optimized for large file handling.
 *
 * 2025 Best Practices Applied:
 * - Chunk size: 512 tokens (optimal for fact-focused Q&A retrieval)
 * - Chunk overlap: 75 tokens (~15%, NVIDIA benchmark optimal)
 * - Optional reranking: Cross-encoder reranking for 20-40% accuracy boost
 * - Hybrid search with RRF fusion for better precision/recall balance
 */

import { getLargeDocumentsDb, removeDocumentUmapCache, storeDocumentFile, deleteDocumentFile, getDocumentFile } from "./idb";
import { chunkMarkdown, type ChunkOptions } from "../embeddings/chunker";
import { embedTexts, embedQuery } from "../embeddings/embed-client";
import { rerank, getRecommendedReranker, type RerankDocument, type RerankerConfig } from "../embeddings/reranker";
import { largeDocLexicalSearch, detectQueryType, type LargeDocLexicalResult } from "./lexical-search";
import type {
  LargeDocumentMetadata,
  LargeDocumentChunk,
  LargeDocumentSearchResult,
  IndexingProgress,
  LargeDocumentFile,
} from "./types";

/**
 * Default chunking options for large documents.
 * Optimized for document Q&A use cases.
 */
const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 512,      // Optimal for fact-focused retrieval
  overlapTokens: 75,   // ~15% overlap for context continuity
  minTokens: 50,       // Minimum chunk size
};

/**
 * Search options for large documents.
 */
export interface LargeDocumentSearchOptions {
  /** Number of results to return (default: 10) */
  topK?: number;
  /** Minimum similarity threshold (default: 0.3) */
  threshold?: number;
  /** Enable reranking for better accuracy (default: auto-detect) */
  rerank?: boolean;
  /** Reranker backend to use */
  rerankerBackend?: RerankerConfig["backend"];
  /** Number of candidates to retrieve before reranking (default: 50) */
  retrieveK?: number;
  /** Include matched terms in results */
  includeBreakdown?: boolean;
  /** RRF smoothing constant k (default: 60) */
  rrfK?: number;
}

/**
 * Generate a UUID for document IDs.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Compute SHA-256 hash for content change detection.
 */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

// =============================================================================
// PDF EXTRACTION
// =============================================================================

/**
 * Extract text from a PDF using PDF.js (client-side, free).
 * Returns null if the extracted text is too short (likely a scanned PDF).
 */
export async function extractPdfText(
  file: File
): Promise<{ text: string; numPages: number } | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
    
    // Configure worker if not already set
    // Use unpkg CDN with matching version to avoid version mismatch errors
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const pageTexts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: { str?: string }) => item.str || "")
        .join(" ");
      pageTexts.push(text);
    }

    const fullText = pageTexts.join("\n\n");
    
    // Check if we got meaningful text
    // Use 100 chars minimum, or 50 chars per page for multi-page docs
    const minChars = pdf.numPages > 1 ? Math.min(100, pdf.numPages * 50) : 50;
    
    if (fullText.trim().length < minChars) {
      console.log("[PDF] Text extraction yielded insufficient content, fallback needed");
      return null; // Signal that fallback is needed
    }

    console.log(`[PDF] Extracted ${fullText.length} chars from ${pdf.numPages} pages`);
    return { text: fullText, numPages: pdf.numPages };
  } catch (error) {
    console.error("[PDF] PDF.js extraction failed:", error);
    return null; // Signal fallback needed
  }
}

/**
 * Parse a scanned PDF using Claude Haiku via the /api/parse-pdf endpoint.
 * This is the fallback when PDF.js can't extract text.
 */
export async function parsePdfWithClaude(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  
  // Note: API key handling is done server-side based on auth context

  const response = await fetch("/api/parse-pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "PDF parsing with AI failed");
  }

  const { text } = await response.json();
  console.log(`[PDF] Claude extracted ${text.length} chars`);
  return text;
}

/**
 * Parse document content based on MIME type.
 * Currently supports plain text, markdown, and PDF.
 */
async function parseDocument(
  content: ArrayBuffer | string,
  mimeType: string
): Promise<string> {
  // Handle text-based formats
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  ) {
    if (typeof content === "string") {
      return content;
    }
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(content);
  }

  // PDF is now handled in uploadLargeDocument directly
  if (mimeType === "application/pdf") {
    throw new Error("PDF files should be processed via extractPdfText or parsePdfWithClaude");
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * Result of storing a document (fast operation).
 */
export interface StoredDocumentResult {
  metadata: LargeDocumentMetadata;
  fileData: ArrayBuffer;
}

/**
 * Store a large document for immediate viewing.
 * This is the fast path - stores file and metadata, returns immediately.
 * Call indexLargeDocumentInBackground() separately to index for search.
 *
 * @returns metadata and file data for immediate viewing
 */
export async function storeLargeDocument(
  file: File,
  description?: string
): Promise<StoredDocumentResult> {
  const db = await getLargeDocumentsDb();
  const documentId = generateId();
  const mimeType = file.type || "text/plain";

  // Create initial metadata with pending_index status
  const metadata: LargeDocumentMetadata = {
    id: documentId,
    filename: file.name,
    mimeType,
    fileSize: file.size,
    chunkCount: 0,
    uploadedAt: Date.now(),
    indexedAt: 0,
    description,
    status: "uploading", // Will be updated to "indexing" when background index starts
  };

  // Save initial metadata
  await db.put("documents", metadata);

  // Store original file for viewing
  const fileData = await file.arrayBuffer();
  await storeDocumentFile(documentId, fileData, mimeType);

  console.log(`[LargeDocs] Stored document ${documentId} for immediate viewing`);

  return { metadata, fileData };
}

/**
 * Index a document in the background after it's been stored.
 * This is the slow path - parses, chunks, and embeds the content.
 * The document must have already been stored via storeLargeDocument().
 *
 * @param documentId - ID of the already-stored document
 * @param file - Original file for text extraction
 * @param onProgress - Optional progress callback
 */
export async function indexLargeDocumentInBackground(
  documentId: string,
  file: File,
  onProgress?: (progress: IndexingProgress) => void
): Promise<LargeDocumentMetadata> {
  const db = await getLargeDocumentsDb();
  const mimeType = file.type || "text/plain";

  // Get existing metadata
  let metadata = await db.get("documents", documentId);
  if (!metadata) {
    throw new Error(`Document ${documentId} not found for indexing`);
  }

  try {
    // Update status to indexing
    metadata.status = "indexing";
    await db.put("documents", metadata);

    // Report parsing status
    onProgress?.({
      current: 0,
      total: 5,
      status: "parsing",
      message: "Parsing document...",
    });

    let content: string;

    // Handle PDF files specially
    if (mimeType === "application/pdf") {
      // Try PDF.js extraction first (free, fast)
      onProgress?.({
        current: 0,
        total: 5,
        status: "pdf-extraction",
        message: "Extracting text from PDF...",
      });

      const pdfResult = await extractPdfText(file);
      
      if (pdfResult) {
        // PDF.js extraction succeeded
        content = pdfResult.text;
      } else {
        // Fallback to Claude Haiku for scanned PDFs
        onProgress?.({
          current: 0.5,
          total: 5,
          status: "ai-extraction",
          message: "Using AI to extract text from scanned PDF...",
        });
        
        content = await parsePdfWithClaude(file);
      }
    } else {
      // Read text-based file content directly
      content = await file.text();
    }

    // Report chunking status
    onProgress?.({
      current: 1,
      total: 5,
      status: "chunking",
      message: "Splitting into chunks...",
    });

    // Chunk the content with optimized settings for document Q&A
    const chunks = chunkMarkdown(content, DEFAULT_CHUNK_OPTIONS);

    if (chunks.length === 0) {
      throw new Error("Document produced no chunks. It may be empty.");
    }

    // Report embedding status
    onProgress?.({
      current: 2,
      total: 5,
      status: "embedding",
      message: `Embedding ${chunks.length} chunks...`,
    });

    // Embed chunks in batches (20 at a time to avoid API limits)
    const BATCH_SIZE = 20;
    const allChunkRecords: LargeDocumentChunk[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchTexts = batch.map((c) => c.text);

      // Embed the batch
      const embeddings = await embedTexts(batchTexts);

      // Create chunk records
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const chunkIndex = i + j;
        const contentHash = await sha256(chunk.text);

        const chunkRecord: LargeDocumentChunk = {
          id: `${documentId}#${chunkIndex}`,
          documentId,
          chunkIndex,
          chunkText: chunk.text,
          contentHash,
          headingPath: chunk.headingPath,
          embedding: embeddings[j],
          updatedAt: Date.now(),
        };

        allChunkRecords.push(chunkRecord);
      }

      // Update progress
      const progress = Math.min(
        2 + ((i + BATCH_SIZE) / chunks.length) * 2,
        4
      );
      onProgress?.({
        current: progress,
        total: 5,
        status: "embedding",
        message: `Embedded ${Math.min(i + BATCH_SIZE, chunks.length)} of ${chunks.length} chunks...`,
      });
    }

    // Store all chunks
    const tx = db.transaction("chunks", "readwrite");
    for (const record of allChunkRecords) {
      await tx.store.put(record);
    }
    await tx.done;

    // Update metadata with final stats
    metadata.chunkCount = allChunkRecords.length;
    metadata.indexedAt = Date.now();
    metadata.status = "ready";
    await db.put("documents", metadata);

    // Report complete
    onProgress?.({
      current: 5,
      total: 5,
      status: "complete",
      message: `Indexed ${allChunkRecords.length} chunks successfully`,
    });

    console.log(`[LargeDocs] Finished indexing document ${documentId}: ${allChunkRecords.length} chunks`);

    return metadata;
  } catch (error) {
    // Update metadata with error (but keep file viewable)
    metadata.status = "error";
    metadata.errorMessage =
      error instanceof Error ? error.message : String(error);
    await db.put("documents", metadata);

    onProgress?.({
      current: 0,
      total: 5,
      status: "error",
      message: metadata.errorMessage,
    });

    console.error(`[LargeDocs] Indexing failed for document ${documentId}:`, error);
    throw error;
  }
}

/**
 * Upload and index a large document.
 * This is the legacy combined function that stores and indexes synchronously.
 * For immediate viewing with background indexing, use storeLargeDocument() 
 * followed by indexLargeDocumentInBackground().
 *
 * Process:
 * 1. Store file for viewing (fast)
 * 2. Parse document content to text (with PDF extraction if needed)
 * 3. Chunk the text using the markdown chunker
 * 4. Embed all chunks in batches
 * 5. Store chunks with embeddings
 */
export async function uploadLargeDocument(
  file: File,
  description?: string,
  onProgress?: (progress: IndexingProgress) => void
): Promise<LargeDocumentMetadata> {
  // Store the document first (fast)
  const { metadata } = await storeLargeDocument(file, description);
  
  // Then index it (slow) - this blocks until complete for legacy compatibility
  return indexLargeDocumentInBackground(metadata.id, file, onProgress);
}

/**
 * Upload a large document from text content (for pre-parsed PDFs).
 */
export async function uploadLargeDocumentFromText(
  filename: string,
  content: string,
  mimeType: string = "text/plain",
  description?: string,
  onProgress?: (progress: IndexingProgress) => void
): Promise<LargeDocumentMetadata> {
  // Create a File-like object for the upload function
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });
  return uploadLargeDocument(file, description, onProgress);
}

/**
 * Delete a large document and all its chunks.
 */
export async function deleteLargeDocument(documentId: string): Promise<void> {
  const db = await getLargeDocumentsDb();

  // Delete all chunks for this document
  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);
  const chunkTx = db.transaction("chunks", "readwrite");
  for (const chunk of chunks) {
    await chunkTx.store.delete(chunk.id);
  }
  await chunkTx.done;

  // Delete the document metadata
  await db.delete("documents", documentId);

  // Delete the original file data
  await deleteDocumentFile(documentId);

  // Remove cached UMAP projection for this document
  await removeDocumentUmapCache(documentId);
}

/**
 * Get the original file data for viewing a document.
 */
export async function getLargeDocumentFile(
  documentId: string
): Promise<LargeDocumentFile | undefined> {
  return getDocumentFile(documentId);
}

/**
 * Load document content by reconstructing from stored chunks.
 * Used for text viewer when original file isn't needed.
 */
export async function loadDocumentContent(documentId: string): Promise<string> {
  const db = await getLargeDocumentsDb();
  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);
  
  // Sort by chunk index
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  
  // Reconstruct content (note: this won't perfectly restore original due to chunking overlap)
  return chunks.map(c => c.chunkText).join("\n\n");
}

/**
 * Rename a large document.
 */
export async function renameLargeDocument(
  documentId: string,
  newFilename: string
): Promise<LargeDocumentMetadata | undefined> {
  const db = await getLargeDocumentsDb();

  const doc = await db.get("documents", documentId);
  if (!doc) {
    return undefined;
  }

  // Update the filename
  doc.filename = newFilename.trim();
  await db.put("documents", doc);

  return doc;
}

/**
 * Get all uploaded documents.
 */
export async function getAllLargeDocuments(): Promise<LargeDocumentMetadata[]> {
  const db = await getLargeDocumentsDb();
  return db.getAll("documents");
}

/**
 * Get a single document by ID.
 */
export async function getLargeDocument(
  documentId: string
): Promise<LargeDocumentMetadata | undefined> {
  const db = await getLargeDocumentsDb();
  return db.get("documents", documentId);
}

/**
 * Compute RRF score from ranks.
 * RRF(d) = Σ 1/(k + rank(d))
 */
function computeRRFScore(
  semanticRank: number | null,
  lexicalRank: number | null,
  k: number = 60
): number {
  let score = 0;
  if (semanticRank !== null) {
    score += 1 / (k + semanticRank);
  }
  if (lexicalRank !== null) {
    score += 1 / (k + lexicalRank);
  }
  return score;
}

/**
 * Search across all large documents using hybrid search (lexical + semantic + RRF).
 *
 * This is the core RAG search function that Claude will use.
 *
 * Pipeline:
 * 1. Run lexical search → ranked list
 * 2. Run semantic search → ranked list  
 * 3. Compute RRF fusion scores
 * 4. (Optional) Rerank top candidates with cross-encoder for better accuracy
 * 5. Return final results with matched terms
 */
export async function searchLargeDocuments(
  query: string,
  topKOrOptions: number | LargeDocumentSearchOptions = 10,
  threshold: number = 0.3
): Promise<LargeDocumentSearchResult[]> {
  // Support both legacy (topK, threshold) and new (options) signatures
  const options: LargeDocumentSearchOptions =
    typeof topKOrOptions === "number"
      ? { topK: topKOrOptions, threshold }
      : topKOrOptions;

  const {
    topK = 10,
    threshold: minThreshold = 0.3,
    rerank: enableRerank,
    rerankerBackend,
    retrieveK = 50, // Retrieve more candidates when reranking
    includeBreakdown = false,
    rrfK = 60,
  } = options;

  const db = await getLargeDocumentsDb();

  // Get all chunks
  const allChunks = await db.getAll("chunks");

  if (allChunks.length === 0) {
    return [];
  }

  // Get all document metadata for filename lookup
  const allDocs = await db.getAll("documents");
  const docMap = new Map<string, LargeDocumentMetadata>();
  for (const doc of allDocs) {
    docMap.set(doc.id, doc);
  }

  // Detect query type
  const queryType = detectQueryType(query);

  // Run lexical search
  const lexicalResults = largeDocLexicalSearch(query, allChunks);
  const lexicalRanks = new Map<string, number>();
  const lexicalScoresMap = new Map<string, LargeDocLexicalResult>();
  lexicalResults.forEach((result, index) => {
    lexicalRanks.set(result.chunk.id, index + 1); // 1-indexed rank
    lexicalScoresMap.set(result.chunk.id, result);
  });

  // Embed the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[LargeDocs] Failed to embed query:", error);
    // Fall back to lexical-only if embedding fails
    return lexicalResults.slice(0, topK).map((r) => {
      const doc = docMap.get(r.chunk.documentId);
      return {
        documentId: r.chunk.documentId,
        filename: doc?.filename || "Unknown Document",
        chunkText: r.chunk.chunkText,
        headingPath: r.chunk.headingPath,
        score: r.lexicalScore,
        chunkIndex: r.chunk.chunkIndex,
        matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
        queryType: includeBreakdown ? queryType : undefined,
      };
    });
  }

  // Compute semantic scores and create ranked list
  const semanticScored: Array<{ chunk: LargeDocumentChunk; score: number }> = [];
  for (const chunk of allChunks) {
    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
    semanticScored.push({ chunk, score: similarity });
  }

  // Sort by semantic score to get ranks
  semanticScored.sort((a, b) => b.score - a.score);

  const semanticRanks = new Map<string, number>();
  const rawSemanticScores = new Map<string, number>();
  semanticScored.forEach((item, index) => {
    semanticRanks.set(item.chunk.id, index + 1); // 1-indexed rank
    rawSemanticScores.set(item.chunk.id, item.score);
  });

  // Combine using RRF
  const combinedResults: Array<{
    chunk: LargeDocumentChunk;
    rrfScore: number;
    semanticScore: number;
    lexicalScore: number;
    matchedTerms: string[];
  }> = [];

  for (const chunk of allChunks) {
    const id = chunk.id;
    const semanticRank = semanticRanks.get(id) ?? null;
    const lexicalRank = lexicalRanks.get(id) ?? null;
    const semanticScore = rawSemanticScores.get(id) ?? 0;
    const lexicalResult = lexicalScoresMap.get(id);
    const lexicalScore = lexicalResult?.lexicalScore ?? 0;
    const matchedTerms = lexicalResult?.matchedTerms ?? [];

    const rrfScore = computeRRFScore(semanticRank, lexicalRank, rrfK);

    combinedResults.push({
      chunk,
      rrfScore,
      semanticScore,
      lexicalScore,
      matchedTerms,
    });
  }

  // Sort by RRF score
  combinedResults.sort((a, b) => b.rrfScore - a.rrfScore);

  // Determine if we should rerank
  const shouldRerank = enableRerank ?? (getRecommendedReranker() !== "none");
  const candidateCount = shouldRerank ? retrieveK : topK;

  // Get candidates
  const candidates = combinedResults.slice(0, candidateCount);

  // Filter by semantic threshold
  const filtered = candidates.filter((r) => r.semanticScore >= minThreshold);

  if (filtered.length === 0) {
    return [];
  }

  // Apply reranking if enabled
  if (shouldRerank && filtered.length > 1) {
    const rerankDocs: RerankDocument[] = filtered.map((r) => ({
      id: r.chunk.id,
      text: r.chunk.chunkText,
      originalScore: r.rrfScore,
      metadata: {
        documentId: r.chunk.documentId,
        chunkIndex: r.chunk.chunkIndex,
        headingPath: r.chunk.headingPath,
        semanticScore: r.semanticScore,
        lexicalScore: r.lexicalScore,
        matchedTerms: r.matchedTerms,
      },
    }));

    try {
      const reranked = await rerank(query, rerankDocs, {
        backend: rerankerBackend ?? getRecommendedReranker(),
        topK,
      });

      // Build results from reranked list
      return reranked.map((r) => {
        const meta = r.metadata as {
          documentId: string;
          chunkIndex: number;
          headingPath: string;
          semanticScore: number;
          lexicalScore: number;
          matchedTerms: string[];
        };
        const doc = docMap.get(meta.documentId);
        return {
          documentId: meta.documentId,
          filename: doc?.filename || "Unknown Document",
          chunkText: r.text,
          headingPath: meta.headingPath,
          score: Math.round(r.relevanceScore * 100) / 100,
          chunkIndex: meta.chunkIndex,
          reranked: true,
          matchedTerms: includeBreakdown ? meta.matchedTerms : undefined,
          queryType: includeBreakdown ? queryType : undefined,
        };
      });
    } catch (error) {
      console.error("[LargeDocs] Reranking failed, falling back to RRF scores:", error);
      // Fall through to non-reranked results
    }
  }

  // Return results without reranking (take topK)
  const finalResults = filtered.slice(0, topK);

  return finalResults.map((r) => {
    const doc = docMap.get(r.chunk.documentId);
    return {
      documentId: r.chunk.documentId,
      filename: doc?.filename || "Unknown Document",
      chunkText: r.chunk.chunkText,
      headingPath: r.chunk.headingPath,
      score: Math.round(r.semanticScore * 100) / 100,
      chunkIndex: r.chunk.chunkIndex,
      reranked: false,
      matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
      queryType: includeBreakdown ? queryType : undefined,
    };
  });
}

/**
 * Search a specific document only using hybrid search.
 */
export async function searchLargeDocument(
  documentId: string,
  query: string,
  topKOrOptions: number | LargeDocumentSearchOptions = 10,
  threshold: number = 0.3
): Promise<LargeDocumentSearchResult[]> {
  // Support both legacy and new signatures
  const options: LargeDocumentSearchOptions =
    typeof topKOrOptions === "number"
      ? { topK: topKOrOptions, threshold }
      : topKOrOptions;

  const {
    topK = 10,
    threshold: minThreshold = 0.3,
    rerank: enableRerank,
    rerankerBackend,
    retrieveK = 50,
    includeBreakdown = false,
    rrfK = 60,
  } = options;

  const db = await getLargeDocumentsDb();

  // Get chunks for this document only
  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);

  if (chunks.length === 0) {
    return [];
  }

  // Get document metadata
  const doc = await db.get("documents", documentId);

  // Detect query type
  const queryType = detectQueryType(query);

  // Run lexical search on this document's chunks
  const lexicalResults = largeDocLexicalSearch(query, chunks);
  const lexicalRanks = new Map<string, number>();
  const lexicalScoresMap = new Map<string, LargeDocLexicalResult>();
  lexicalResults.forEach((result, index) => {
    lexicalRanks.set(result.chunk.id, index + 1);
    lexicalScoresMap.set(result.chunk.id, result);
  });

  // Embed the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[LargeDocs] Failed to embed query:", error);
    // Fall back to lexical-only
    return lexicalResults.slice(0, topK).map((r) => ({
      documentId,
      filename: doc?.filename || "Unknown Document",
      chunkText: r.chunk.chunkText,
      headingPath: r.chunk.headingPath,
      score: r.lexicalScore,
      chunkIndex: r.chunk.chunkIndex,
      matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
      queryType: includeBreakdown ? queryType : undefined,
    }));
  }

  // Compute semantic scores and ranks
  const semanticScored: Array<{ chunk: LargeDocumentChunk; score: number }> = [];
  for (const chunk of chunks) {
    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
    semanticScored.push({ chunk, score: similarity });
  }
  semanticScored.sort((a, b) => b.score - a.score);

  const semanticRanks = new Map<string, number>();
  const rawSemanticScores = new Map<string, number>();
  semanticScored.forEach((item, index) => {
    semanticRanks.set(item.chunk.id, index + 1);
    rawSemanticScores.set(item.chunk.id, item.score);
  });

  // Combine using RRF
  const combinedResults: Array<{
    chunk: LargeDocumentChunk;
    rrfScore: number;
    semanticScore: number;
    lexicalScore: number;
    matchedTerms: string[];
  }> = [];

  for (const chunk of chunks) {
    const id = chunk.id;
    const semanticRank = semanticRanks.get(id) ?? null;
    const lexicalRank = lexicalRanks.get(id) ?? null;
    const semanticScore = rawSemanticScores.get(id) ?? 0;
    const lexicalResult = lexicalScoresMap.get(id);
    const lexicalScore = lexicalResult?.lexicalScore ?? 0;
    const matchedTerms = lexicalResult?.matchedTerms ?? [];

    const rrfScore = computeRRFScore(semanticRank, lexicalRank, rrfK);

    combinedResults.push({
      chunk,
      rrfScore,
      semanticScore,
      lexicalScore,
      matchedTerms,
    });
  }

  // Sort by RRF score
  combinedResults.sort((a, b) => b.rrfScore - a.rrfScore);

  // Determine if we should rerank
  const shouldRerank = enableRerank ?? (getRecommendedReranker() !== "none");
  const candidateCount = shouldRerank ? retrieveK : topK;
  const candidates = combinedResults.slice(0, candidateCount);

  // Filter by semantic threshold
  const filtered = candidates.filter((r) => r.semanticScore >= minThreshold);

  if (filtered.length === 0) {
    return [];
  }

  // Apply reranking if enabled
  if (shouldRerank && filtered.length > 1) {
    const rerankDocs: RerankDocument[] = filtered.map((r) => ({
      id: r.chunk.id,
      text: r.chunk.chunkText,
      originalScore: r.rrfScore,
      metadata: {
        chunkIndex: r.chunk.chunkIndex,
        headingPath: r.chunk.headingPath,
        semanticScore: r.semanticScore,
        lexicalScore: r.lexicalScore,
        matchedTerms: r.matchedTerms,
      },
    }));

    try {
      const reranked = await rerank(query, rerankDocs, {
        backend: rerankerBackend ?? getRecommendedReranker(),
        topK,
      });

      return reranked.map((r) => {
        const meta = r.metadata as {
          chunkIndex: number;
          headingPath: string;
          matchedTerms: string[];
        };
        return {
          documentId,
          filename: doc?.filename || "Unknown Document",
          chunkText: r.text,
          headingPath: meta.headingPath,
          score: Math.round(r.relevanceScore * 100) / 100,
          chunkIndex: meta.chunkIndex,
          reranked: true,
          matchedTerms: includeBreakdown ? meta.matchedTerms : undefined,
          queryType: includeBreakdown ? queryType : undefined,
        };
      });
    } catch (error) {
      console.error("[LargeDocs] Reranking failed:", error);
      // Fall through to non-reranked results
    }
  }

  // Return results without reranking
  return filtered.slice(0, topK).map((r) => ({
    documentId,
    filename: doc?.filename || "Unknown Document",
    chunkText: r.chunk.chunkText,
    headingPath: r.chunk.headingPath,
    score: Math.round(r.semanticScore * 100) / 100,
    chunkIndex: r.chunk.chunkIndex,
    reranked: false,
    matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
    queryType: includeBreakdown ? queryType : undefined,
  }));
}

/**
 * Get statistics about large documents.
 */
export async function getLargeDocumentStats(): Promise<{
  totalDocuments: number;
  totalChunks: number;
  totalSize: number;
  documents: Array<{ id: string; filename: string; chunkCount: number; fileSize: number }>;
}> {
  const db = await getLargeDocumentsDb();
  const docs = await db.getAll("documents");

  return {
    totalDocuments: docs.length,
    totalChunks: docs.reduce((sum, doc) => sum + doc.chunkCount, 0),
    totalSize: docs.reduce((sum, doc) => sum + doc.fileSize, 0),
    documents: docs.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      chunkCount: doc.chunkCount,
      fileSize: doc.fileSize,
    })),
  };
}
