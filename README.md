# ChatNoire

A modern, feature-rich AI chat application built with **Next.js 16**, **Vercel AI SDK v6**, and **Anthropic Claude Sonnet 4.5**.

ChatNoire provides a polished chat experience with a persistent knowledge filesystem, large document RAG, parallel context-saving agents, web search, file attachments, authentication, and more.

---

## Features

### Core Chat
- **Streaming Responses** — Real-time response streaming with stop functionality
- **Conversation History** — Automatically saves chats to IndexedDB with full CRUD support
- **Chat History Search** — Hybrid search (lexical + semantic + reranking) across past conversations
- **Parallel Chat Sessions** — Start new chats while responses are still streaming
- **Auto Title Generation** — AI-generated titles based on conversation content
- **Message Editing** — Edit previous messages and regenerate responses from that point

### Knowledge Filesystem
- **Persistent Storage** — Client-side IndexedDB storage that Claude can read/write via tools
- **Hybrid Search (RAG)** — Combines lexical + semantic search with RRF (Reciprocal Rank Fusion)
- **Knowledge Graph** — Create semantic relationships between files (extends, references, requires, contradicts, etc.)
- **Graph Traversal** — Navigate prerequisite chains, find related content, and detect contradictions
- **Sidebar Browser** — Visual file browser in the sidebar to explore your knowledge base
- **KB Summary Preload** — Hybrid context strategy with summary at prompt start for fast retrieval
- **Quote-Grounding** — Claude extracts quotes from files before synthesizing responses

### Large Document RAG
- **Upload Large Documents** — Upload PDFs, text files, and markdown for Q&A without loading into context
- **PDF Support** — Hybrid PDF extraction using PDF.js (free) with Claude Haiku fallback for scanned documents
- **Intelligent Quality Detection** — Automatically detects low-quality PDF.js extraction and falls back to AI OCR
- **Automatic Chunking** — Heading-aware chunking with 15% overlap to preserve context at boundaries
- **Hybrid Search** — Combines lexical (exact terms) + semantic (meaning) with RRF fusion
- **Cross-Encoder Reranking** — Optional reranking stage improves retrieval accuracy by 20-40%
- **Document Browser** — Visual browser to manage uploaded documents
- **Background Indexing** — Documents are indexed in the background; you can continue using the app while indexing completes

### Document Viewer
- **Full-Screen Viewer** — Cursor-style 3-panel layout with header bar showing document title and status
- **Native PDF Rendering** — View PDFs with page navigation and zoom controls using react-pdf
- **Screenshot Selection** — Drag to select any region, press Enter to capture and chat about it
- **Multiple Chat Tabs** — Open multiple chats side-by-side about different selections
- **Document Sidebar** — Switch between documents without leaving the viewer
- **Collapsible Panels** — Resize or collapse sidebars with intuitive icons and expand indicators
- **Chat Badge** — Collapsed chat panel shows badge with active chat count
- **Optional Viewing** — Document viewer opens only when you click the View button, not automatically on upload

### AI Capabilities
- **Web Search** — Anthropic's first-party web search tool for real-time information
- **Parallel Context Savers** — Spawn up to 6 background agents to save different categories simultaneously
- **Agent Orchestrator UI** — Visual slot-based progress indicator showing agent status
- **Multi-Model Support** — Choose between Haiku, Sonnet, and Opus tiers
- **Tool Support** — Extensible architecture for adding custom AI tools

### Authentication & BYOK
- **Better Auth** — OAuth authentication with GitHub and Google providers
- **Owner Mode** — Owner emails get free access using server-side API keys
- **BYOK (Bring Your Own Key)** — Non-owners can provide their own API keys via Settings
- **Per-User Key Storage** — API keys stored securely in localStorage, scoped per user

### UI/UX
- **Rich Markdown Rendering** — Headers, bold, italic, lists, tables, code blocks with syntax highlighting
- **LaTeX/KaTeX Support** — Mathematical equations rendered beautifully
- **Inline Icons** — Use `:IconName:` syntax for react-icons (Ionicons, FontAwesome, Material, etc.)
- **Dark/Light/System Theme** — Full theme support with system preference detection
- **Neumorphic Tool Cards** — Beautiful neumorphic design for tool execution visualizations
- **Collapsible Sidebar** — Clean UI with persistent sidebar state
- **Expandable Input** — Expand the text input for composing longer messages
- **Copy Code Blocks** — One-click copy for code snippets in responses

