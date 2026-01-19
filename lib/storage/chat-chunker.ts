/**
 * Chat Message Chunker
 *
 * Chunks chat messages for embedding, preserving role context.
 * Unlike markdown files, chats need message-aware chunking:
 * - Each message becomes 1+ chunks (split if too long)
 * - Prefix with role context for better semantic understanding
 * - Skip tool calls and system messages
 */

import type { UIMessage } from "ai";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A chunk from a chat message, ready for embedding.
 */
export interface ChatChunk {
  /** The text content of the chunk */
  text: string;
  /** Position of this chunk in the overall conversation */
  index: number;
  /** Role of the original message */
  messageRole: "user" | "assistant";
  /** Index of the message in the conversation (0-based) */
  messageIndex: number;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Estimate token count (rough: 1 token ≈ 4 chars for English).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text by sentences for chunk splitting.
 */
function splitBySentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Split text by paragraphs.
 */
function splitByParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Extract plain text content from a UIMessage.
 * Handles the parts array structure and filters out non-text content.
 */
function extractTextFromMessage(message: UIMessage): string {
  if (!message.parts || message.parts.length === 0) {
    // Fallback to content if parts is empty
    return typeof message.content === "string" ? message.content : "";
  }

  const textParts: string[] = [];

  for (const part of message.parts) {
    if (part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text);
    }
    // Skip tool-invocation, tool-result, reasoning, etc.
  }

  return textParts.join("\n\n");
}

/**
 * Check if a message should be included in embeddings.
 */
function shouldIncludeMessage(message: UIMessage): boolean {
  // Only include user and assistant messages
  if (message.role !== "user" && message.role !== "assistant") {
    return false;
  }

  // Skip if no text content
  const text = extractTextFromMessage(message);
  if (!text.trim()) {
    return false;
  }

  return true;
}

// =============================================================================
// MAIN CHUNKING FUNCTION
// =============================================================================

/**
 * Chunk chat messages for embedding.
 *
 * Algorithm:
 * 1. Filter to user/assistant messages with text content
 * 2. For each message:
 *    - Prefix with role context: "[User]: " or "[Assistant]: "
 *    - If under maxTokens, keep as single chunk
 *    - If over, split on paragraph then sentence boundaries
 * 3. Return indexed chunks with metadata
 *
 * @param messages - Array of UIMessage from a conversation
 * @param maxTokens - Maximum tokens per chunk (default: 500)
 * @returns Array of ChatChunk ready for embedding
 */
export function chunkChatMessages(
  messages: UIMessage[],
  maxTokens = 500
): ChatChunk[] {
  const chunks: ChatChunk[] = [];
  let messageIndex = 0;

  for (const message of messages) {
    if (!shouldIncludeMessage(message)) {
      continue;
    }

    const role = message.role as "user" | "assistant";
    const rawText = extractTextFromMessage(message);
    const rolePrefix = role === "user" ? "[User]: " : "[Assistant]: ";

    // Add role prefix to first chunk of each message
    const prefixedText = rolePrefix + rawText;

    // Check if it fits in one chunk
    if (estimateTokens(prefixedText) <= maxTokens) {
      chunks.push({
        text: prefixedText,
        index: chunks.length,
        messageRole: role,
        messageIndex,
      });
    } else {
      // Need to split - try paragraphs first, then sentences
      const paragraphs = splitByParagraphs(rawText);
      let currentChunk = rolePrefix;
      let isFirstChunk = true;

      for (const paragraph of paragraphs) {
        const toAdd = isFirstChunk ? paragraph : `\n\n${paragraph}`;
        const combined = currentChunk + toAdd;

        if (estimateTokens(combined) <= maxTokens) {
          currentChunk = combined;
          isFirstChunk = false;
        } else {
          // Save current chunk if non-empty
          if (currentChunk.trim() && currentChunk !== rolePrefix) {
            chunks.push({
              text: currentChunk.trim(),
              index: chunks.length,
              messageRole: role,
              messageIndex,
            });
          }

          // Check if paragraph itself is too large
          const paragraphWithPrefix = rolePrefix + paragraph;
          if (estimateTokens(paragraphWithPrefix) > maxTokens) {
            // Split by sentences
            const sentences = splitBySentences(paragraph);
            currentChunk = rolePrefix;
            isFirstChunk = true;

            for (const sentence of sentences) {
              const sentenceToAdd = isFirstChunk ? sentence : ` ${sentence}`;
              const sentenceCombined = currentChunk + sentenceToAdd;

              if (estimateTokens(sentenceCombined) <= maxTokens) {
                currentChunk = sentenceCombined;
                isFirstChunk = false;
              } else {
                if (currentChunk.trim() && currentChunk !== rolePrefix) {
                  chunks.push({
                    text: currentChunk.trim(),
                    index: chunks.length,
                    messageRole: role,
                    messageIndex,
                  });
                }
                currentChunk = rolePrefix + sentence;
                isFirstChunk = false;
              }
            }
          } else {
            currentChunk = paragraphWithPrefix;
            isFirstChunk = false;
          }
        }
      }

      // Don't forget the last chunk
      if (currentChunk.trim() && currentChunk !== rolePrefix) {
        chunks.push({
          text: currentChunk.trim(),
          index: chunks.length,
          messageRole: role,
          messageIndex,
        });
      }
    }

    messageIndex++;
  }

  // Re-index chunks sequentially
  chunks.forEach((chunk, i) => {
    chunk.index = i;
  });

  return chunks;
}

/**
 * Compute a hash of all message content for change detection.
 * Used to determine if a conversation needs re-embedding.
 */
export function computeConversationContentHash(messages: UIMessage[]): string {
  const relevantContent = messages
    .filter(shouldIncludeMessage)
    .map((m) => `${m.role}:${extractTextFromMessage(m)}`)
    .join("|");

  // Simple hash for quick comparison
  let hash = 0;
  for (let i = 0; i < relevantContent.length; i++) {
    const char = relevantContent.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}
