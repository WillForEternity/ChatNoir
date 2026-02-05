/**
 * Reranker Module
 *
 * Provides a second-stage reranking step for RAG retrieval.
 * Cross-encoders process query-document pairs together, capturing
 * word-level interactions that bi-encoders (embeddings) miss.
 *
 * 2025 Best Practices:
 * - Reranking improves RAG accuracy by 20-40%
 * - Reduces hallucinations by up to 35%
 * - Use after initial retrieval (retrieve top-50, rerank to top-5)
 *
 * Supported backends (auto-selected based on available API keys):
 * 1. Cohere Rerank API - Best quality, purpose-built ($2/1000 searches)
 * 2. OpenAI GPT-4o-mini - Default fallback, uses existing OpenAI key
 * 3. None - Skip reranking (if no API keys available)
 *
 * Default behavior: If user has OpenAI key (required for embeddings),
 * reranking will automatically use GPT-4o-mini unless Cohere key is provided.
 */

import { getApiKeys } from "@/lib/api-keys";

/**
 * A document to be reranked.
 */
export interface RerankDocument {
  id: string;
  text: string;
  /** Original retrieval score (for fallback) */
  originalScore?: number;
  /** Additional metadata to preserve */
  metadata?: Record<string, unknown>;
}

/**
 * Result from reranking.
 */
export interface RerankResult {
  id: string;
  text: string;
  /** Relevance score from reranker (0-1) */
  relevanceScore: number;
  /** Original retrieval score */
  originalScore?: number;
  /** Position in reranked results */
  rank: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Reranker configuration.
 */
export interface RerankerConfig {
  /** Which reranking backend to use */
  backend: "cohere" | "openai" | "api" | "none";
  /** Cohere API key (optional, falls back to env) */
  cohereApiKey?: string;
  /** OpenAI API key (optional, falls back to env) */
  openaiApiKey?: string;
  /** Cohere model to use (default: rerank-v3.5) */
  cohereModel?: string;
  /** Number of results to return after reranking */
  topK?: number;
  /** Minimum relevance score to include */
  threshold?: number;
}

const DEFAULT_CONFIG: RerankerConfig = {
  backend: "none",
  cohereModel: "rerank-v3.5",
  topK: 5,
  threshold: 0.2, // Filter out results below 20% relevance
};

/**
 * Rerank documents using the specified backend.
 *
 * @param query - The search query
 * @param documents - Documents to rerank
 * @param config - Reranker configuration
 * @returns Reranked documents sorted by relevance
 */
export async function rerank(
  query: string,
  documents: RerankDocument[],
  config: Partial<RerankerConfig> = {}
): Promise<RerankResult[]> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  if (documents.length === 0) {
    return [];
  }

  // If no reranking backend available, use semantic scores from metadata if available
  // (RRF originalScore is typically very small ~0.01-0.03, not useful for display)
  if (finalConfig.backend === "none") {
    return documents.map((doc, index) => {
      // Try to get semantic score from metadata (more interpretable than RRF score)
      const semanticScore = (doc.metadata as Record<string, unknown>)?.semanticScore;
      const displayScore = typeof semanticScore === "number" ? semanticScore : (doc.originalScore ?? 0);
      
      return {
        id: doc.id,
        text: doc.text,
        relevanceScore: displayScore,
        originalScore: doc.originalScore,
        rank: index + 1,
        metadata: doc.metadata,
      };
    });
  }

  try {
    switch (finalConfig.backend) {
      case "cohere":
        return await rerankWithCohere(query, documents, finalConfig);
      case "openai":
        return await rerankWithOpenAI(query, documents, finalConfig);
      case "api":
        return await rerankWithAPI(query, documents, finalConfig);
      default:
        throw new Error(`Unknown reranker backend: ${finalConfig.backend}`);
    }
  } catch (error) {
    console.error("[Reranker] Error during reranking:", error);
    // Fallback to original order on error, use semantic scores if available
    return documents.map((doc, index) => {
      const semanticScore = (doc.metadata as Record<string, unknown>)?.semanticScore;
      const displayScore = typeof semanticScore === "number" ? semanticScore : (doc.originalScore ?? 0);
      
      return {
        id: doc.id,
        text: doc.text,
        relevanceScore: displayScore,
        originalScore: doc.originalScore,
        rank: index + 1,
        metadata: doc.metadata,
      };
    });
  }
}