### File Handling
- **File Attachments** — Attach text files and PDFs (with automatic text extraction via pdfjs-dist)
- **Large Document Upload** — Upload documents for RAG-based Q&A

---

## Quick Start

### Step 1: Install Dependencies

```bash
pnpm install
# or
npm install
```

### Step 2: Get Your Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign in or create a free account
3. Navigate to **Settings** → **API Keys** (or go directly to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys))
4. Click **"Create Key"**
5. Copy the key — it will look like `sk-ant-api03-...`

> **Important:** You will only see the full key once. Save it somewhere safe!

### Step 3: Create Your Environment File

Copy the example file and fill in your values:

```bash
cp .env.local.example .env.local
```

**Required API Keys:**

```bash
# Anthropic API Key - for Claude chat
# Get yours at: https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# OpenAI API Key - for embeddings/semantic search
# Get yours at: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-your-key-here
```

**Authentication (Required for multi-user):**

```bash
# Secret key for signing sessions (generate with: openssl rand -base64 32)
BETTER_AUTH_SECRET=your-random-32-character-secret-here

# Base URL for auth callbacks
BETTER_AUTH_URL=http://localhost:3000

# GitHub OAuth (create at: https://github.com/settings/developers)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Google OAuth (create at: https://console.cloud.google.com/apis/credentials)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Owner emails - these users get free access to server API keys
OWNER_EMAILS=your@email.com
```

**Optional - Enhanced Reranking:**

```bash
# Cohere API Key - for cross-encoder reranking (improves RAG accuracy by 20-40%)
# Get yours at: https://dashboard.cohere.com/api-keys
# If not set, falls back to GPT-4o-mini reranking using your OpenAI key
COHERE_API_KEY=your-cohere-api-key-here
```

**Optional - Model Configuration:**

```bash
# Main chat model (default: claude-sonnet-4-5)
MAIN_MODEL=claude-sonnet-4-5

# Context Saver agent model (default: claude-sonnet-4-5)
CONTEXT_SAVER_MODEL=claude-sonnet-4-5
```

### Step 4: Start the Development Server

