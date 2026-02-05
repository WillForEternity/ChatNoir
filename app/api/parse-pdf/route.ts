/**
 * Parse PDF API Route
 *
 * Fallback endpoint for extracting text from scanned/image-based PDFs
 * using Claude Haiku's native PDF understanding capability.
 *
 * This is called when client-side PDF.js extraction fails to produce
 * meaningful text (e.g., scanned documents, image-heavy PDFs).
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { getAuthContext, resolveApiKey, createApiKeyRequiredResponse } from "@/lib/auth-helper";

// Allow up to 60 seconds for large PDFs
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const userKey = formData.get("anthropicApiKey") as string | null;
    const useFreeTrial = formData.get("useFreeTrial") === "true";

    if (!file || file.type !== "application/pdf") {
      return Response.json(
        { error: "PDF file required" },
        { status: 400 }
      );
    }

    // Check authentication and resolve API key
    const { isOwner } = await getAuthContext();
    const apiKey = resolveApiKey(isOwner, userKey ?? undefined, process.env.ANTHROPIC_API_KEY, useFreeTrial);

    if (!apiKey) {
      return createApiKeyRequiredResponse();
    }

    // Convert PDF to base64 for Anthropic API
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Create Anthropic client
    const anthropic = createAnthropic({ apiKey });

    // Use Claude Haiku for cost-effective PDF extraction
    const { text } = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: base64,
              mediaType: "application/pdf",
            } as const,
            {
              type: "text",
              text: "Extract all text content from this PDF document. Return only the extracted text, preserving the original structure (headings, paragraphs, lists, etc.) as much as possible. Do not add any commentary, explanations, or formatting instructions - just the raw extracted text.",
            },
          ],
        },
      ],
      maxOutputTokens: 16384,
    });

    return Response.json({ text });
  } catch (error) {
    console.error("[Parse PDF API] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "PDF parsing failed" },
      { status: 500 }
    );
  }
}