/**
 * Rerank using Cohere Rerank API.
 *
 * Cohere's reranker is purpose-built for this task:
 * - Supports up to 32K token context (v4.0)
 * - Handles structured data (JSON fields)
 * - Fast and cost-effective
 */
async function rerankWithCohere(
  query: string,
  documents: RerankDocument[],
  config: RerankerConfig
): Promise<RerankResult[]> {
  const apiKey = config.cohereApiKey ?? getCohereKey();

  if (!apiKey) {
    throw new Error("Cohere API key is required for reranking. Add COHERE_API_KEY to your settings.");
  }

  const response = await fetch("https://api.cohere.com/v1/rerank", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.cohereModel ?? "rerank-v3.5",
      query,
      documents: documents.map((doc) => doc.text),
      top_n: config.topK ?? 5,
      return_documents: false,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Cohere rerank failed: ${error.message || response.statusText}`);
  }

  const data = await response.json();

  // Map results back to original documents
  const results: RerankResult[] = data.results.map(
    (result: { index: number; relevance_score: number }, rank: number) => {
      const doc = documents[result.index];
      return {
        id: doc.id,
        text: doc.text,
        relevanceScore: result.relevance_score,
        originalScore: doc.originalScore,
        rank: rank + 1,
        metadata: doc.metadata,
      };
    }
  );

  // Filter by threshold (config already has defaults merged from parent)
  return results.filter((r) => r.relevanceScore >= (config.threshold ?? 0));
}

/**
 * Rerank using OpenAI (LLM-as-reranker).
 *
 * Uses GPT to score document relevance.
 * Higher quality but more expensive and slower.
 */
async function rerankWithOpenAI(
  query: string,
  documents: RerankDocument[],
  config: RerankerConfig
): Promise<RerankResult[]> {
  const apiKey = config.openaiApiKey ?? getOpenAIKey();

  if (!apiKey) {
    throw new Error("OpenAI API key is required for reranking.");
  }

  // Score each document with GPT
  const scoredDocs = await Promise.all(
    documents.map(async (doc, index) => {
      try {
        const score = await scoreWithGPT(query, doc.text, apiKey);
        return {
          doc,
          score,
          index,
        };
      } catch (error) {
        console.error(`[Reranker] Failed to score document ${index}:`, error);
        return {
          doc,
          score: doc.originalScore ?? 0,
          index,
        };
      }
    })
  );

  // Sort by score and take top K
  const sorted = scoredDocs
    .sort((a, b) => b.score - a.score)
    .slice(0, config.topK ?? 5);

  return sorted
    .filter((item) => item.score >= (config.threshold ?? 0))
    .map((item, rank) => ({
      id: item.doc.id,
      text: item.doc.text,
      relevanceScore: item.score,
      originalScore: item.doc.originalScore,
      rank: rank + 1,
      metadata: item.doc.metadata,
    }));
}

/**
 * Rerank using the server-side API endpoint.
 * This allows owners to use their env-configured API keys.
 */
async function rerankWithAPI(
  query: string,
  documents: RerankDocument[],
  config: RerankerConfig
): Promise<RerankResult[]> {
  console.log("[Reranker] Using server-side API for reranking");
  
  // Get user's OpenAI key from localStorage (for non-owners)
  const keys = typeof window !== "undefined" ? getApiKeys() : {};
  
  const response = await fetch("/api/rerank", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(keys.openaiApiKey ? { "x-openai-api-key": keys.openaiApiKey } : {}),
    },
    body: JSON.stringify({
      query,
      documents: documents.map((doc) => ({
        id: doc.id,
        text: doc.text,
        originalScore: doc.originalScore,
        metadata: doc.metadata,
      })),
      topK: config.topK ?? 10,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Rerank API failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  return data.results as RerankResult[];
}

/**
 * Score a single document using GPT.
 */
async function scoreWithGPT(
  query: string,
  document: string,
  apiKey: string
): Promise<number> {
  // Truncate document if too long
  const maxDocLength = 2000;
  const truncatedDoc =
    document.length > maxDocLength
      ? document.slice(0, maxDocLength) + "..."
      : document;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a relevance scoring system for document retrieval. Given a search query and a document chunk, output ONLY a decimal number from 0.00 to 1.00 representing how relevant the document is to the query.

IMPORTANT: The query may be a question OR a topic/keyword search. Score based on topical relevance, not just whether the document directly "answers" the query.

Use the FULL scale - don't be overly conservative:
- 0.90-1.00: Excellent match - document is clearly about this exact topic/question
- 0.75-0.89: Strong match - document discusses the topic with substantial relevant content
- 0.55-0.74: Good match - document contains relevant information about the topic
- 0.35-0.54: Partial match - document touches on related concepts
- 0.15-0.34: Weak match - only peripheral connection to the query
- 0.00-0.14: No match - unrelated content

Example: Query "Sieve of Eratosthenes" + document about the sieve algorithm → 0.85-0.95
Example: Query "how does authentication work" + document explaining auth flows → 0.80-0.90

Output ONLY a decimal number like 0.73 or 0.85. Use two decimal places. No other text.`,
        },
        {
          role: "user",
          content: `Query: ${query}

Document: ${truncatedDoc}`,
        },
      ],
      max_tokens: 10,
      temperature: 0.0, // Deterministic for consistent scoring
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  const scoreStr = data.choices[0]?.message?.content?.trim() ?? "0";
  const score = parseFloat(scoreStr);

  return isNaN(score) ? 0 : Math.max(0, Math.min(1, score));
}