```bash
pnpm dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Project Structure

```
├── agents/                        # Agent definitions
│   ├── index.ts                  # Export all agents
│   ├── chat-agent.ts             # Main chat agent with ToolLoopAgent
│   └── context-saver-agent.ts    # Parallel context-saving agent
│
├── knowledge/                     # Knowledge Filesystem (client-side storage)
│   ├── index.ts                  # Public API exports
│   ├── idb.ts                    # IndexedDB schema and initialization
│   ├── operations.ts             # Filesystem operations (read, write, list, etc.)
│   ├── kb-summary.ts             # KB summary generator for hybrid preload
│   ├── types.ts                  # TypeScript types
│   ├── backup.ts                 # Backup/restore functionality
│   ├── embeddings/               # RAG semantic search system
│   │   ├── index.ts              # Embeddings public API
│   │   ├── operations.ts         # Embedding & search operations
│   │   ├── hybrid-search.ts      # Lexical + semantic hybrid search with RRF
│   │   ├── lexical-search.ts     # BM25-style term matching
│   │   ├── chunker.ts            # Heading-aware chunker with overlap
│   │   ├── embed-client.ts       # OpenAI embedding API client
│   │   ├── reranker.ts           # Cross-encoder reranking (Cohere/OpenAI)
│   │   └── types.ts              # Embedding types
│   ├── links/                    # Knowledge Graph system
│   │   ├── index.ts              # Links public API
│   │   ├── operations.ts         # Link CRUD operations
│   │   ├── graph-traversal.ts    # BFS graph traversal
│   │   └── types.ts              # Link/graph types
│   └── large-documents/          # Large document RAG system
│       ├── index.ts              # Large docs public API
│       ├── idb.ts                # IndexedDB schema for documents + file storage
│       ├── operations.ts         # Upload, index, hybrid search, PDF extraction with quality detection
│       ├── lexical-search.ts     # BM25-style term matching for documents
│       └── types.ts              # Large document types
│
├── tools/                         # Tool definitions
│   ├── index.ts                  # Export all tools (createTools factory)
│   ├── knowledge-tools.ts        # Knowledge filesystem + graph tools (kb_list, kb_read, kb_link, kb_graph, etc.)
│   ├── document-search.ts        # Large document search tools
│   ├── save-to-context.ts        # Parallel context-saving tool
│   ├── web-search.ts             # Anthropic web search integration
│   └── example-weather.ts.example  # Example tool template
│
├── components/
│   ├── ai-chat.tsx               # Main chat UI component
│   ├── chat-sidebar.tsx          # Sidebar with conversation history & KB browser
│   ├── knowledge-browser.tsx     # Knowledge filesystem browser UI
│   ├── knowledge-graph-viewer.tsx # Interactive knowledge graph visualization
│   ├── large-document-browser.tsx # Large document upload/manage UI (background indexing)
│   ├── chat/                     # Shared chat components (reused by main chat & document viewer)
│   │   ├── index.ts              # Public exports
│   │   ├── markdown-content.tsx  # Markdown/LaTeX/code rendering with syntax highlighting
│   │   ├── tool-invocation.tsx   # Tool call UI rendering
│   │   └── chat-message.tsx      # Complete message rendering (text, tools, files)
│   ├── document-viewer/          # Full-screen document viewer
│   │   ├── index.tsx             # Main 3-panel layout with header bar and react-resizable-panels
│   │   ├── pdf-viewer.tsx        # PDF rendering with native canvas screenshot capture
│   │   ├── text-viewer.tsx       # Markdown/text rendering with text selection
│   │   ├── chat-panel.tsx        # Tabbed chat container
│   │   ├── chat-instance.tsx     # Individual margin chat (Sonnet model, supports text & image)
│   │   └── document-sidebar.tsx  # Document list sidebar with collapsible expand indicator
│   ├── embeddings-viewer.tsx     # KB embeddings debug viewer
│   ├── document-embeddings-viewer.tsx # Document embeddings debug viewer
│   ├── chat-embeddings-viewer.tsx # Chat embeddings debug viewer
│   ├── theme-provider.tsx        # Theme context provider
│   ├── tools/                    # Tool-specific UI components
│   │   ├── agent-orchestrator-view.tsx  # Visual agent progress slots
│   │   ├── context-saver-view.tsx       # Context saver streaming display
│   │   ├── knowledge-tool-view.tsx      # KB tool result cards
│   │   ├── knowledge-link-tool-view.tsx # Knowledge graph link result cards
│   │   ├── document-search-view.tsx     # Large doc search results
│   │   ├── chat-search-view.tsx         # Chat history search results
│   │   ├── web-search-view.tsx          # Web search result display
│   │   ├── chunk-viewer-modal.tsx       # Chunk detail modal
│   │   └── generic-tool-view.tsx        # Fallback for unknown tools
│   └── ui/                       # shadcn/ui components
│
├── lib/
│   ├── auth.ts                   # Better Auth server configuration
│   ├── auth-client.ts            # Better Auth client
│   ├── auth-helper.ts            # Auth utilities for API routes
│   ├── api-keys.ts               # BYOK API key management
│   ├── use-chat-history.ts       # Chat history hook
│   ├── chat-types.ts             # Chat-related types
│   ├── storage/                  # Storage utilities
│   │   ├── chat-store.ts         # Chat storage operations
│   │   ├── chat-chunker.ts       # Chat message chunking with overlap
│   │   ├── chat-embeddings-idb.ts # Chat embeddings IndexedDB
│   │   ├── chat-embeddings-ops.ts # Chat embeddings operations
│   │   ├── chat-lexical-search.ts # BM25-style term matching for chat
│   │   └── chat-hybrid-search.ts  # Hybrid search for chat (lexical + semantic + RRF)
│   └── utils.ts                  # Utility functions
│
├── app/
│   ├── api/
│   │   ├── auth/[...all]/route.ts  # Better Auth catch-all route
│   │   ├── chat/route.ts           # Main chat API endpoint
│   │   ├── embed/route.ts          # Embedding API endpoint
│   │   ├── context-saver/route.ts  # Context saver agent endpoint
│   │   ├── generate-title/route.ts # Auto title generation endpoint
│   │   └── parse-pdf/route.ts      # Claude Haiku PDF extraction fallback (uses free trial)
│   ├── page.tsx                  # Main page
│   ├── layout.tsx                # Root layout
│   └── globals.css               # Global styles
│
├── docs/                          # Technical documentation
│   ├── RAG_SEMANTIC_SEARCH.md        # Hybrid search implementation details
│   ├── UNIFIED_SEARCH_PLAN.md        # Unified hybrid search across all tools
│   ├── CROSS_CHAT_CONTEXT_SYSTEM.md  # Cross-chat context system docs
│   └── KNOWLEDGE_FILESYSTEM_REFACTOR.md
│
└── .env.local                    # Your environment variables (create this!)
```

---

## Knowledge Filesystem

ChatNoire includes a **Knowledge Filesystem** — a persistent client-side storage system that Claude can read and write via tools. This allows the AI to remember information about you across conversations.

### How It Works

The Knowledge Filesystem is stored in **IndexedDB** in your browser, providing fast, local access without any API calls. Claude has access to tools for managing your knowledge base:

| Tool | Description |
|------|-------------|
| `kb_list(path)` | List folder contents |
| `kb_read(path)` | Read a file's contents |
| `kb_write(path, content)` | Create or overwrite a file |
| `kb_append(path, content)` | Append to a file |
| `kb_mkdir(path)` | Create a folder |
| `kb_delete(path)` | Delete a file or folder |
| `kb_search(query, topK?)` | Hybrid search across all files (lexical + semantic) |
| `kb_link(source, target, relationship)` | Create a relationship between two files |
| `kb_unlink(source, target, relationship)` | Remove a relationship |
| `kb_links(path)` | Query all links for a file (incoming and outgoing) |
| `kb_graph(startPath, depth?, relationship?, direction?)` | Traverse the knowledge graph |

### Parallel Context Saving

When you share information, Claude can spawn **parallel context saver agents** (up to 6) to organize and save different categories simultaneously:

| Tool | Description |
|------|-------------|
| `save_to_context(information, context?)` | Spawn a background agent to save one category |

For example, if you say "I'm John, a software engineer at Google, and I prefer dark mode", Claude will spawn 3 parallel agents:
1. Personal info agent → saves name
2. Work info agent → saves job details
3. Preferences agent → saves UI preferences

The UI shows a beautiful slot-based progress indicator that fills as agents complete.

### Hybrid Search (RAG)

ChatNoire uses a **hybrid search** system that combines lexical and semantic approaches for optimal retrieval:

**Why hybrid?** Dense embeddings alone miss exact term matches (like error codes or API names), while keyword search alone misses conceptual relationships. Hybrid search gives you both.

#### Search Pipeline

1. **Lexical Search** — BM25-style term matching with TF-IDF scoring
2. **Semantic Search** — OpenAI embeddings for meaning-based retrieval
3. **RRF Fusion** — Reciprocal Rank Fusion combines both result lists
4. **Reranking** (optional) — Cross-encoder reranks top candidates for 20-40% accuracy boost

#### Reciprocal Rank Fusion (RRF)

RRF is the 2025 industry standard for combining search results. Unlike weighted scores, RRF uses **ranks** not scores, making it robust across different scoring systems:

```
RRF(d) = 1/(k + semantic_rank) + 1/(k + lexical_rank)
```

Documents that appear in both lexical AND semantic results get boosted.

#### Cross-Encoder Reranking

After initial retrieval, a cross-encoder model reranks the top candidates by examining query-document pairs together. This captures word-level interactions that bi-encoders miss.

| Backend | Quality | Cost | Notes |
|---------|---------|------|-------|
| **Cohere** | Best | $2/1000 searches | Purpose-built, fastest |
| **GPT-4o-mini** | Good | ~$0.15/1M tokens | Default if no Cohere key |
| **None** | Baseline | Free | Skip reranking |

> **Note:** Requires `OPENAI_API_KEY` for embeddings. Reranking uses GPT-4o-mini by default, or Cohere if `COHERE_API_KEY` is set.

### Unified Search Across All Tools

All three search tools share the same hybrid search pipeline:

| Feature | KB Search | Chat Search | Document Search |
|---------|-----------|-------------|-----------------|
| Semantic search (embeddings) | ✅ | ✅ | ✅ |
| Lexical/term matching | ✅ | ✅ | ✅ |
| Hybrid fusion (RRF) | ✅ | ✅ | ✅ |
| Cross-encoder reranking | ✅ | ✅ | ✅ |
| Retrieve-then-rerank (50→topK) | ✅ | ✅ | ✅ |
| Query type detection | ✅ | ✅ | ✅ |
| Chunk overlap (~15%) | ✅ | ✅ | ✅ |
| Matched terms in results | ✅ | ✅ | ✅ |

This ensures consistent behavior and accuracy regardless of which search tool Claude uses.

Additionally, the **Knowledge Graph** provides relationship-based retrieval via `kb_links` and `kb_graph`, complementing the search-based approach with structural navigation.

### Hybrid Preload Strategy

ChatNoire uses a hybrid context strategy for optimal performance:
- **Summary at start**: A compact index of your KB is included in Claude's system prompt
- **Semantic search**: Claude uses `kb_search` to find relevant content by meaning or exact terms
- **On-demand retrieval**: Claude uses `kb_read` to fetch full file contents when needed
- **Quote-grounding**: Claude extracts quotes from files before synthesizing responses for accuracy

### Knowledge Graph

ChatNoire includes a **Knowledge Graph** that transforms your knowledge base from isolated files into an interconnected web of ideas. Claude automatically creates relationships when you share information.

#### Relationship Types

| Type | Meaning | Example |
|------|---------|---------|
| `extends` | Target builds on source | "calculus.md" extends "algebra.md" |
| `references` | Target cites source | "project-plan.md" references "requirements.md" |
| `contradicts` | Target conflicts with source | "diet-2025.md" contradicts "diet-2024.md" |
| `requires` | Target is prerequisite for source | "ml-advanced.md" requires "linear-algebra.md" |
| `blocks` | Source blocks progress on target | "tech-debt.md" blocks "feature-x.md" |
| `relates-to` | General thematic connection | "react-hooks.md" relates-to "state-management.md" |

#### Graph Traversal

Use `kb_graph` to navigate the knowledge graph:
- **Find prerequisites**: `kb_graph("ml-notes.md", depth=3, relationship="requires")` 
- **Discover related content**: `kb_graph("react.md", direction="both")`
- **Impact analysis**: `kb_graph("api.md", direction="incoming")` — what depends on this?
- **Detect contradictions**: `kb_graph("diet.md", relationship="contradicts")`

The graph can be visualized in the sidebar under **Visualization → Graph tab**.

### Suggested Organization

```
knowledge/
├── about-me/
│   ├── background.md
│   └── resume.md
├── preferences/
│   └── coding-style.md
├── projects/
│   ├── current-project.md
│   └── ideas.md
└── work/
    └── team.md
