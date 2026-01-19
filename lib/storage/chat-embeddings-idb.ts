/**
 * Chat Embeddings IndexedDB Store
 *
 * Separate IndexedDB database for chat embeddings, isolated from the knowledge base.
 * This allows semantic search across all chat history.
 *
 * Key differences from knowledge embeddings:
 * - Indexed by conversationId (not file path)
 * - Stores conversation title for display
 * - Tracks message role (user/assistant)
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A chat embedding record stored in IndexedDB.
 * Similar to KB EmbeddingRecord but with chat-specific fields.
 */
export interface ChatEmbeddingRecord {
  /** Unique chunk id: `chat:${conversationId}#${chunkIndex}` */
  id: string;
  /** The conversation this chunk belongs to */
  conversationId: string;
  /** Title of the conversation (for display on hover) */
  conversationTitle: string;
  /** Position of this chunk in the conversation */
  chunkIndex: number;
  /** The actual text chunk */
  chunkText: string;
  /** SHA-256 hash of chunk text (for change detection) */
  contentHash: string;
  /** Role of the message this chunk came from */
  messageRole: "user" | "assistant";
  /** Index of the message in the conversation */
  messageIndex: number;
  /** 1536-dim embedding vector */
  embedding: number[];
  /** When this record was last updated */
  updatedAt: number;
  /** Source type - always "chat" for these records */
  source: "chat";
}

/**
 * Cached UMAP projection for chat embedding visualization.
 */
export interface ChatUmapCache {
  id: "chat_umap_projection";
  /** 2D coordinates for each embedding, indexed by embedding ID */
  points: Array<{ embeddingId: string; x: number; y: number }>;
  /** Timestamp of when this projection was computed */
  computedAt: number;
  /** Number of embeddings when projection was computed */
  embeddingCount: number;
}

/**
 * Chat search result returned from semantic search.
 */
export interface ChatSearchResult {
  conversationId: string;
  conversationTitle: string;
  chunkText: string;
  messageRole: "user" | "assistant";
  score: number;
  chunkIndex: number;
}

// =============================================================================
// DATABASE SCHEMA
// =============================================================================

interface ChatEmbeddingsDbSchema extends DBSchema {
  embeddings: {
    key: string;
    value: ChatEmbeddingRecord;
    indexes: {
      "by-chat": string; // for getting all embeddings for a conversation
      "by-hash": string; // for checking if chunk already embedded
    };
  };
  metadata: {
    key: string;
    value: ChatUmapCache;
  };
}

// =============================================================================
// DATABASE ACCESS
// =============================================================================

let dbPromise: Promise<IDBPDatabase<ChatEmbeddingsDbSchema>> | null = null;

/**
 * Get the chat embeddings database.
 * Creates it if it doesn't exist.
 */
export function getChatEmbeddingsDb() {
  if (!dbPromise) {
    dbPromise = openDB<ChatEmbeddingsDbSchema>("chat_embeddings_v1", 1, {
      upgrade(db, oldVersion, newVersion) {
        console.log(`[ChatEmbeddings DB] Upgrading from v${oldVersion} to v${newVersion}`);

        // Create embeddings store
        if (!db.objectStoreNames.contains("embeddings")) {
          console.log("[ChatEmbeddings DB] Creating embeddings store");
          const embeddingsStore = db.createObjectStore("embeddings", {
            keyPath: "id",
          });
          embeddingsStore.createIndex("by-chat", "conversationId", { unique: false });
          embeddingsStore.createIndex("by-hash", "contentHash", { unique: false });
        }

        // Create metadata store for UMAP cache
        if (!db.objectStoreNames.contains("metadata")) {
          console.log("[ChatEmbeddings DB] Creating metadata store");
          db.createObjectStore("metadata", { keyPath: "id" });
        }

        console.log("[ChatEmbeddings DB] Upgrade complete");
      },
    });
  }
  return dbPromise;
}

/**
 * Get all chat embeddings from the database.
 */
export async function getAllChatEmbeddings(): Promise<ChatEmbeddingRecord[]> {
  const db = await getChatEmbeddingsDb();
  return db.getAll("embeddings");
}

/**
 * Get embeddings for a specific conversation.
 */
export async function getChatEmbeddingsByConversation(
  conversationId: string
): Promise<ChatEmbeddingRecord[]> {
  const db = await getChatEmbeddingsDb();
  return db.getAllFromIndex("embeddings", "by-chat", conversationId);
}

/**
 * Get cached UMAP projection for chat embeddings.
 */
export async function getChatUmapCache(): Promise<ChatUmapCache | null> {
  const db = await getChatEmbeddingsDb();
  const cache = await db.get("metadata", "chat_umap_projection");
  return cache ?? null;
}

/**
 * Save UMAP projection to cache.
 */
export async function saveChatUmapCache(
  points: Array<{ embeddingId: string; x: number; y: number }>,
  embeddingCount: number
): Promise<void> {
  const db = await getChatEmbeddingsDb();
  await db.put("metadata", {
    id: "chat_umap_projection",
    points,
    computedAt: Date.now(),
    embeddingCount,
  });
}

/**
 * Clear UMAP projection cache.
 */
export async function clearChatUmapCache(): Promise<void> {
  const db = await getChatEmbeddingsDb();
  await db.delete("metadata", "chat_umap_projection");
}

/**
 * Get chat embedding statistics.
 */
export async function getChatEmbeddingStats(): Promise<{
  totalChunks: number;
  totalConversations: number;
  averageChunksPerConversation: number;
}> {
  const db = await getChatEmbeddingsDb();
  const allEmbeddings = await db.getAll("embeddings");
  const conversationIds = new Set(allEmbeddings.map((e) => e.conversationId));

  return {
    totalChunks: allEmbeddings.length,
    totalConversations: conversationIds.size,
    averageChunksPerConversation:
      conversationIds.size > 0
        ? Math.round((allEmbeddings.length / conversationIds.size) * 10) / 10
        : 0,
  };
}

/**
 * Clear all chat embeddings from the database.
 */
export async function clearAllChatEmbeddings(): Promise<void> {
  const db = await getChatEmbeddingsDb();
  const tx = db.transaction(["embeddings", "metadata"], "readwrite");
  await tx.objectStore("embeddings").clear();
  await tx.objectStore("metadata").clear();
  await tx.done;
  console.log("[ChatEmbeddings DB] Cleared all embeddings and cache");
}
