/**
 * Reranking API Endpoint
 *
 * Server-side endpoint for reranking search results using LLM.
 * This allows owners to use their env-configured API keys for reranking,
 * since the reranker can't access server-side env vars from the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, resolveApiKey } from "@/lib/auth-helper";

interface RerankRequest {
  query: string;
  documents: Array<{
    id: string;
    text: string;
    originalScore?: number;
    metadata?: Record<string, unknown>;
  }>;
  topK?: number;
}

interface RerankResult {
  id: string;
  text: string;
  relevanceScore: number;
  originalScore?: number;
  rank: number;
  metadata?: Record<string, unknown>;
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
      temperature: 0.0,
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

export async function POST(req: NextRequest) {
  try {
    const { isOwner } = await getAuthContext();
    
    // Get user-provided key from header (for non-owners)
    const userKey = req.headers.get("x-openai-api-key") || undefined;
    
    // Resolve which API key to use
    const apiKey = resolveApiKey(isOwner, userKey, process.env.OPENAI_API_KEY);
    
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key required for reranking" },
        { status: 401 }
      );
    }

    const body: RerankRequest = await req.json();
    const { query, documents, topK = 10 } = body;

    if (!query || !documents || documents.length === 0) {
      return NextResponse.json(
        { error: "Query and documents are required" },
        { status: 400 }
      );
    }

    // Score all documents in parallel
    const scoredDocs = await Promise.all(
      documents.map(async (doc, index) => {
        try {
          const score = await scoreWithGPT(query, doc.text, apiKey);
          return { doc, score, index };
        } catch (error) {
          console.error(`[Rerank API] Failed to score document ${index}:`, error);
          // Fall back to semantic score from metadata if available
          const semanticScore = (doc.metadata as Record<string, unknown>)?.semanticScore;
          const fallbackScore = typeof semanticScore === "number" ? semanticScore : (doc.originalScore ?? 0);
          return { doc, score: fallbackScore, index };
        }
      })
    );

    // Sort by score and take top K
    const sorted = scoredDocs
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Filter out very low scores
    const threshold = 0.15;
    const results: RerankResult[] = sorted
      .filter((item) => item.score >= threshold)
      .map((item, rank) => ({
        id: item.doc.id,
        text: item.doc.text,
        relevanceScore: item.score,
        originalScore: item.doc.originalScore,
        rank: rank + 1,
        metadata: item.doc.metadata,
      }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[Rerank API] Error:", error);
    return NextResponse.json(
      { error: "Reranking failed" },
      { status: 500 }
    );
  }
}