```

---

## Large Document RAG

For documents too large to fit in Claude's context window, ChatNoire provides a **Large Document RAG** system. Upload PDFs, text files, or markdown and ask questions without loading the entire document.

### How It Works

1. **Upload** — Click "Upload Document" or drag-and-drop a file in the Large Documents browser
2. **Storage** — File is immediately stored in IndexedDB for viewing
3. **Background Indexing** — Document is indexed in the background while you continue using the app
4. **PDF Extraction** — PDFs are parsed using PDF.js (free), with intelligent quality detection that falls back to Claude Haiku for scanned/image-based documents
5. **Chunking** — Document is split into ~512-token chunks with 15% overlap
6. **Embedding** — Each chunk is embedded using OpenAI's embedding model
7. **Storage** — Chunks with embeddings stored in IndexedDB (client-side)
8. **Search** — Claude uses `document_search` to find relevant chunks by meaning
9. **Rerank** — Top candidates are reranked for higher accuracy
10. **Answer** — Claude synthesizes an answer from the retrieved chunks

### Document Tools

| Tool | Description |
|------|-------------|
| `document_search(query, topK?, documentId?)` | Semantic search across uploaded documents |
| `document_list()` | List all uploaded documents |

### PDF Extraction

ChatNoire uses an **intelligent hybrid PDF extraction** strategy:

| Method | Cost | Speed | Best For |
|--------|------|-------|----------|
| **PDF.js** | Free | Fast | Text-based PDFs with selectable text |
| **Claude Haiku** | ~$0.01/page | Slower | Scanned documents, image-heavy PDFs |

The system automatically detects when PDF.js extraction yields low-quality content by checking:
- **Character density** — At least 500 chars/page expected for real documents
- **Word density** — Real text has 5+ words per 100 characters
- **Text structure** — Proper spacing ratios indicate readable content

When quality checks fail, the system automatically falls back to Claude Haiku for AI-powered OCR.

### Chunking Strategy (2025 Best Practices)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Chunk Size** | 512 tokens | Optimal for fact-focused Q&A retrieval |
| **Overlap** | 75 tokens (15%) | Prevents context loss at boundaries |
| **Splitter** | Heading-aware | Respects document structure (Markdown headings, paragraphs, sentences) |

### Supported File Types

- **Text** — `.txt`, `.md`, `.json`, `.xml`, `.csv`, `.html` (up to 10MB)
- **PDF** — Automatic text extraction with AI fallback (up to 50MB)

### Background Indexing

When you upload a document:
1. The file is immediately stored and appears in your document list
2. Indexing (text extraction, chunking, embedding) runs in the background
3. You can view the document immediately while indexing continues
4. The document shows "Indexing..." status until complete
5. Once indexed, the document shows a checkmark and is searchable via RAG

Indexing always completes, even if you navigate away or close the browser tab (as long as the tab remains open in the background).

---

## Document Viewer

ChatNoire includes a **Document Viewer** with a Cursor-style 3-panel layout for reading and discussing documents.

### Opening Documents

Documents are **not** opened automatically when uploaded. To view a document:
1. Go to the **Large Documents** section in the sidebar
2. Click the **eye icon** (View button) on any document
3. The document viewer opens as a full-screen overlay

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📄 Document.pdf                              [Indexing...] │           [✕]  │
├─────────────────────────────────────────────────────────────────────────────┤
│ [Document Sidebar]       │  [PDF/Text Viewer]          │  [Chat Panel]      │
│ (collapsible, resizable) │  (main content area)        │  (collapsible)     │
│                          │                             │                    │
│ > Documents              │  ┌─────────────────────┐    │  [Chat 1] [Chat 2] │
│   • Calculus.pdf         │  │                     │    │  ─────────────────  │
│   ○ Physics.pdf          │  │   PDF Page Render   │    │  Selection: [img]  │
│   ○ Notes.md             │  │                     │    │                    │
│                          │  │   [Drag to select]  │    │  User: Explain...  │
│                          │  │   [┌───────────┐]   │    │  Claude: This...   │
│                          │  │   [│ selection │]   │    │                    │
│                          │  │   [└───────────┘]   │    │  ┌──────────────┐  │
│                          │  └─────────────────────┘    │  │ [input...]   │  │
│                          │  [◀ Page 1/50 ▶] [Zoom]     │  └──────────────┘  │
│ [📄▸]                    │  [Capture (Enter)] [Cancel] │             [💬 2] │
└─────────────────────────────────────────────────────────────────────────────┘
```