/**
 * Get Cohere API key from localStorage or environment.
 */
function getCohereKey(): string | undefined {
  if (typeof window !== "undefined") {
    const keys = getApiKeys();
    return keys.cohereApiKey;
  }
  return undefined;
}

/**
 * Get OpenAI API key from localStorage.
 */
function getOpenAIKey(): string | undefined {
  if (typeof window !== "undefined") {
    const keys = getApiKeys();
    return keys.openaiApiKey;
  }
  return undefined;
}

/**
 * Check if reranking is available with current configuration.
 */
export function isRerankingAvailable(): {
  cohere: boolean;
  openai: boolean;
  api: boolean;
} {
  const keys = typeof window !== "undefined" ? getApiKeys() : { cohereApiKey: undefined, openaiApiKey: undefined };
  return {
    cohere: !!keys.cohereApiKey,
    openai: !!keys.openaiApiKey,
    // API backend is always available (server handles auth/keys)
    api: typeof window !== "undefined",
  };
}

/**
 * Get recommended reranker based on available keys.
 * 
 * Priority:
 * 1. Cohere (purpose-built, fastest, most cost-effective for reranking) - if key in localStorage
 * 2. API (server-side, works for owners with env keys OR users with localStorage keys)
 * 3. OpenAI direct (client-side, only if key in localStorage)
 * 4. None (fallback, uses semantic scores)
 */
export function getRecommendedReranker(): RerankerConfig["backend"] {
  const available = isRerankingAvailable();
  // Prefer Cohere if user has it configured (fastest, purpose-built)
  if (available.cohere) return "cohere";
  // Use API backend by default - it handles both owners (env keys) and users (localStorage keys)
  if (available.api) return "api";
  // Direct OpenAI only if we have the key locally
  if (available.openai) return "openai";
  return "none";
}
