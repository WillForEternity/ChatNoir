/**
 * Agents Index
 *
 * Export all agents from this file for easy importing throughout your app.
 *
 * As you build more specialized agents, add them here:
 *   export { createResearchAgent } from "./research-agent";
 *   export { createCodingAgent } from "./coding-agent";
 */

export { createChatAgent, MODEL_IDS, MODEL_DISPLAY_NAMES } from "./chat-agent";
export type { ChatAgentUIMessage, ModelTier } from "./chat-agent";

// Context Saver - uses streamText for single-pass saving with client-side tool execution
export { getContextSaverConfig, createContextSaverAgent } from "./context-saver-agent";