When sidebars are collapsed, intuitive icons with expand indicators appear:
- Left sidebar: File icon with chevron (📄▸) 
- Right chat panel: Message icon with chat count badge (💬 2)

### Features

- **Full-Screen Overlay** — Immersive reading experience with header bar (press ESC to close)
- **PDF Viewer** — Native PDF rendering with page navigation and zoom
- **Text Viewer** — Markdown rendering for text documents
- **Screenshot Selection** — Drag to select a region, press Enter to capture and chat
- **Multiple Chat Tabs** — Open multiple conversations side-by-side
- **Resizable Panels** — Drag to resize using `react-resizable-panels`
- **Collapsible Sidebars** — Collapse panels for more reading space with clear expand indicators
- **Status Indicators** — Header shows document name, indexing status, and processing errors

### How Screenshot Selection Works

The screenshot-based selection provides a robust way to discuss any part of a document:

1. **Drag** to draw a selection rectangle on the PDF
2. A visual overlay shows your selection with page number
3. Press **Enter** to capture (or click the "Capture" button)
4. Press **Escape** to cancel the selection
5. The screenshot is captured directly from the PDF canvas (fast, no external libraries)
6. Claude (Sonnet) analyzes the visual content and responds

This approach is more robust than text selection because:
- Works with scanned PDFs, diagrams, charts, and images
- Captures visual layout and formatting
- No issues with PDF text layer misalignment
- Supports any visual content, not just text
- Uses native canvas capture for speed and reliability

### Margin Chat Infrastructure

The margin chat **fully reuses the existing chat infrastructure** with complete feature parity:

- Same `/api/chat` endpoint and `useChat` hook as the main chat
- **Shared `ChatMessage` component** for full markdown/LaTeX/code rendering
- **Shared `ToolInvocationRenderer`** for displaying tool calls and results
- All tools (KB search, document search, web search) work in margin chat
- Syntax-highlighted code blocks, KaTeX math, GFM tables—identical to the main chat
- Each chat tab is an independent conversation with its own history

This ensures the document viewer chat has the exact same rendering quality as the main chat.

---

## Chat History Search

ChatNoire can search across your **past conversations** to find relevant context. This uses the same unified hybrid search as the Knowledge Base and Large Documents.

| Tool | Description |
|------|-------------|
| `chat_search(query, topK?)` | Hybrid search across chat history (lexical + semantic + reranking) |

### Features

- **Hybrid Search** — Combines lexical (exact terms) and semantic (meaning) with RRF fusion
- **Auto Query Detection** — Automatically detects query type (exact, semantic, or mixed)
- **Cross-Encoder Reranking** — Optional reranking for 20-40% accuracy improvement
- **Chunk Overlap** — 15% overlap between chunks to preserve context at boundaries
- **Matched Terms** — Shows which terms matched for transparency

Chat messages are automatically chunked (with overlap) and embedded when conversations are saved.

---

## Web Search

ChatNoire integrates Anthropic's first-party **web search** capability, giving Claude real-time access to the internet.

### Features

- Up to **5 searches per conversation** (configurable)
- Automatic source citations
- Optional domain allow/block lists
- Optional user location for relevant results

### When Claude Uses Web Search

- Current events, news, or recent information
- Up-to-date documentation or API references
- User explicitly asks to search the web
- Topics where training data might be outdated

---

## Adding Custom Tools

### Step 1: Create the Tool

Create a new file in `/tools/` (e.g., `calculator.ts`):

```typescript
import { tool } from "ai";
import { z } from "zod";

export const calculatorTool = tool({
  description: "Perform mathematical calculations",
  inputSchema: z.object({
    expression: z.string().describe("Math expression to evaluate"),
  }),
  execute: async ({ expression }) => {
    const result = eval(expression); // Use a safe math parser in production!
    return { expression, result };
  },
});
```

### Step 2: Register the Tool

Add your tool to `/tools/index.ts`:

```typescript
import { calculatorTool } from "./calculator";

export function createTools(apiKey: string): ToolSet {
  return {
    ...knowledgeTools,
    save_to_context: saveToContextTool,
    web_search: createWebSearchTool(apiKey),
    calculator: calculatorTool,  // Add your tool here
  };
}
```

### Step 3: (Optional) Create a UI Component

Create a component in `/components/tools/` to render your tool's results beautifully. See `knowledge-tool-view.tsx` or `web-search-view.tsx` for examples.

---

## Customizing the Agent

Edit `/agents/chat-agent.ts` to customize the agent's behavior. The `createChatAgent` function builds the agent with:

- **Model**: Configurable between Haiku 4.5, Sonnet 4.5, and Opus 4.5 via the model selector
- **Instructions**: System prompt with XML-structured context engineering
- **Tools**: All tools from `/tools/index.ts` (KB, graph, documents, web search, context savers)
- **KB Summary**: Pre-generated summary of your knowledge base for hybrid preload

### Model Tiers

| Tier | Model | Display Name | Best For |
|------|-------|--------------|----------|
| Haiku | claude-haiku-4-5-20251001 | Apprentice | Fast, simple tasks |
| Sonnet | claude-sonnet-4-5-20250929 | Master | Balanced speed/quality |
| Opus | claude-opus-4-5-20251101 | Grandmaster | Complex reasoning |

### Context Engineering

The system prompt follows research-backed context engineering principles:
- XML-structured data at TOP (improves retrieval by up to 30%)
- Quote-grounding instruction (improves accuracy by 20+ percentage points)
- Hybrid preload strategy (summary + just-in-time retrieval)

---

## Troubleshooting

### "ANTHROPIC_API_KEY is not set" Error

1. Ensure the file is named exactly `.env.local` (with the leading dot)
2. Verify it's in the project root (same level as `package.json`)
3. Check there are no spaces around the `=` sign
4. Restart the dev server after creating the file

### "invalid x-api-key" Error

1. Verify you copied the full key (it's quite long)
2. Ensure the key starts with `sk-ant-api03-`
3. Check for extra spaces or quotes around the key
4. Confirm the key hasn't been revoked in the Anthropic console

### PDF Upload Requires API Key

If you see an API key error when uploading PDFs, it means the PDF requires AI-powered OCR (scanned or image-based PDF). The system uses Claude Haiku via the free trial for this. Ensure your server has `ANTHROPIC_API_KEY` configured, or the system will use the free trial automatically.

### Document Has Very Few Chunks

If a PDF document has surprisingly few chunks (e.g., 9 chunks for a 20-page paper), this usually means PDF.js extracted low-quality text. Try:
1. Delete the document
2. Re-upload it — the improved quality detection should now trigger AI OCR fallback

---

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **AI SDK**: Vercel AI SDK v6 (`ai` v6.0.34, `@ai-sdk/react`, `@ai-sdk/anthropic`)
- **Model**: Claude Sonnet 4.5 (Anthropic)
- **Embeddings**: OpenAI `text-embedding-3-small` (or `text-embedding-3-large` with dimension reduction)
- **Reranking**: Cohere Rerank API or GPT-4o-mini fallback
- **Additional Providers**: `@ai-sdk/openai`, `@ai-sdk/groq` (available for extensions)
- **Authentication**: Better Auth with GitHub and Google OAuth
- **Styling**: Tailwind CSS v4
- **Components**: shadcn/ui + Radix UI
- **Icons**: React Icons (Ionicons, FontAwesome, Material, BoxIcons, Ant Design)
- **Markdown**: react-markdown with remark-gfm
- **Math Rendering**: KaTeX with rehype-katex and remark-math
- **Syntax Highlighting**: react-syntax-highlighter with Prism
- **PDF Parsing**: pdfjs-dist (client-side extraction) + Claude Haiku (AI fallback with quality detection)
- **PDF Viewing**: react-pdf for native PDF rendering
- **Resizable Panels**: react-resizable-panels for document viewer layout
- **Storage**: IndexedDB (via `idb`) for knowledge base, chat history, large documents, and file data
- **Validation**: Zod
- **Notifications**: Sonner

---

## Authentication

ChatNoire uses **Better Auth** for authentication with OAuth providers.

### Owner vs BYOK Users

| User Type | API Keys Used | Configuration |
|-----------|---------------|---------------|
| **Owner** | Server-side env keys | Email in `OWNER_EMAILS` |
| **BYOK User** | Their own keys | Entered via Settings modal |

Owner emails get free access using the API keys in your `.env.local`. Other users must provide their own keys through the Settings modal (stored in their browser's localStorage).

### Setting Up OAuth

1. **GitHub**: Create OAuth app at [github.com/settings/developers](https://github.com/settings/developers)
   - Callback URL: `http://localhost:3000/api/auth/callback/github`

2. **Google**: Create credentials at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
   - Callback URL: `http://localhost:3000/api/auth/callback/google`

---

## Deploying to Vercel

1. Push your code to GitHub
2. Import the repository in [Vercel](https://vercel.com)
3. Add environment variables in Project Settings:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `BETTER_AUTH_SECRET`
   - `BETTER_AUTH_URL` (your production URL)
   - `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   - `OWNER_EMAILS`
   - `COHERE_API_KEY` (optional)
4. Update OAuth callback URLs to use your production domain
5. Deploy!

---

## License

MIT
